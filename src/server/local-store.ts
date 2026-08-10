import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { LinkRecord, LinkStore } from './store'

export function localStore(file: string): LinkStore {
  const load = async (): Promise<LinkRecord[]> => { try { return JSON.parse(await readFile(file, 'utf8')) } catch { return [] } }
  return {
    async list() { return load() },
    async put(link) { const links = await load(); const index = links.findIndex(x => x.id === link.id); if (index >= 0) links[index] = link; else links.push(link); await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(links, null, 2)) },
    async delete(id) { const links = (await load()).filter(x => x.id !== id); await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(links, null, 2)) }
  }
}
