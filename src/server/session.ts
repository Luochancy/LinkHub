import type { RuntimeEnv } from './config'
import { getEnv } from './config'

export type User = { id: string; login: string; name?: string; avatar?: string }
const COOKIE = 'link_session'
const STATE_COOKIE = 'link_oauth_state'

const encode = (value: string) => btoa(unescape(encodeURIComponent(value))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
const decode = (value: string) => decodeURIComponent(escape(atob(value.replace(/-/g, '+').replace(/_/g, '/'))))

async function signature(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return encode(String.fromCharCode(...new Uint8Array(bytes)))
}

async function seal(value: string, runtime?: RuntimeEnv) {
  const secret = getEnv('SESSION_SECRET', runtime) || 'local-development-secret'
  return `${encode(value)}.${await signature(value, secret)}`
}

async function unseal(value: string | undefined, runtime?: RuntimeEnv) {
  if (!value) return null
  const [encoded, sig] = value.split('.')
  if (!encoded || !sig) return null
  const raw = decode(encoded)
  const expected = await signature(raw, getEnv('SESSION_SECRET', runtime) || 'local-development-secret')
  if (sig !== expected) return null
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

export function clearSessionCookie() { return `${COOKIE}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax` }
function appIsSecure(runtime?: RuntimeEnv) { return (getEnv('APP_URL', runtime) || '').startsWith('https://') }
