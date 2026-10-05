import { Elysia } from 'elysia'
import { WebStandardAdapter } from 'elysia/adapter/web-standard'
import { appUrl, adminIds, adminLogins, type RuntimeEnv } from './config'
import { githubAuthorize, githubCallback } from './auth'
import { clearSessionCookie, readSession } from './session'
import type { User } from './session'
import { createLink, deleteLink as deleteWpLink, faviconFor, listLinks as listWpLinks, ownershipNotes, setVisible, updateLink as updateWpLink } from './wordpress'
import type { LinkStore } from './store'
import { makeLink, type LinkRecord } from './store'
import { validateLinkUrls } from './url-validation'

/**
 * 用户编辑自己已通过的友链后，是否需要管理员重新审核。
 * 默认需要：否则用户可以把已通过审核的链接改成任意 URL 而无需复审。
 */
const RECHECK_EDITED_LINKS = true

/**
 * 公开接口只返回展示所需字段，避免泄露 ownerGithubId、wpId、syncError 等内部信息。
 * ownerLogin 会被前端渲染，因此保留。
 */
function publicLink(link: LinkRecord) {
  return { id: link.id, name: link.name, url: link.url, description: link.description, avatar: link.avatar, ownerLogin: link.ownerLogin, createdAt: link.createdAt }
}

/** 只在字段确实提供时才覆盖，避免 `??` 把 null 变成字符串 "null"。 */
function text(value: unknown, fallback: string) {
  return value === undefined || value === null ? fallback : String(value)
}

type SyncOutcome = { syncStatus: LinkRecord['syncStatus']; syncError?: string }

