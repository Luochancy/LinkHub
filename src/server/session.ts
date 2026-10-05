import type { RuntimeEnv } from './config'
import { getEnv } from './config'

export type User = { id: string; login: string; name?: string; avatar?: string }
const COOKIE = 'link_session'
const STATE_COOKIE = 'link_oauth_state'
/** 仅供本地开发入口使用，见 node.ts；生产代码路径永远不会取到这个值。 */
/** 历史版本用过的公开默认值：保留在拒绝名单里，防止有人把它配回生产。 */
const REJECTED_LEGACY_SECRET = 'local-development-secret'
const MIN_SECRET_LENGTH = 16

/**
 * 获取会话签名密钥。
 *
 * 始终 fail-closed：没有 SESSION_SECRET 就直接报错。这里**不提供**任何环境变量开关来
 * 回退到公开的开发密钥 —— 那种开关一旦被误配进生产环境，任何人都能伪造管理员会话。
 * 本地开发的兜底由 Node 入口（node.ts）在进程内自行设置 SESSION_SECRET 来完成，
 * Cloudflare Worker 入口没有这段逻辑，因此生产环境不存在旁路。
 */
export function sessionSecret(runtime?: RuntimeEnv) {
  const secret = getEnv('SESSION_SECRET', runtime)
  if (!secret) throw new Error('缺少 SESSION_SECRET 环境变量，请配置随机密钥（例如 openssl rand -base64 32）')
  if (secret === REJECTED_LEGACY_SECRET) throw new Error('SESSION_SECRET 不能使用默认开发值，请改用随机密钥（例如 openssl rand -base64 32）')
  if (secret.length < MIN_SECRET_LENGTH) throw new Error(`SESSION_SECRET 至少需要 ${MIN_SECRET_LENGTH} 个字符，可用 openssl rand -base64 32 生成`)
  return secret
}

/** 启动时校验一次，让配置错误尽早暴露，而不是等到第一个请求。 */
export function assertSessionSecret(runtime?: RuntimeEnv) {
  sessionSecret(runtime)
}

/** 恒定时间比较，避免通过响应时间逐字节猜测签名。 */
function signaturesMatch(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return diff === 0
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

const encode = (value: string) => base64UrlEncode(new TextEncoder().encode(value))
const decode = (value: string) => new TextDecoder().decode(base64UrlDecode(value))

async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return base64UrlEncode(new Uint8Array(bytes))
}

async function seal(value: string, runtime?: RuntimeEnv) {
  return `${encode(value)}.${await signature(value, sessionSecret(runtime))}`
}

async function unseal(value: string | undefined, runtime?: RuntimeEnv) {
  if (!value) return null
  const [encoded, sig] = value.split('.')
  if (!encoded || !sig) return null
  // Cookie 完全由客户端控制：base64 解码失败（畸形值）必须当作「无会话」，
  // 而不是把异常抛成 500。
  let raw: string
  try { raw = decode(encoded) } catch { return null }
  const expected = await signature(raw, sessionSecret(runtime))
  if (!signaturesMatch(sig, expected)) return null
  return raw
}

export function cookieValue(request: Request, name: string) {
  return request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1)
}

export async function readSession(request: Request, runtime?: RuntimeEnv): Promise<User | null> {
  const raw = await unseal(cookieValue(request, COOKIE), runtime)
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as { user: User; expires: number }
    return data.expires > Date.now() ? data.user : null
  } catch { return null }
}

export async function sessionCookie(user: User, runtime?: RuntimeEnv) {
  const ttl = Number(getEnv('SESSION_TTL', runtime) || 604800)
  const value = await seal(JSON.stringify({ user, expires: Date.now() + ttl * 1000 }), runtime)
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}${appIsSecure(runtime) ? '; Secure' : ''}`
}

export async function stateCookie(state: string, runtime?: RuntimeEnv) {
  return `${STATE_COOKIE}=${await seal(state, runtime)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${appIsSecure(runtime) ? '; Secure' : ''}`
}

export async function readState(request: Request, runtime?: RuntimeEnv) {
  return unseal(cookieValue(request, STATE_COOKIE), runtime)
}

export function clearSessionCookie(runtime?: RuntimeEnv) { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${appIsSecure(runtime) ? '; Secure' : ''}` }
function appIsSecure(runtime?: RuntimeEnv) { return (getEnv('APP_URL', runtime) || '').startsWith('https://') }