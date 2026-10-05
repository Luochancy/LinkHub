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

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function fromCodePoint(code: number) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try { return String.fromCodePoint(code) } catch { return '' }
}

function decodeWpText(value: unknown) {
  return String(value ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (entity: string, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/&amp;/gi, '&')
}

const marker = (id: string) => `link-manager:github:${id}`

/**
 * 归属关系写在 WordPress 的 notes 字段里，这里统一生成，避免各处手写格式漂移。
 * 无归属时返回空串，不写入 `link-manager:github:` 这类空标记。
 */
export function ownershipNotes(id?: string | null, login?: string | null) {
  if (!id) return ''
  const lines = [marker(id)]
  if (login) lines.push(`link-manager:login:${login}`)
  return lines.join('\n')
}
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

/** WordPress 不可达时不能无限等待：调用方通常持有记录锁，会连带阻塞其他请求。 */
const WP_TIMEOUT_MS = 10_000

async function request(path = '', init: RequestInit = {}, runtime?: RuntimeEnv) {
  const base = requiredEnv('WP_LINKS_URL', runtime).replace(/\/$/, '')
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  for (const [key, value] of Object.entries(authHeaders(runtime))) headers.set(key, value)
  let response: Response
  try {
    response = await fetch(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(WP_TIMEOUT_MS) })
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? `请求超时（${WP_TIMEOUT_MS}ms）` : '网络不可达'
    throw new Error(`WordPress ${reason}，请检查 WP_LINKS_URL 与站点可用性`)
  }
  if (!response.ok) throw new Error(`WordPress API ${response.status}：接口地址不存在、插件未启用或当前凭证无权访问`)
  // 插件被换成返回 HTML 错误页 / 空响应体时，response.json() 会抛出难以理解的解析错误，
  // 这里转成可读信息。错误信息只包含状态与原因，不含 URL 或凭证。
  try { return await response.json() } catch { throw new Error('WordPress 返回的不是合法 JSON，请确认接口地址指向 link-manager 插件') }
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

export async function createLink(input: { name: string; url: string; description?: string; avatar?: string }, user: User | null, runtime?: RuntimeEnv, visible = false) {
  const notes = ownershipNotes(user?.id, user?.login)
  const data = await request('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.name, url: input.url, description: input.description || '', avatar: input.avatar || '', notes, visible: visible ? 'Y' : 'N' }) }, runtime)
  return fromWp(data)
}

export async function updateLink(id: number, input: { name: string; url: string; description?: string; avatar?: string; notes?: string; visible?: boolean }, user: User, runtime?: RuntimeEnv) {
  const body: Record<string, unknown> = { name: input.name, url: input.url, description: input.description || '', avatar: input.avatar || '', notes: input.notes ?? ownershipNotes(user.id, user.login) }
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
