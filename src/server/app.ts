import { Elysia } from 'elysia'
import { appUrl, adminIds, adminLogins, type RuntimeEnv } from './config'
import { githubAuthorize, githubCallback } from './auth'
import { clearSessionCookie, readSession } from './session'
import { createLink, deleteLink as deleteWpLink, faviconFor, listLinks as listWpLinks, setVisible, updateLink as updateWpLink } from './wordpress'
import type { LinkStore } from './store'
import { makeLink, type LinkRecord } from './store'
import { validateLinkUrls } from './url-validation'

export function createApp(runtime: RuntimeEnv = {}, store: LinkStore) {
  const app = new Elysia({ name: 'link-manager' })
    .onError(({ code, error, set }) => { if (code === 'NOT_FOUND') return; set.status = 500; return { error: error instanceof Error ? error.message : '服务器错误' } })
    .get('/api/health', () => ({ ok: true }))
    .get('/api/auth/github', ({ set }) => githubAuthorize(runtime, set))
    .get('/api/auth/callback', async ({ request, set, query }) => githubCallback(request, query.code, query.state, runtime, set))
    .get('/api/auth/me', async ({ request }) => { const user = await readSession(request, runtime); return { user, isAdmin: Boolean(user && isAdminUser(user, runtime)) } })
    .post('/api/auth/logout', ({ set }) => { set.headers['Set-Cookie'] = clearSessionCookie(); return { ok: true } })
    .get('/api/links', async () => ({ links: (await store.list()).filter(link => link.status === 'approved') }))
    .get('/api/links/mine', async ({ request, set }) => { const user = await requireUser(request, set, runtime); if (!user) return { links: [] }; return { links: (await store.list()).filter(link => link.ownerGithubId === user.id) } })
    .post('/api/links', async ({ request, body, set }) => {
      const user = await requireUser(request, set, runtime); if (!user) return { error: '请先登录' }
      const input = body as any
      if (!input?.name || !input?.url) return { error: '网站名称和 URL 为必填项' }
      const urlError = validateLinkUrls(input.url, input.avatar); if (urlError) return { error: urlError }
      const link = makeLink({ name: input.name, url: input.url, description: input.description, avatar: input.avatar, ownerGithubId: user.id, ownerLogin: user.login })
      await store.put(link); return { link }
    })
    .put('/api/links/:id', async ({ request, params, body, set }) => {
      const user = await requireUser(request, set, runtime); if (!user) return { error: '请先登录' }
      const existing = (await store.list()).find(x => x.id === params.id && x.ownerGithubId === user.id); if (!existing) return { error: '无权修改此友链' }
      const input = body as any; const nextUrl = input.url || existing.url; const nextAvatar = input.avatar ?? existing.avatar; const urlError = validateLinkUrls(nextUrl, nextAvatar); if (urlError) return { error: urlError }
      const updated = { ...existing, name: input.name || existing.name, url: nextUrl, description: input.description ?? existing.description, avatar: nextAvatar, status: existing.status === 'approved' ? 'approved' : existing.status, syncStatus: existing.wpId ? 'pending' : existing.syncStatus, updatedAt: Date.now() } as LinkRecord
      await store.put(updated); if (updated.status === 'approved' && updated.wpId) await updateWpLink(updated.wpId, updated, user, runtime); return { link: updated }
    })
    .delete('/api/links/:id', async ({ request, params, set }) => {
      const user = await requireUser(request, set, runtime); if (!user) return { error: '请先登录' }
      const existing = (await store.list()).find(x => x.id === params.id && x.ownerGithubId === user.id); if (!existing) return { error: '无权删除此友链' }
      if (existing.wpId) await deleteWpLink(existing.wpId, runtime); await store.delete(existing.id); return { ok: true }
    })
    .get('/api/admin/pending', async ({ request, set }) => { const user = await requireAdmin(request, set, runtime); if (!user) return { error: '无权访问' }; return { links: (await store.list()).filter(x => x.status === 'pending') } })
    .get('/api/admin/unowned', async ({ request, set }) => { const user = await requireAdmin(request, set, runtime); if (!user) return { error: '无权访问' }; return { links: (await store.list()).filter(x => x.source === 'wordpress-import' && !x.ownerGithubId) } })
    .get('/api/admin/links', async ({ request, set }) => { const user = await requireAdmin(request, set, runtime); if (!user) return { error: '无权访问' }; return { links: await store.list() } })
    .post('/api/admin/import', async ({ request, set }) => {
      const user = await requireAdmin(request, set, runtime); if (!user) return { error: '无权访问' }
      try {
        const current = await store.list(); const imported = await listWpLinks(runtime); let added = 0
        let updated = 0
        for (const item of imported) {
          const existing = current.find(x => x.wpId === item.id)
          const importedData = { name: item.name, url: item.url, description: item.description, avatar: item.avatar || faviconFor(item.url), ownerGithubId: item.ownerId || existing?.ownerGithubId || null, ownerLogin: item.ownerLogin || existing?.ownerLogin, status: (item.visible ? 'approved' : 'rejected') as LinkRecord['status'], source: 'wordpress-import' as const, syncStatus: 'synced' as const }
          if (existing) { await store.put({ ...existing, ...importedData, updatedAt: Date.now() }); updated++ } else { await store.put(makeLink({ wpId: item.id, ...importedData })); added++ }
        }
        return { added, updated, total: imported.length, importedBy: user.login }
      } catch (error) { set.status = 502; return { error: error instanceof Error ? error.message : 'WordPress 导入失败' } }
    })
    .put('/api/admin/:id', async ({ request, params, body, set }) => {
      const admin = await requireAdmin(request, set, runtime); if (!admin) return { error: '无权访问' }
      const existing = (await store.list()).find(x => x.id === params.id); const input = body as any
      if (!existing || !input?.name || !input?.url) return { error: '链接不存在或名称、URL 为空' }
      const urlError = validateLinkUrls(input.url, input.avatar); if (urlError) return { error: urlError }
      const ownerFieldProvided = Object.prototype.hasOwnProperty.call(input, 'githubId')
      const ownerGithubId = ownerFieldProvided ? (String(input.githubId || '').trim() || null) : existing.ownerGithubId
      const updated = { ...existing, name: String(input.name).trim(), url: String(input.url).trim(), description: String(input.description || ''), avatar: String(input.avatar || faviconFor(String(input.url))), ownerGithubId, ownerLogin: ownerFieldProvided ? undefined : existing.ownerLogin, ownerAssignedAt: ownerFieldProvided && ownerGithubId ? Date.now() : ownerFieldProvided ? undefined : existing.ownerAssignedAt, ownerAssignedBy: ownerFieldProvided && ownerGithubId ? admin.id : ownerFieldProvided ? undefined : existing.ownerAssignedBy, updatedAt: Date.now(), syncStatus: existing.wpId ? 'pending' as const : existing.syncStatus }
      if (existing.wpId) {
        const notes = updated.ownerGithubId ? `link-manager:github:${updated.ownerGithubId}${updated.ownerLogin ? `\nlink-manager:login:${updated.ownerLogin}` : ''}` : ''
        try { await updateWpLink(existing.wpId, { ...updated, notes, visible: existing.status === 'approved' }, admin, runtime); updated.syncStatus = 'synced' } catch (error) { updated.syncStatus = 'failed'; updated.syncError = error instanceof Error ? error.message : 'WordPress 同步失败' }
      }
      await store.put(updated); return { link: updated }
    })
    .delete('/api/admin/:id', async ({ request, params, set }) => {
      const admin = await requireAdmin(request, set, runtime); if (!admin) return { error: '无权访问' }
      const existing = (await store.list()).find(x => x.id === params.id); if (!existing) return { error: '链接不存在' }
      try { if (existing.wpId) await deleteWpLink(existing.wpId, runtime); await store.delete(existing.id); return { ok: true } }
      catch (error) { set.status = 502; return { error: error instanceof Error ? error.message : '删除 WordPress 链接失败' } }
    })
    .post('/api/admin/:id/visibility', async ({ request, params, body, set }) => {
      const user = await requireAdmin(request, set, runtime); if (!user) return { error: '无权访问' }
      const existing = (await store.list()).find(x => x.id === params.id); if (!existing) return { error: '链接不存在' }
      const visible = Boolean((body as any)?.visible); let updated = { ...existing, status: visible ? 'approved' : 'rejected', updatedAt: Date.now() } as LinkRecord
      if (visible) { if (existing.wpId) await setVisible(existing.wpId, true, runtime); else { const wp = await createLink(existing, { id: existing.ownerGithubId || '', login: existing.ownerLogin || '' }, runtime, true); updated.wpId = wp.id } } else if (existing.wpId) await setVisible(existing.wpId, false, runtime)
      updated.syncStatus = 'synced'; await store.put(updated); return { link: updated }
    })
    .post('/api/admin/:id/owner', async ({ request, params, body, set }) => {
      const admin = await requireAdmin(request, set, runtime); if (!admin) return { error: '无权访问' }
      const existing = (await store.list()).find(x => x.id === params.id); const input = body as any
      if (!existing || !input?.githubId) return { error: '链接或 GitHub ID 不正确' }
      const updated = { ...existing, ownerGithubId: String(input.githubId), ownerLogin: input.login || existing.ownerLogin, ownerAssignedAt: Date.now(), ownerAssignedBy: admin.id, updatedAt: Date.now() } as LinkRecord
      await store.put(updated); return { link: updated }
    })
    .get('/api/config', () => ({ appUrl: appUrl(runtime) }))
    .get('/*', async ({ request }) => runtime.ASSETS?.fetch(request) || new Response('Not Found', { status: 404 }))
  return app
}

async function requireUser(request: Request, set: any, runtime: RuntimeEnv) { const user = await readSession(request, runtime); if (!user) set.status = 401; return user }
async function requireAdmin(request: Request, set: any, runtime: RuntimeEnv) { const user = await requireUser(request, set, runtime); return user && isAdminUser(user, runtime) ? user : null }
function isAdminUser(user: { id: string; login: string }, runtime: RuntimeEnv) { return adminIds(runtime).has(user.id) || adminLogins(runtime).has(user.login.toLowerCase()) }
