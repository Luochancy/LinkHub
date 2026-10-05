import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { LinkRecord, LinkStore } from './store'

/**
 * 开发用的 JSON 文件存储。
 * 写入串行化并采用「临时文件 + rename」，避免并发请求互相覆盖或写坏文件。
 */
export function localStore(file: string): LinkStore {
  let queue: Promise<unknown> = Promise.resolve()

  const load = async (): Promise<LinkRecord[]> => {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      // JSON 合法但结构不对（例如被写成对象）同样视为损坏：直接返回空表会在下次写入时
      // 把原有数据整体覆盖掉。
      if (!Array.isArray(parsed)) throw new Error(`存储文件 ${file} 结构异常：期望数组`)
      return parsed
    } catch (error) {
      // 只有「文件不存在」才是空表。文件损坏或权限错误必须向上抛，
      // 否则一次失败的读取会变成静默清空，随后写回就会丢掉全部数据。
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
      throw error
    }
  }

  const save = async (links: LinkRecord[]) => {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(links, null, 2))
    await rename(temporary, file)
  }

  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task, task)
    queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  return {
    async list() {
      return load()
    },
    async get(id) {
      return (await load()).find(link => link.id === id) ?? null
    },
    put(link) {
      return serialize(async () => {
        const links = await load()
        const index = links.findIndex(x => x.id === link.id)
        if (index >= 0) links[index] = link
        else links.push(link)
        await save(links)
      })
    },
    delete(id) {
      return serialize(async () => {
        await save((await load()).filter(x => x.id !== id))
      })
    }
  }
}