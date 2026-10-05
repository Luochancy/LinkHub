import type { LinkRecord, LinkStore, MigrationResult } from './store'

const PREFIX = 'link-hub:link:'
/** 旧版把全部友链存在单个 JSON blob 里，迁移后删除。 */
const LEGACY_KEY = 'link-hub:links'
/** 迁移完成标记：用独立状态键，而不是「新格式里有没有记录」来判断。 */
const MIGRATION_KEY = 'link-hub:migration'
/** 迁移前保留原始 blob 的备份，便于追溯与重放。 */
const LEGACY_BACKUP_KEY = 'link-hub:links:backup'
/** 删除墓碑。迁移需要区分「尚未迁移」与「迁移后被删除」，仅看 key 是否存在无法区分。 */
const TOMBSTONE_PREFIX = 'link-hub:deleted:'
const READ_CONCURRENCY = 16

function keyFor(id: string) {
  return `${PREFIX}${id}`
}
function tombstoneFor(id: string) {
  return `${TOMBSTONE_PREFIX}${id}`
}

/**
 * 并发执行并把错误收集起来，等**所有**任务结束后再抛出。
 *
 * 迁移的批量写入必须这样：若用 Promise.all，一个任务失败会立刻 reject，
 * 调用方随即释放全局写锁返回，但同批其它任务仍在后台写入 —— 它们可能覆盖
 * 之后发生的编辑，或复活刚被删除的记录。
 */
async function runAllSettled<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<{ results: R[]; errors: unknown[] }> {
  const results: R[] = []
  const errors: unknown[] = []
  for (let index = 0; index < items.length; index += limit) {
    const settled = await Promise.allSettled(items.slice(index, index + limit).map(task))
    for (const entry of settled) {
      if (entry.status === 'fulfilled') results.push(entry.value)
      else errors.push(entry.reason)
    }
  }
  return { results, errors }
}

/**
 * 一条友链一个 key。
 *
 * 写入只触碰单条记录，因此并发提交不再互相覆盖；读取通过 prefix 列举，不需要维护索引 key。
 *
 * 注意：Cloudflare KV 没有事务，也不保证「写入后立刻能在其它位置读到新值」。因此
 * `put`/`delete` 与随后的 `get`/`list` 之间可能存在可见性延迟，跨 isolate 的并发编辑
 * 仍可能互相覆盖。真正的强一致需要 D1 或 Durable Object，KV 更适合做展示层。
 */
export function kvStore(kv: any): LinkStore {
  async function hasTombstone(id: string) {
    return (await kv.get(tombstoneFor(id))) !== null
  }

  return {
    async list() {
      const links: LinkRecord[] = []
      let cursor: string | undefined
      do {
        const page = await kv.list({ prefix: PREFIX, cursor })
        const { results } = await runAllSettled(
          page.keys as Array<{ name: string }>,
          READ_CONCURRENCY,
          entry => kv.get(entry.name, 'json')
        )
        for (const value of results) if (value) links.push(value as LinkRecord)
        cursor = page.list_complete ? undefined : page.cursor
      } while (cursor)
      return links
    },
    async get(id) {
      return ((await kv.get(keyFor(id), 'json')) as LinkRecord | null) ?? null
    },
    async put(link) {
      await kv.put(keyFor(link.id), JSON.stringify(link))
    },
    async delete(id) {
      // 先写墓碑再删记录：迁移重试时靠墓碑区分「已删除」与「未迁移」。
      await kv.put(tombstoneFor(id), String(Date.now()))
      await kv.delete(keyFor(id))
    },
    async legacyStatus() {
      const state = await kv.get(MIGRATION_KEY, 'json')
      if (state?.completed) return { pending: false }
      const legacy = await kv.get(LEGACY_KEY, 'json')
      return { pending: Array.isArray(legacy) && legacy.length > 0 }
    },
    /**
     * 把旧版单 blob 数据迁移为新格式。
     *
     * 完成顺序：备份 → 写完成标记 → 删除旧 blob。这样任何一步失败后重试都能收敛：
     * 标记没写成，旧 blob 还在，可重试；标记写成但旧 blob 没删掉，重试会补删。
     *
     * 记录是否写入用「key 不存在 **且** 没有墓碑」判定：只看 key 会复活
     * 「上一个失败批次已迁移、之后被管理员删除」的记录。
     */
    async migrateLegacy(): Promise<MigrationResult> {
      const state = await kv.get(MIGRATION_KEY, 'json')
      const legacy = await kv.get(LEGACY_KEY, 'json')

      if (state?.completed) {
        // 已完成：如果旧 blob 因删除失败而残留，这里补删。
        if (legacy !== null && legacy !== undefined) await kv.delete(LEGACY_KEY)
        return { imported: 0, skipped: 0, alreadyMigrated: true, completed: true }
      }
      if (legacy === null || legacy === undefined) {
        // 没有旧 blob：无事可做，也不写完成标记，保留日后恢复 blob 再迁移的可能。
        return { imported: 0, skipped: 0, alreadyMigrated: false, completed: false }
      }
      if (!Array.isArray(legacy)) throw new Error('旧版存储格式异常：期望数组，请先人工检查 link-hub:links')

      const records = (legacy as LinkRecord[]).filter(link => Boolean(link?.id))
      const malformed = (legacy as LinkRecord[]).length - records.length

      const looked = await runAllSettled(records, READ_CONCURRENCY, async link => {
        if ((await kv.get(keyFor(link.id), 'json')) !== null) return 'exists'
        if (await hasTombstone(link.id)) return 'deleted'
        return 'missing'
      })
      if (looked.errors.length > 0) throw looked.errors[0]

      const toWrite = records.filter((_, index) => looked.results[index] === 'missing')
      const live = records.length - toWrite.length
      const deleted = looked.results.filter(result => result === 'deleted').length

      const written = await runAllSettled(toWrite, READ_CONCURRENCY, async link => {
        await kv.put(keyFor(link.id), JSON.stringify(link))
        return link.id
      })
      // 即便有失败也要全部等待结束再抛，避免调用方释放写锁后仍有任务在写。
      if (written.errors.length > 0) throw new Error(`迁移写入失败（已写入 ${written.results.length}/${toWrite.length} 条，可重试）：${String(written.errors[0])}`)

      await kv.put(LEGACY_BACKUP_KEY, JSON.stringify(legacy))
      await kv.put(MIGRATION_KEY, JSON.stringify({ completed: true, at: Date.now(), imported: written.results.length }))
      await kv.delete(LEGACY_KEY)

      return { imported: written.results.length, skipped: malformed + live + deleted, alreadyMigrated: false, completed: true }
    }
  }
}