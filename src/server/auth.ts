import { appUrl, getEnv, type RuntimeEnv } from './config'
import { readState, sessionCookie, stateCookie, type User } from './session'

export async function githubAuthorize(runtime: RuntimeEnv, set: any) {
  try {
    const clientId = getEnv('GITHUB_CLIENT_ID', runtime)
    if (!clientId) { set.status = 500; return { error: '未配置 GitHub OAuth' } }
    const state = crypto.randomUUID()
    set.headers['Set-Cookie'] = await stateCookie(state, runtime)
    const redirect = getEnv('GITHUB_REDIRECT_URI', runtime) || `${appUrl(runtime)}/api/auth/callback`
    const url = new URL('https://github.com/login/oauth/authorize')
    url.searchParams.set('client_id', clientId); url.searchParams.set('redirect_uri', redirect); url.searchParams.set('scope', 'read:user'); url.searchParams.set('state', state)
    set.status = 302; set.headers.Location = url.toString(); return ''
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('GitHub OAuth authorize failed:', detail)
    set.status = 500
    return { error: 'GitHub OAuth 初始化失败', detail }
  }
}

export async function githubCallback(request: Request, code: string | undefined, state: string | undefined, runtime: RuntimeEnv, set: any) {
  const expected = await readState(request, runtime)
  const frontend = appUrl(runtime)
  if (!code || !state || !expected || state !== expected) { set.status = 302; set.headers.Location = `${frontend}/?error=oauth_state`; return '' }
  const clientId = getEnv('GITHUB_CLIENT_ID', runtime), secret = getEnv('GITHUB_CLIENT_SECRET', runtime)
  if (!clientId || !secret) { set.status = 302; set.headers.Location = `${frontend}/?error=oauth_config`; return '' }
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, client_secret: secret, code }) })
  const token = (await tokenResponse.json() as any).access_token
  if (!token) { set.status = 302; set.headers.Location = `${frontend}/?error=oauth_token`; return '' }
  const profile = await fetch('https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'link-manager' } }).then(r => r.json() as Promise<any>)
  const user: User = { id: String(profile.id), login: profile.login, name: profile.name, avatar: profile.avatar_url }
  set.status = 302; set.headers.Location = `${frontend}/`; set.headers['Set-Cookie'] = await sessionCookie(user, runtime); return ''
}

export const appState = {}
