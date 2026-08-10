import type { LinkRecord, LinkStore } from './store'

export function kvStore(kv: any): LinkStore {
  const key = 'link-hub:links'
  return {
    async list() { return (await kv.get(key, 'json')) || [] },
    async put(link) { const links = await this.list(); const index = links.findIndex((x: LinkRecord) => x.id === link.id); if (index >= 0) links[index] = link; else links.push(link); await kv.put(key, JSON.stringify(links)) },
    async delete(id) { const links = (await this.list()).filter((x: LinkRecord) => x.id !== id); await kv.put(key, JSON.stringify(links)) }
  }
}