export function createApp(runtime: RuntimeEnv = {}, store: LinkStore) {
  /**
   * 所有写操作共用一把全局串行锁。
   *
   * 这些路由都是「读取 → 调用 WordPress → 写回」。如果只按记录 id 加锁，导入和迁移仍会
   * 与逐条编辑交错：导入先读快照、用户随后编辑或删除、导入再把旧快照写回（复活已删记录）。
   * 因此这里用一把全局锁，让读-改-写整体互斥。本项目写入量很小，串行化不会成为瓶颈。
   *
   * 重要限制：锁只在单个进程 / 单个 isolate 内生效。Cloudflare Workers 会并行运行多个
   * isolate，且 KV 无事务、读取为最终一致，因此**跨 isolate 的并发编辑仍可能互相覆盖**。
   * 要真正保证强一致需要把存储换成 D1 或 Durable Object，或引入 Durable Object 作为协调者。
   */
  let writeQueue: Promise<unknown> = Promise.resolve()
  function withWriteLock<T>(task: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(task, task)
    writeQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  /** 调用 WordPress，失败时不抛出，而是把结果收敛成同步状态，由调用方单次落库。 */
  async function syncQuietly(task: () => Promise<unknown>): Promise<SyncOutcome> {
    try {
      await task()
      return { syncStatus: 'synced', syncError: undefined }
    } catch (error) {
      return { syncStatus: 'failed', syncError: error instanceof Error ? error.message : 'WordPress 同步失败' }
    }
  }

  // Cloudflare Workers disallow Elysia's Function-based AOT compiler.  The
  // application is also mounted by the Worker entrypoint, so this inner app
  // must use the same interpreter-based Web Standard handler.
  const app = new Elysia({ name: 'link-manager', adapter: WebStandardAdapter, aot: false })
    .onError(({ code, error, set }) => {
      if (code === 'NOT_FOUND') return
      // 请求体 JSON 解析失败属于客户端错误：body 解析发生在路由之前，
      // 统一按 500 返回会把调用方的格式问题伪装成服务端故障。
      // 注意：此处 Elysia 给出的 code 可能是 undefined，只能靠错误类型判断。
      if (code === 'PARSE' || code === 'VALIDATION' || error instanceof SyntaxError || (error as any)?.name === 'SyntaxError') {
        set.status = 400
        return { error: '请求内容格式不正确' }
      }
      set.status = 500
      return { error: error instanceof Error ? error.message : '服务器错误' }
    })
    .get('/api/health', () => ({ ok: true }))
    .get('/api/auth/github', ({ set }) => githubAuthorize(runtime, set))
    .get('/api/auth/callback', async ({ request, set, query }) => githubCallback(request, query.code, query.state, runtime, set))
    .get('/api/auth/me', async ({ request }) => { const user = await readSession(request, runtime); return { user, isAdmin: Boolean(user && isAdminUser(user, runtime)) } })
    .post('/api/auth/logout', ({ set }) => { set.headers['Set-Cookie'] = clearSessionCookie(runtime); return { ok: true } })
    .get('/api/links', async () => ({ links: (await store.list()).filter(link => link.status === 'approved').map(publicLink) }))
    .get('/api/links/mine', async ({ request, set }) => { const user = await requireUser(request, set, runtime); if (!user) return { links: [] }; return { links: (await store.list()).filter(link => link.ownerGithubId === user.id) } })
    .post('/api/links', async ({ request, body, set }) => {
      const user = await requireUser(request, set, runtime); if (!user) return { error: '请先登录' }
      const input = (body ?? {}) as Record<string, unknown>
      // 纯空白名称会生成一条无法辨认的记录，必须连同 trim 后一起校验。
      const name = String(input?.name ?? '').trim()
      if (!name || !input?.url) { set.status = 400; return { error: '网站名称和 URL 为必填项' } }
      const urlError = validateLinkUrls(String(input.url), input.avatar ? String(input.avatar) : undefined); if (urlError) { set.status = 400; return { error: urlError } }
      const link = makeLink({ name, url: String(input.url), description: input.description ? String(input.description) : undefined, avatar: input.avatar ? String(input.avatar) : undefined, ownerGithubId: user.id, ownerLogin: user.login })
      await store.put(link); return { link }
    })
    .put('/api/links/:id', async ({ request, params, body, set }) => {
      const user = await requireUser(request, set, runtime); if (!user) return { error: '请先登录' }
      const input = (body ?? {}) as Record<string, unknown>
      const outcome = await withWriteLock(async () => {
        const existing = await store.get(params.id)
        if (!existing || existing.ownerGithubId !== user.id) return { status: 404, body: { error: '无权修改此友链' } }
        const nextUrl = text(input.url, existing.url).trim(); const nextAvatar = text(input.avatar, existing.avatar).trim()
        const urlError = validateLinkUrls(nextUrl, nextAvatar); if (urlError) return { status: 400, body: { error: urlError } }
        const needsRecheck = RECHECK_EDITED_LINKS && existing.status === 'approved'
        const updated = { ...existing, name: text(input.name, existing.name).trim(), url: nextUrl, description: text(input.description, existing.description), avatar: nextAvatar, status: needsRecheck ? 'pending' as const : existing.status, syncStatus: existing.wpId ? 'pending' as const : existing.syncStatus, syncError: undefined, updatedAt: Date.now() } as LinkRecord
        // 先同步 WordPress，再单次落库：对 KV 而言同一 key 只写一次（也避免了「先写 pending、
        // 再写 synced」两次写入在最终一致下被读到的中间态）。
        if (updated.wpId) {
          const sync = await syncQuietly(() => updateWpLink(updated.wpId as number, { ...updated, notes: ownershipNotes(updated.ownerGithubId, updated.ownerLogin), visible: updated.status === 'approved' }, user, runtime))
          updated.syncStatus = sync.syncStatus
          updated.syncError = sync.syncError
        }
        await store.put(updated)
        return { status: 200, body: { link: updated } }
      })
      set.status = outcome.status
      return outcome.body
    })
    .delete('/api/links/:id', async ({ request, params, set }) => {
      const user = await requireUser(request, set, runtime); if (!user) return { error: '请先登录' }
      const outcome = await withWriteLock(async () => {
        const existing = await store.get(params.id)
        if (!existing || existing.ownerGithubId !== user.id) return { status: 404, body: { error: '无权删除此友链' } }
        if (existing.wpId) {
          try { await deleteWpLink(existing.wpId, runtime) }
          catch (syncError) { return { status: 502, body: { error: syncError instanceof Error ? syncError.message : '删除 WordPress 链接失败，请稍后重试' } } }
        }
        await store.delete(existing.id)
        return { status: 200, body: { ok: true } }
      })
      set.status = outcome.status
      return outcome.body
    })
    .get('/api/admin/pending', async ({ request, set }) => { const user = await requireAdmin(request, set, runtime); if (!user) return { error: '无权访问' }; return { links: (await store.list()).filter(x => x.status === 'pending') } })
    .get('/api/admin/unowned', async ({ request, set }) => { const user = await requireAdmin(request, set, runtime); if (!user) return { error: '无权访问' }; return { links: (await store.list()).filter(x => x.source === 'wordpress-import' && !x.ownerGithubId) } })
    .get('/api/admin/links', async ({ request, set }) => { const user = await requireAdmin(request, set, runtime); if (!user) return { error: '无权访问' }; return { links: await store.list() } })
    .post('/api/admin/import', async ({ request, set }) => {
      const user = await requireAdmin(request, set, runtime); if (!user) return { error: '无权访问' }
      const outcome = await withWriteLock(async () => {
        try {
          const current = await store.list(); const imported = await listWpLinks(runtime); let added = 0
          let updated = 0
          let skipped = 0
          // 同一 wpId 在一次导入中只能落一条，避免远端返回重复条目时新增重复记录。
          const claimedWpIds = new Set(current.map(x => x.wpId).filter(Boolean) as number[])
          for (const item of imported) {
            const existing = current.find(x => x.wpId === item.id)
            // 本地存在尚未同步到 WordPress 的改动（例如用户编辑后等待重新审核）时跳过，
            // 否则会被 WordPress 里的旧数据覆盖回去。
            if (existing && (existing.status === 'pending' || existing.syncStatus !== 'synced')) { skipped++; continue }
            const importedData = { name: item.name, url: item.url, description: item.description, avatar: item.avatar || faviconFor(item.url), ownerGithubId: item.ownerId || existing?.ownerGithubId || null, ownerLogin: item.ownerLogin || existing?.ownerLogin, status: (item.visible ? 'approved' : 'rejected') as LinkRecord['status'], source: 'wordpress-import' as const, syncStatus: 'synced' as const }
            if (existing) {
              await store.put({ ...existing, ...importedData, updatedAt: Date.now() }); updated++
            } else {
              if (claimedWpIds.has(item.id)) { skipped++; continue }
              claimedWpIds.add(item.id)
              await store.put(makeLink({ wpId: item.id, ...importedData })); added++
            }
          }
          return { status: 200, body: { added, updated, skipped, total: imported.length, importedBy: user.login } }
        } catch (error) {
          return { status: 502, body: { error: error instanceof Error ? error.message : 'WordPress 导入失败' } }
        }
      })
      set.status = outcome.status
      return outcome.body
    })
    .put('/api/admin/:id', async ({ request, params, body, set }) => {
      const admin = await requireAdmin(request, set, runtime); if (!admin) return { error: '无权访问' }
      const input = (body ?? {}) as Record<string, unknown>
      const outcome = await withWriteLock(async () => {
        const existing = await store.get(params.id)
        if (!existing) return { status: 404, body: { error: '链接不存在' } }
        const nextName = String(input?.name ?? '').trim()
        if (!nextName || !input?.url) return { status: 400, body: { error: '名称和 URL 为必填项' } }
        const urlError = validateLinkUrls(String(input.url), input.avatar ? String(input.avatar) : undefined); if (urlError) return { status: 400, body: { error: urlError } }
        // 只有「归属确实变了」才清掉旧的 login / 审计信息；否则编辑名称不应该抹掉归属记录。
        const ownerFieldProvided = Object.prototype.hasOwnProperty.call(input, 'githubId')
        const ownerGithubId = ownerFieldProvided ? (String(input.githubId || '').trim() || null) : existing.ownerGithubId
        const ownerChanged = ownerFieldProvided && ownerGithubId !== existing.ownerGithubId
        const updated = { ...existing, name: nextName, url: String(input.url).trim(), description: String(input.description || ''), avatar: String(input.avatar || faviconFor(String(input.url))), ownerGithubId, ownerLogin: ownerChanged ? undefined : existing.ownerLogin, ownerAssignedAt: ownerChanged ? (ownerGithubId ? Date.now() : undefined) : existing.ownerAssignedAt, ownerAssignedBy: ownerChanged ? (ownerGithubId ? admin.id : undefined) : existing.ownerAssignedBy, updatedAt: Date.now(), syncStatus: existing.wpId ? 'pending' as const : existing.syncStatus, syncError: undefined } as LinkRecord
        if (updated.wpId) {
          const notes = ownershipNotes(updated.ownerGithubId, updated.ownerLogin)
          const sync = await syncQuietly(() => updateWpLink(updated.wpId as number, { ...updated, notes, visible: updated.status === 'approved' }, admin, runtime))
          updated.syncStatus = sync.syncStatus
          updated.syncError = sync.syncError
        }
        await store.put(updated)
        return { status: 200, body: { link: updated } }
      })
      set.status = outcome.status
      return outcome.body
    })
    .delete('/api/admin/:id', async ({ request, params, set }) => {
      const admin = await requireAdmin(request, set, runtime); if (!admin) return { error: '无权访问' }
      const outcome = await withWriteLock(async () => {
        const existing = await store.get(params.id)
        if (!existing) return { status: 404, body: { error: '链接不存在' } }
        if (existing.wpId) {
          try { await deleteWpLink(existing.wpId, runtime) }
          catch (error) { return { status: 502, body: { error: error instanceof Error ? error.message : '删除 WordPress 链接失败' } } }
        }
        await store.delete(existing.id)
        return { status: 200, body: { ok: true } }
      })
      set.status = outcome.status
      return outcome.body
    })
    .post('/api/admin/:id/visibility', async ({ request, params, body, set }) => {
      const admin = await requireAdmin(request, set, runtime); if (!admin) return { error: '无权访问' }
      // 必须显式传布尔值：`Boolean('false')` 是 true，会把隐藏变成公开。
      const visible = (body as any)?.visible
      if (typeof visible !== 'boolean') { set.status = 400; return { error: 'visible 必须是布尔值' } }
      const outcome = await withWriteLock(async () => {
        const existing = await store.get(params.id)
        if (!existing) return { status: 404, body: { error: '链接不存在' } }
        const updated = { ...existing, status: visible ? 'approved' as const : 'rejected' as const, syncError: undefined, updatedAt: Date.now() } as LinkRecord
        // 本地有未同步改动时必须连同内容一起推送，否则 WordPress 会停留在旧内容上。
        // 一次 PUT 同时带上内容与可见性，避免「两次推送」之间的中间态。
        const needsContentPush = existing.syncStatus !== 'synced'
        const notes = ownershipNotes(updated.ownerGithubId, updated.ownerLogin)
        if (!existing.wpId) {
          if (visible) {
            const owner: User | null = existing.ownerGithubId ? { id: existing.ownerGithubId, login: existing.ownerLogin || '' } : null
            const created = await syncQuietly(async () => {
              const wp = await createLink(existing, owner, runtime, true)
              updated.wpId = wp.id
            })
            updated.syncStatus = created.syncStatus; updated.syncError = created.syncError
          } else updated.syncStatus = 'synced'
        } else if (needsContentPush) {
          const push = await syncQuietly(() => updateWpLink(existing.wpId as number, { ...updated, notes, visible }, admin, runtime))
          updated.syncStatus = push.syncStatus; updated.syncError = push.syncError
        } else {
          const push = await syncQuietly(() => setVisible(existing.wpId as number, visible, runtime))
          updated.syncStatus = push.syncStatus; updated.syncError = push.syncError
        }
        await store.put(updated)
        return { status: 200, body: { link: updated } }
      })
      set.status = outcome.status
      return outcome.body
    })
    .get('/api/admin/storage', async ({ request, set }) => {
      const admin = await requireAdmin(request, set, runtime); if (!admin) return { error: '无权访问' }
      if (!store.legacyStatus) return { migratable: false, supportsMigration: Boolean(store.migrateLegacy) }
      return { migratable: (await store.legacyStatus()).pending, supportsMigration: Boolean(store.migrateLegacy) }
    })
    .post('/api/admin/migrate', async ({ request, set }) => {
      const admin = await requireAdmin(request, set, runtime); if (!admin) return { error: '无权访问' }
      if (!store.migrateLegacy) { set.status = 400; return { error: '当前存储不需要迁移' } }
      // 与导入共用同一把全局锁：迁移期间所有写操作都被排除，缩短「写回已被删除记录」的窗口。
      const outcome = await withWriteLock(async () => {
        try { return { status: 200, body: await store.migrateLegacy!() } }
        catch (error) { return { status: 502, body: { error: error instanceof Error ? error.message : '迁移失败' } } }
      })
      set.status = outcome.status
      return outcome.body
    })
    .get('/api/config', () => ({ appUrl: appUrl(runtime) }))
    .get('/*', async ({ request }) => runtime.ASSETS?.fetch(request) || new Response('Not Found', { status: 404 }))
  return app
}

async function requireUser(request: Request, set: any, runtime: RuntimeEnv) { const user = await readSession(request, runtime); if (!user) set.status = 401; return user }
async function requireAdmin(request: Request, set: any, runtime: RuntimeEnv) {
  const user = await requireUser(request, set, runtime)
  if (!user) return null
  // 已登录但不是管理员：必须显式返回 403，否则默认 200 会让前端把错误体当成成功响应。
  if (!isAdminUser(user, runtime)) { set.status = 403; return null }
  return user
}
function isAdminUser(user: { id: string; login: string }, runtime: RuntimeEnv) { return adminIds(runtime).has(user.id) || adminLogins(runtime).has(user.login.toLowerCase()) }