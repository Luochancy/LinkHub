import type { RuntimeEnv } from './config'
import { getEnv, requiredEnv } from './config'
import type { User } from './session'

export type Link = {
  id: number
  name: string
  url: string
  description: string
  avatar: string
  visible: boolean
  ownerId?: string
  ownerLogin?: string
  raw?: unknown
}

export function faviconFor(url: string) {
  try { return `${new URL(url).origin}/favicon.ico` } catch { return '' }
}

function decodeWpText(value: unknown) {
  return String(value ?? '').replace(/&amp;/g, '&').replace(/&#039;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
}

const marker = (id: string) => `link-manager:github:${id}`
const authHeaders = (runtime?: RuntimeEnv): Record<string, string> => {
  const username = getEnv('WP_USERNAME', runtime)
  const password = getEnv('WP_APPLICATION_PASSWORD', runtime)
  return username && password ? { Authorization: `Basic ${btoa(`${username}:${password}`)}` } : {}
}

function fromWp(item: any): Link {
  const notes = String(item.link_notes ?? item.meta?.link_notes ?? '')
  const match = notes.match(/link-manager:github:([\w-]+)/)
  const url = item.link_url || item.url || ''
  return { id: Number(item.id), name: decodeWpText(item.name), url, description: decodeWpText(item.description), avatar: item.link_image || item.avatar || faviconFor(url), visible: (item.link_visible || item.status || 'Y') !== 'N', ownerId: match?.[1], ownerLogin: notes.match(/link-manager:login:([\w-]+)/)?.[1], raw: item }
}

async function request(path = '', init: RequestInit = {}, runtime?: RuntimeEnv) {
  const base = requiredEnv('WP_LINKS_URL', runtime).replace(/\/$/, '')
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  for (const [key, value] of Object.entries(authHeaders(runtime))) headers.set(key, value)
  const response = await fetch(`${base}${path}`, { ...init, headers })
  if (!response.ok) throw new Error(`WordPress API ${response.status}：接口地址不存在、插件未启用或当前凭证无权访问`)
  return response.json()
}

export async function listLinks(runtime?: RuntimeEnv) {
  const items: Link[] = []
  for (let page = 1; page <= 20; page++) {
    const data = await request(`?per_page=100&page=${page}`, {}, runtime)
    items.push(...(Array.isArray(data) ? data : []).map(fromWp))
    if (!Array.isArray(data) || data.length < 100) break
  }
  return items
}

export async function createLink(input: { name: string; url: string; description?: string; avatar?: string }, user: User, runtime?: RuntimeEnv, visible = false) {
  const notes = `${marker(user.id)}\nlink-manager:login:${user.login}`
  const data = await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.name, url: input.url, description: input.description || '', avatar: input.avatar || '', notes, visible: visible ? 'Y' : 'N' }) }, runtime)
  return fromWp(data)
}

export async function updateLink(id: number, input: { name: string; url: string; description?: string; avatar?: string; notes?: string; visible?: boolean }, user: User, runtime?: RuntimeEnv) {
  const body: Record<string, unknown> = { name: input.name, url: input.url, description: input.description || '', avatar: input.avatar || '', notes: input.notes ?? `${marker(user.id)}\nlink-manager:login:${user.login}` }
  if (typeof input.visible === 'boolean') body.visible = input.visible ? 'Y' : 'N'
  const data = await request(`/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, runtime)
  return fromWp(data)
}

export async function deleteLink(id: number, runtime?: RuntimeEnv) {
  return request(`/${id}`, { method: 'DELETE' }, runtime)
}

export async function setVisible(id: number, visible: boolean, runtime?: RuntimeEnv) {
  return fromWp(await request(`/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible: visible ? 'Y' : 'N' }) }, runtime))
}
