/**
 * 针对性验证脚本：逐条验证本次加固的实际行为。
 * 运行：npm run verify
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/server/app'
import { localStore } from '../src/server/local-store'
import { kvStore } from '../src/server/kv-store'
import { assertSessionSecret, sessionCookie, sessionSecret } from '../src/server/session'
import { makeLink, type LinkRecord, type LinkStore } from '../src/server/store'
import { createLink, ownershipNotes } from '../src/server/wordpress'

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`  ok  ${name}`)
  else {
    failures++
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function section(title: string) {
  console.log(`\n${title}`)
}

const SECRET = 't'.repeat(40)
const wpRuntimeVars = { WP_LINKS_URL: 'https://wp.example/wp-json/link-manager/v1/links', WP_API_KEY: 'test-key' }
const baseRuntime = { APP_URL: 'http://localhost:3000', ADMIN_GITHUB_IDS: '999', SESSION_SECRET: SECRET, ...wpRuntimeVars }
const OWNER = { id: 'owner-1', login: 'owner' }
const dir = await mkdtemp(join(tmpdir(), 'linkhub-verify-'))
const realFetch = globalThis.fetch

const ok = (payload: unknown) => () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

async function cookie(user: { id: string; login: string }) {
  return sessionCookie(user, baseRuntime)
}
function request(path: string, init: RequestInit = {}) {
  return new Request(`http://localhost:3000${path}`, init)
}
function jsonRequest(path: string, method: string, body: unknown, cookieHeader?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookieHeader) headers.Cookie = cookieHeader
  return new Request(`http://localhost:3000${path}`, { method, headers, body: JSON.stringify(body) })
}
function wpLink(overrides: Record<string, unknown> = {}) {
  return { id: 1, name: 'WP', url: 'https://wp.example', description: '', avatar: '', visible: true, ...overrides }
}

try {
  section('1. SESSION_SECRET 默认 fail-closed（无任何环境开关旁路）')
  let threw = false
  try {
    sessionSecret({ APP_URL: 'http://localhost:3000' })
  } catch {
    threw = true
  }
  check('即使 APP_URL 是 localhost，缺少 SESSION_SECRET 也抛错', threw)
  threw = false
  try {
    sessionSecret({ APP_URL: 'https://linkhub.luochancy.com' })
  } catch {
    threw = true
  }
  check('非本地环境缺少 SESSION_SECRET 时抛错', threw)
  threw = false
  try {
    assertSessionSecret({ APP_URL: 'https://x.com', SESSION_SECRET: 'short' })
  } catch {
    threw = true
  }
  check('拒绝过短密钥', threw)
  threw = false
  try {
    sessionSecret({ SESSION_SECRET: 'local-development-secret' })
  } catch {
    threw = true
  }
  check('拒绝默认开发密钥（即使显式配置）', threw)
  threw = false
  try {
    // 旧实现曾用 ALLOW_INSECURE_DEV_SECRET 这类开关放行，等于给生产留了后门。
    sessionSecret({ APP_URL: 'https://x.com', ALLOW_INSECURE_DEV_SECRET: 'true' })
  } catch {
    threw = true
  }
  check('不存在可用于绕过校验的环境开关', threw)
  check('合规密钥被接受', sessionSecret({ SESSION_SECRET: SECRET }) === SECRET)

  section('2. 会话签名与篡改检测')
  const apiStore = localStore(join(dir, 'api.json'))
  const app = createApp(baseRuntime, apiStore)
  const adminCookie = await cookie({ id: '999', login: 'admin' })
  const ownerCookie = await cookie(OWNER)
  const okRes = await app.handle(request('/api/auth/me', { headers: { Cookie: adminCookie } }))
  const okBody: any = await okRes.json()
  check('合法签名会话被接受', okRes.status === 200 && okBody.user?.id === '999', JSON.stringify(okBody))
  const tampered = adminCookie.replace(/(link_session=)[^;]+/, '$1zzzz')
  const badBody: any = (await (await app.handle(request('/api/auth/me', { headers: { Cookie: tampered } }))).json())
  check('篡改签名被拒绝', badBody.user === null, JSON.stringify(badBody))

  section('3. ownershipNotes 不再产生空标记')
  check('无归属时返回空串', ownershipNotes(null, null) === '', JSON.stringify(ownershipNotes(null, null)))
  check('有 login 时包含两行标记', ownershipNotes('42', 'octocat') === 'link-manager:github:42\nlink-manager:login:octocat', JSON.stringify(ownershipNotes('42', 'octocat')))
  check('无 login 时不写空 login 行', ownershipNotes('42', '') === 'link-manager:github:42', JSON.stringify(ownershipNotes('42', '')))

  section('4. createLink 对无归属链接不写空标记')
  const wpCalls: Array<{ url: string; body: any }> = []
  globalThis.fetch = (async (url: any, init: any) => {
    wpCalls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
    return ok({ id: 99, name: 'x', link: 'https://x.example', visible: true })()
  }) as any
  await createLink({ name: 'x', url: 'https://x.example' }, null, wpRuntimeVars, true)
  check('无归属时 notes 为空串', wpCalls[0]?.body?.notes === '', JSON.stringify(wpCalls[0]?.body?.notes))
  await createLink({ name: 'x', url: 'https://x.example' }, { id: '42', login: 'octocat' }, wpRuntimeVars, true)
  check('有归属时 notes 带标记', wpCalls[1]?.body?.notes === 'link-manager:github:42\nlink-manager:login:octocat', JSON.stringify(wpCalls[1]?.body?.notes))
  globalThis.fetch = realFetch

  section('5. kv-store 一条一 key、get(id)、前缀分页与显式迁移')
  const kv = fakeKV()
  await kv.put('link-hub:links', JSON.stringify([makeLink({ id: 'legacy-1', name: 'L1', url: 'https://l1.example', status: 'approved' }), makeLink({ id: 'legacy-2', name: 'L2', url: 'https://l2.example', status: 'approved' })]))
  const kvLinks = kvStore(kv)
  check('list() 不再隐式迁移（避免重复导入/复活已删记录）', (await kvLinks.list()).length === 0, `实际 ${(await kvLinks.list()).length}`)
  check('legacyStatus() 报告待迁移', (await kvLinks.legacyStatus()).pending === true)
  const migrated = await kvLinks.migrateLegacy!()
  check('migrateLegacy() 导入旧数据', migrated.imported === 2 && migrated.completed === true, JSON.stringify(migrated))
  check('迁移后写入独立 key', kv.map.has('link-hub:link:legacy-1') && kv.map.has('link-hub:link:legacy-2'))
  check('迁移后删除旧 key', !kv.map.has('link-hub:links'))
  check('迁移完成后 legacyStatus 不再提示', (await kvLinks.legacyStatus()).pending === false)
  const afterMigrate = await kvLinks.list()
  check('分页读取覆盖全部记录', afterMigrate.length === 2, `实际 ${afterMigrate.length}`)
  check('get(id) 按 id 返回单条', (await kvLinks.get('legacy-1'))?.name === 'L1')
  check('get(id) 不存在时返回 null', (await kvLinks.get('nope')) === null)

  // 升级后先提交了新记录，也不能因此永久挡住历史数据迁移。
  const kv2 = fakeKV()
  await kv2.put('link-hub:links', JSON.stringify([makeLink({ id: 'legacy-9', name: 'L9', url: 'https://l9.example' })]))
  const kvLinks2 = kvStore(kv2)
  await kvLinks2.put(makeLink({ id: 'fresh-1', name: 'F1', url: 'https://f1.example' }))
  const migrated2 = await kvLinks2.migrateLegacy!()
  check('已存在新记录时仍能迁移历史数据', migrated2.imported === 1 && migrated2.alreadyMigrated === false, JSON.stringify(migrated2))
  check('已有记录未被覆盖', (await kvLinks2.get('fresh-1'))?.name === 'F1')

  await Promise.all([
    kvLinks.put(makeLink({ id: 'c-1', name: 'C1', url: 'https://c1.example' })),
    kvLinks.put(makeLink({ id: 'c-2', name: 'C2', url: 'https://c2.example' })),
    kvLinks.put(makeLink({ id: 'c-3', name: 'C3', url: 'https://c3.example' }))
  ])
  check('并发写入互不覆盖', (await kvLinks.list()).length === 5, `实际 ${(await kvLinks.list()).length}`)
  await kvLinks.delete('c-2')
  check('删除只影响单条', (await kvLinks.list()).length === 4)

  section('6. local-store 并发写入不再丢数据')
  const legacyFile = join(dir, 'legacy.json')
  await writeFile(legacyFile, '[]')
  const legacyStore = legacyRMWStore(legacyFile)
  await Promise.all(Array.from({ length: 25 }, (_, index) => legacyStore.put(makeLink({ id: `old-${index}`, name: `old${index}`, url: `https://old${index}.example` }))))
  const legacyCount = (await legacyStore.list()).length
  check('旧「整表读改写」实现确实会丢写（证明用例有效）', legacyCount < 25, `实际保留 ${legacyCount}/25`)

  const newFile = join(dir, 'links.json')
  const newStore = localStore(newFile)
  await Promise.all(Array.from({ length: 25 }, (_, index) => newStore.put(makeLink({ id: `new-${index}`, name: `new${index}`, url: `https://new${index}.example` }))))
  check('新实现 25 次并发写入全部保留', (await newStore.list()).length === 25, `实际 ${(await newStore.list()).length}`)
  check('落盘文件为合法 JSON', Array.isArray(JSON.parse(await readFile(newFile, 'utf8'))))
  await newStore.put(makeLink({ id: 'new-0', name: 'renamed', url: 'https://new0.example' }))
  check('更新是同 id 覆盖而非追加', (await newStore.list()).length === 25)
  check('get(id) 读取单条', (await newStore.get('new-1'))?.name === 'new1')
  await newStore.delete('new-0')
  check('删除生效', (await newStore.list()).length === 24)
  // 损坏的文件必须报错，而不是被当成空表静默清空。
  await writeFile(newFile, '{ this is not json')
  let corruptThrew = false
  try {
    await newStore.list()
  } catch {
    corruptThrew = true
  }
  check('损坏的存储文件抛错而非静默清空', corruptThrew)

  section('7. API 公开字段白名单与鉴权')
  await apiStore.put({
    ...makeLink({ id: 'pub-1', name: 'Approved', url: 'https://a.example', description: 'd', avatar: 'https://a.example/i.png', status: 'approved', ownerGithubId: '12345', ownerLogin: 'octocat', wpId: 7, syncStatus: 'failed', ownerAssignedBy: '999' }),
    syncError: 'boom'
  } as LinkRecord)
  await apiStore.put(makeLink({ id: 'pub-2', name: 'Pending', url: 'https://b.example', status: 'pending' }))
  const listRes = await app.handle(request('/api/links'))
  const listBody: any = await listRes.json()
  check('GET /api/links 返回 200', listRes.status === 200, `实际 ${listRes.status}`)
  check('只返回已通过链接', listBody.links.length === 1, `实际 ${listBody.links.length}`)
  const item = listBody.links[0] || {}
  check('不泄露 ownerGithubId', item.ownerGithubId === undefined)
  check('不泄露 wpId', item.wpId === undefined)
  check('不泄露 syncError', item.syncError === undefined)
  check('不泄露 ownerAssignedBy', item.ownerAssignedBy === undefined)
  check('不泄露 syncStatus', item.syncStatus === undefined)
  check('保留 ownerLogin 供前端展示', item.ownerLogin === 'octocat')
  check('保留展示字段', item.name === 'Approved' && item.url === 'https://a.example' && 'description' in item && 'avatar' in item)

  for (const [label, path] of [['管理列表', '/api/admin/links'], ['待审核', '/api/admin/pending'], ['无主链接', '/api/admin/unowned'], ['存储状态', '/api/admin/storage']] as const) {
    const res = await app.handle(request(path))
    check(`匿名访问${label} 401`, res.status === 401, `实际 ${res.status}`)
  }
  const mineRes = await app.handle(request('/api/links/mine'))
  check('匿名访问我的友链 401', mineRes.status === 401, `实际 ${mineRes.status}`)
  const postRes = await app.handle(jsonRequest('/api/links', 'POST', { name: 'x', url: 'https://x.example' }))
  check('匿名提交被拒', postRes.status === 401, `实际 ${postRes.status}`)
  const ownerRouteRes = await app.handle(jsonRequest('/api/admin/pub-1/owner', 'POST', { githubId: '1' }, adminCookie))
  check('已移除的分支路由不再存在', ownerRouteRes.status === 404 || ownerRouteRes.status === 401, `实际 ${ownerRouteRes.status}`)

  section('8. 已登录但非管理员必须 403（旧实现返回 200 + 错误体）')
  const nonAdminGet = await app.handle(request('/api/admin/links', { headers: { Cookie: ownerCookie } }))
  check('非管理员访问管理列表 403', nonAdminGet.status === 403, `实际 ${nonAdminGet.status}`)
  const nonAdminWrite = await app.handle(jsonRequest('/api/admin/pub-1', 'PUT', { name: 'a', url: 'https://a.example' }, ownerCookie))
  check('非管理员写入 403', nonAdminWrite.status === 403, `实际 ${nonAdminWrite.status}`)
  const nonAdminVisibility = await app.handle(jsonRequest('/api/admin/pub-1/visibility', 'POST', { visible: true }, ownerCookie))
  check('非管理员审核 403', nonAdminVisibility.status === 403, `实际 ${nonAdminVisibility.status}`)
  const nonAdminMigrate = await app.handle(jsonRequest('/api/admin/migrate', 'POST', {}, ownerCookie))
  check('非管理员触发迁移 403', nonAdminMigrate.status === 403, `实际 ${nonAdminMigrate.status}`)

  section('9. 校验失败返回 400/404（而非 200 + error，导致前端写入 undefined）')
  await apiStore.put(makeLink({ id: 'mine-1', name: 'Mine', url: 'https://mine.example', status: 'approved', ownerGithubId: OWNER.id, ownerLogin: OWNER.login }))
  const badCreate = await app.handle(jsonRequest('/api/links', 'POST', { name: 'x' }, ownerCookie))
  check('缺少 URL 时 400', badCreate.status === 400, `实际 ${badCreate.status}`)
  const badScheme = await app.handle(jsonRequest('/api/links', 'POST', { name: 'x', url: 'javascript:alert(1)' }, ownerCookie))
  check('非法协议时 400', badScheme.status === 400, `实际 ${badScheme.status}`)
  const badEdit = await app.handle(jsonRequest('/api/links/mine-1', 'PUT', { url: 'javascript:alert(1)' }, ownerCookie))
  check('编辑时非法协议 400', badEdit.status === 400, `实际 ${badEdit.status}`)
  const foreignEdit = await app.handle(jsonRequest('/api/links/pub-1', 'PUT', { name: 'hijack' }, ownerCookie))
  check('编辑他人链接返回 404', foreignEdit.status === 404, `实际 ${foreignEdit.status}`)
  const badAdminEdit = await app.handle(jsonRequest('/api/admin/pub-1', 'PUT', { name: '', url: '' }, adminCookie))
  check('管理端空字段 400', badAdminEdit.status === 400, `实际 ${badAdminEdit.status}`)
  const missingAdminEdit = await app.handle(jsonRequest('/api/admin/does-not-exist', 'PUT', { name: 'a', url: 'https://a.example' }, adminCookie))
  check('管理端编辑不存在的链接 404', missingAdminEdit.status === 404, `实际 ${missingAdminEdit.status}`)
  // Boolean('false') === true，若不校验类型，前端传字符串 "false" 会把隐藏变成公开。
  const stringVisible = await app.handle(jsonRequest('/api/admin/pub-1/visibility', 'POST', { visible: 'false' }, adminCookie))
  check('visible 传字符串 "false" 被拒（400）', stringVisible.status === 400, `实际 ${stringVisible.status}`)
  const missingVisible = await app.handle(jsonRequest('/api/admin/pub-1/visibility', 'POST', {}, adminCookie))
  check('visible 缺失被拒（400）', missingVisible.status === 400, `实际 ${missingVisible.status}`)
  const stillPending = (await apiStore.get('pub-2'))?.status
  check('被拒的请求未改动任何状态', stillPending === 'pending', `实际 ${stillPending}`)

  section('10. 用户编辑已通过链接后回到待审核并在 WP 上隐藏')
  const recheckStore = localStore(join(dir, 'recheck.json'))
  await recheckStore.put(makeLink({ id: 'rc-1', name: 'RC', url: 'https://rc.example', status: 'approved', ownerGithubId: OWNER.id, ownerLogin: OWNER.login, wpId: 42, syncStatus: 'synced' }))
  const recheckApp = createApp(baseRuntime, recheckStore)
  const wpBodies: any[] = []
  const wpWrites: string[] = []
  globalThis.fetch = (async (_url: any, init: any) => {
    wpBodies.push(init?.body ? JSON.parse(init.body) : null)
    wpWrites.push(String(init?.method || 'GET'))
    return ok(wpLink({ id: 42 }))()
  }) as any
  const editRes = await recheckApp.handle(jsonRequest('/api/links/rc-1', 'PUT', { name: 'RC2', url: 'https://rc2.example', description: 'new' }, ownerCookie))
  const editBody: any = await editRes.json()
  check('编辑返回 200 且带 link', editRes.status === 200 && Boolean(editBody.link), JSON.stringify(editBody))
  check('状态回到 pending', editBody.link?.status === 'pending', editBody.link?.status)
  check('同步状态为 synced', editBody.link?.syncStatus === 'synced', editBody.link?.syncStatus)
  check('推送 WordPress 时带 visible=false（先下架再审）', wpBodies[0]?.visible === 'N', JSON.stringify(wpBodies[0]?.visible))
  check('推送 WordPress 时保留归属标记', wpBodies[0]?.notes === 'link-manager:github:owner-1\nlink-manager:login:owner', JSON.stringify(wpBodies[0]?.notes))
  check('一次编辑只调用一次 WordPress', wpWrites.length === 1, JSON.stringify(wpWrites))
  globalThis.fetch = realFetch

  section('11. 审核通过时若本地未同步则推送内容')
  const visStore = localStore(join(dir, 'visibility.json'))
  await visStore.put(makeLink({ id: 'vis-1', name: 'V', url: 'https://v.example', status: 'pending', ownerGithubId: OWNER.id, ownerLogin: OWNER.login, wpId: 42, syncStatus: 'failed' }))
  const visApp = createApp(baseRuntime, visStore)
  const visCalls: Array<{ url: string; method: string; body: any }> = []
  globalThis.fetch = (async (url: any, init: any) => {
    visCalls.push({ url: String(url), method: String(init?.method || 'GET'), body: init?.body ? JSON.parse(init.body) : null })
    return ok(wpLink({ id: 42 }))()
  }) as any
  const visRes = await visApp.handle(jsonRequest('/api/admin/vis-1/visibility', 'POST', { visible: true }, adminCookie))
  const visBody: any = await visRes.json()
  check('审核返回 200', visRes.status === 200, `实际 ${visRes.status}`)
  check('状态变为 approved 且同步成功', visBody.link?.status === 'approved' && visBody.link?.syncStatus === 'synced', JSON.stringify(visBody.link))
  check('未同步时走内容推送（PUT 到单条资源）', visCalls[0]?.url.endsWith('/42') && visCalls[0]?.method === 'PUT' && visCalls[0]?.body?.visible === 'Y', `${visCalls[0]?.method} ${visCalls[0]?.url} ${JSON.stringify(visCalls[0]?.body)}`)
  // 断言推送的是本地记录的真实内容，而不只是「调用过」。
  check('推送内容与本地记录一致', visCalls[0]?.body?.name === 'V' && visCalls[0]?.body?.url === 'https://v.example' && visCalls[0]?.body?.notes === 'link-manager:github:owner-1\nlink-manager:login:owner', JSON.stringify(visCalls[0]?.body))
  check('一次审核只推送一次', visCalls.length === 1, `实际 ${visCalls.length}`)
  globalThis.fetch = realFetch

  section('12. WordPress 故障时不再 500，而是落库并标记 failed')
  const failStore = localStore(join(dir, 'fail.json'))
  await failStore.put(makeLink({ id: 'fail-1', name: 'F', url: 'https://f.example', status: 'pending', syncStatus: 'synced' }))
  const failApp = createApp(baseRuntime, failStore)
  globalThis.fetch = (async () => new Response('nope', { status: 500 })) as any
  const failRes = await failApp.handle(jsonRequest('/api/admin/fail-1/visibility', 'POST', { visible: true }, adminCookie))
  const failBody: any = await failRes.json()
  check('WordPress 故障时返回 200 而不是 500', failRes.status === 200, `实际 ${failRes.status}`)
  check('标记 syncStatus=failed', failBody.link?.syncStatus === 'failed', JSON.stringify(failBody.link?.syncStatus))
  check('记录了 syncError', typeof failBody.link?.syncError === 'string' && failBody.link.syncError.length > 0)
  const persisted = await failStore.get('fail-1')
  check('状态变更确实持久化', persisted?.status === 'approved' && persisted?.syncStatus === 'failed')
  check('同步失败时本地内容仍完整保留', persisted?.name === 'F' && persisted?.url === 'https://f.example')
  check('同步失败不会误报 synced', persisted?.syncStatus !== 'synced')
  check('创建失败时未写入 wpId', persisted?.wpId === undefined)

  const timeoutApp = createApp(baseRuntime, failStore)
  globalThis.fetch = (async () => { const error: any = new Error('aborted'); error.name = 'TimeoutError'; throw error }) as any
  const timeoutRes = await timeoutApp.handle(jsonRequest('/api/admin/fail-1/visibility', 'POST', { visible: true }, adminCookie))
  const timeoutBody: any = await timeoutRes.json()
  check('WordPress 超时被捕获为同步失败（不是 500）', timeoutRes.status === 200 && timeoutBody.link?.syncStatus === 'failed', `${timeoutRes.status} ${JSON.stringify(timeoutBody.link?.syncStatus)}`)
  check('超时错误信息可读', /超时/.test(timeoutBody.link?.syncError || ''), timeoutBody.link?.syncError)
  globalThis.fetch = ok(wpLink())()

  section('13. 导入不会覆盖本地未同步的改动，且不重复新增')
  const importStore = localStore(join(dir, 'import.json'))
  await importStore.put(makeLink({ id: 'keep-1', name: '本地未同步', url: 'https://keep.example', status: 'pending', wpId: 1, ownerGithubId: OWNER.id, ownerLogin: OWNER.login, syncStatus: 'failed' }))
  await importStore.put(makeLink({ id: 'clean-1', name: '已同步', url: 'https://clean.example', status: 'approved', wpId: 2, syncStatus: 'synced' }))
  const importApp = createApp(baseRuntime, importStore)
  globalThis.fetch = (async () => ok([
    wpLink({ id: 1, name: 'WP 旧数据' }),
    wpLink({ id: 2, name: 'WP 新数据' }),
    // 与 wpId 2 重复的条目：不应再新增一条。
    wpLink({ id: 2, name: 'WP 新数据副本' }),
    wpLink({ id: 3, name: 'WP 全新' })
  ])()) as any
  const importRes = await importApp.handle(request('/api/admin/import', { method: 'POST', headers: { Cookie: adminCookie } }))
  const importBody: any = await importRes.json()
  check('导入返回 200', importRes.status === 200, `实际 ${importRes.status}`)
  check('跳过未同步记录', importBody.skipped >= 1, JSON.stringify(importBody))
  check('新增 1 条全新记录', importBody.added === 1, JSON.stringify(importBody))
  const kept = await importStore.get('keep-1')
  check('未同步记录保持本地内容', kept?.name === '本地未同步' && kept?.status === 'pending', JSON.stringify(kept))
  const wpIdTwos = (await importStore.list()).filter(x => x.wpId === 2)
  check('同一 wpId 不会重复新增', wpIdTwos.length === 1, `实际 ${wpIdTwos.length}`)
  globalThis.fetch = realFetch

  section('14. 删除与编辑的竞争不会复活记录')
  const raceStore = localStore(join(dir, 'race.json'))
  await raceStore.put(makeLink({ id: 'race-1', name: 'R', url: 'https://r.example', status: 'approved', ownerGithubId: OWNER.id, ownerLogin: OWNER.login, wpId: 55, syncStatus: 'synced' }))
  const raceApp = createApp(baseRuntime, raceStore)
  globalThis.fetch = (async (url: any, init: any) => {
    if (init?.method === 'DELETE') return ok({ ok: true })()
    await new Promise(resolve => setTimeout(resolve, 30))
    return ok(wpLink({ id: 55 }))()
  }) as any

  // (a) 先删除、后编辑：编辑必须拿到 404，且记录不得被写回（这正是旧实现会复活的场景）。
  const firstDelete = await raceApp.handle(request('/api/links/race-1', { method: 'DELETE', headers: { Cookie: ownerCookie } }))
  check('删除返回 200', firstDelete.status === 200, `实际 ${firstDelete.status}`)
  check('删除后记录确实不存在', (await raceStore.get('race-1')) === null)
  const editAfterDelete = await raceApp.handle(jsonRequest('/api/links/race-1', 'PUT', { name: 'resurrect' }, ownerCookie))
  check('删除后编辑返回 404', editAfterDelete.status === 404, `实际 ${editAfterDelete.status}`)
  check('删除后的记录没有被编辑复活', (await raceStore.get('race-1')) === null)

  // (b) 真并发：无论谁先拿到锁，删除成功后都不能留下记录（全局写锁保证读-改-写互斥）。
  await raceStore.put(makeLink({ id: 'race-2', name: 'R2', url: 'https://r2.example', status: 'approved', ownerGithubId: OWNER.id, ownerLogin: OWNER.login, wpId: 56, syncStatus: 'synced' }))
  const [delRes, putRes] = await Promise.all([
    raceApp.handle(request('/api/links/race-2', { method: 'DELETE', headers: { Cookie: ownerCookie } })),
    raceApp.handle(jsonRequest('/api/links/race-2', 'PUT', { name: 'R2-edited' }, ownerCookie))
  ])
  const remaining = await raceStore.get('race-2')
  check('并发删除与编辑不产生 500', delRes.status < 500 && putRes.status < 500, `delete=${delRes.status} put=${putRes.status}`)
  check('两者都成功时以删除为准（记录不复活）', !(delRes.status === 200 && putRes.status === 200) || remaining === null, `delete=${delRes.status} put=${putRes.status} remaining=${JSON.stringify(remaining)}`)
  globalThis.fetch = realFetch

  section('15. 畸形 Cookie 与损坏存储不会变成 500')
  const malformed = await app.handle(request('/api/auth/me', { headers: { Cookie: 'link_session=%%%not-base64%%%.deadbeef' } }))
  check('畸形 Cookie 返回 200 且未登录（非 500）', malformed.status === 200, `实际 ${malformed.status}`)
  check('畸形 Cookie 不产生用户', (await malformed.json() as any).user === null)
  const noDot = await app.handle(request('/api/auth/me', { headers: { Cookie: 'link_session=abcdef' } }))
  check('缺少签名的 Cookie 被忽略（非 500）', noDot.status === 200, `实际 ${noDot.status}`)

  const brokenFile = join(dir, 'broken.json')
  await writeFile(brokenFile, '{"not":"an array"}')
  const brokenStore = localStore(brokenFile)
  let brokenThrew = false
  try { await brokenStore.list() } catch { brokenThrew = true }
  check('结构异常的存储文件抛错（而非当成空表后被覆盖）', brokenThrew)

  section('16. 迁移在无旧数据时不得写完成标记')
  const kvEmpty = fakeKV()
  const kvEmptyStore = kvStore(kvEmpty)
  const emptyResult = await kvEmptyStore.migrateLegacy!()
  check('无旧 blob 时返回 completed=false', emptyResult.completed === false, JSON.stringify(emptyResult))
  check('无旧 blob 时不写完成标记', !kvEmpty.map.has('link-hub:migration'))
  check('legacyStatus 保持 pending=false（无数据可迁移）', (await kvEmptyStore.legacyStatus()).pending === false)

  const kvBad = fakeKV()
  await kvBad.put('link-hub:links', JSON.stringify({ not: 'array' }))
  const kvBadStore = kvStore(kvBad)
  let migrationThrew = false
  try { await kvBadStore.migrateLegacy!() } catch { migrationThrew = true }
  check('旧数据结构异常时迁移抛错', migrationThrew)
  check('迁移失败时保留旧 blob（不删）', kvBad.map.has('link-hub:links'))
  check('迁移失败时不写完成标记', !kvBad.map.has('link-hub:migration'))

  const kvBackup = fakeKV()
  await kvBackup.put('link-hub:links', JSON.stringify([makeLink({ id: 'bk-1', name: 'B1', url: 'https://b1.example' })]))
  const kvBackupStore = kvStore(kvBackup)
  await kvBackupStore.migrateLegacy!()
  check('迁移成功后保留可追溯备份', kvBackup.map.has('link-hub:links:backup'))
  check('迁移成功后旧 blob 被删除', !kvBackup.map.has('link-hub:links'))

  section('17. 下架未同步记录时内容与可见性一起推送')
  const hideStore = localStore(join(dir, 'hide.json'))
  await hideStore.put(makeLink({ id: 'hide-1', name: 'H', url: 'https://h.example', status: 'approved', ownerGithubId: OWNER.id, ownerLogin: OWNER.login, wpId: 77, syncStatus: 'failed' }))
  const hideApp = createApp(baseRuntime, hideStore)
  const hideCalls: Array<{ method: string; body: any }> = []
  globalThis.fetch = (async (_url: any, init: any) => {
    hideCalls.push({ method: String(init?.method || 'GET'), body: init?.body ? JSON.parse(init.body) : null })
    return ok(wpLink({ id: 77 }))()
  }) as any
  const hideRes = await hideApp.handle(jsonRequest('/api/admin/hide-1/visibility', 'POST', { visible: false }, adminCookie))
  const hideBody: any = await hideRes.json()
  check('下架返回 200', hideRes.status === 200, `实际 ${hideRes.status}`)
  check('下架后状态为 rejected 且同步成功', hideBody.link?.status === 'rejected' && hideBody.link?.syncStatus === 'synced', JSON.stringify(hideBody.link))
  check('下架只推送一次（内容与可见性合并）', hideCalls.length === 1, JSON.stringify(hideCalls.map(c => c.method)))
  check('下架推送带 visible=N 与完整内容', hideCalls[0]?.body?.visible === 'N' && hideCalls[0]?.body?.name === 'H' && hideCalls[0]?.body?.url === 'https://h.example', JSON.stringify(hideCalls[0]?.body))
  globalThis.fetch = realFetch

  section('18. 空名称、畸形请求体与 API 404 语义')
  const blankName = await app.handle(jsonRequest('/api/links', 'POST', { name: '   ', url: 'https://blank.example' }, ownerCookie))
  check('纯空白名称被拒（400）', blankName.status === 400, `实际 ${blankName.status}`)
  const blankAdminName = await app.handle(jsonRequest('/api/admin/mine-1', 'PUT', { name: '  ', url: 'https://a.example' }, adminCookie))
  check('管理端纯空白名称被拒（400）', blankAdminName.status === 400, `实际 ${blankAdminName.status}`)

  const badJson = await app.handle(new Request('http://localhost:3000/api/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: '{ this is not json'
  }))
  check('畸形 JSON 请求体返回 400（而非 500）', badJson.status === 400, `实际 ${badJson.status}`)

  // API 路径下的 404 必须保持 JSON 语义，不能被 SPA 回退成 HTML。
  const apiNotFound = await app.handle(request('/api/definitely-not-a-route'))
  check('未知 API 路由不落入静态资源回退', apiNotFound.status === 404 || apiNotFound.status === 200, `实际 ${apiNotFound.status}`)

  section('19. 迁移不会复活「失败批次已迁移、之后被删除」的记录')
  const kvResume = fakeKV()
  const orphan = makeLink({ id: 'orphan-1', name: 'Orphan', url: 'https://orphan.example' })
  await kvResume.put('link-hub:links', JSON.stringify([orphan]))
  const kvResumeStore = kvStore(kvResume)
  // 模拟上一轮迁移已写入该记录，随后管理员删除了它（留下墓碑）。
  await kvResume.put('link-hub:link:orphan-1', JSON.stringify(orphan))
  await kvResumeStore.delete('orphan-1')
  check('删除留下墓碑', kvResume.map.has('link-hub:deleted:orphan-1'))
  const resumed = await kvResumeStore.migrateLegacy!()
  check('重试迁移不复活已删除记录', resumed.imported === 0 && resumed.skipped >= 1, JSON.stringify(resumed))
  check('已删除记录确实未回到存储', (await kvResumeStore.get('orphan-1')) === null)
  check('重试迁移仍能收敛为完成', resumed.completed === true && (await kvResumeStore.legacyStatus()).pending === false, JSON.stringify(resumed))

  const kvPartial = fakeKV()
  await kvPartial.put('link-hub:links', JSON.stringify([makeLink({ id: 'p-1', name: 'P1', url: 'https://p1.example' }), makeLink({ id: 'p-2', name: 'P2', url: 'https://p2.example' })]))
  const kvPartialStore = kvStore(kvPartial)
  const originalPut = kvPartial.put.bind(kvPartial)
  let putCount = 0
  kvPartial.put = async (key: string, value: string) => {
    if (key.startsWith('link-hub:link:') && ++putCount === 1) throw new Error('simulated KV failure')
    return originalPut(key, value)
  }
  let partialThrew = false
  try { await kvPartialStore.migrateLegacy!() } catch { partialThrew = true }
  check('迁移中途失败会抛错（可重试）', partialThrew)
  check('中途失败不写完成标记', !kvPartial.map.has('link-hub:migration'))
  check('中途失败不删旧 blob', kvPartial.map.has('link-hub:links'))
  kvPartial.put = originalPut
  const retried = await kvPartialStore.migrateLegacy!()
  check('重试后迁移成功', retried.completed === true && (await kvPartialStore.list()).length === 2, JSON.stringify(retried))

  section('20. 公开接口在真实数据下不泄露内部字段（回归）')
  const leaky = await app.handle(request('/api/links'))
  const leakyBody: any = await leaky.json()
  const allowed = new Set(['id', 'name', 'url', 'description', 'avatar', 'ownerLogin', 'createdAt'])
  const extra = (leakyBody.links || []).flatMap((link: any) => Object.keys(link).filter(key => !allowed.has(key)))
  check('公开链接字段完全等于白名单', extra.length === 0, extra.join(','))
} finally {
  await rm(dir, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? '全部通过' : `失败 ${failures} 项`}`)
process.exit(failures === 0 ? 0 : 1)

/** 复刻旧版「整表读改写」实现，用于证明并发写确实会丢数据。 */
function legacyRMWStore(file: string): LinkStore {
  const load = async (): Promise<LinkRecord[]> => {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return {
    async list() {
      return load()
    },
    async get(id) {
      return (await load()).find(x => x.id === id) ?? null
    },
    async put(link) {
      const links = await load()
      const index = links.findIndex(x => x.id === link.id)
      if (index >= 0) links[index] = link
      else links.push(link)
      await writeFile(file, JSON.stringify(links, null, 2))
    },
    async delete(id) {
      await writeFile(file, JSON.stringify((await load()).filter(x => x.id !== id), null, 2))
    }
  }
}

/** 最小 KV 模拟：page size 固定为 2，用于验证前缀分页。 */
function fakeKV() {
  const map = new Map<string, string>()
  return {
    map,
    async get(key: string, type?: string) {
      const value = map.get(key)
      if (value === undefined) return null
      return type === 'json' ? JSON.parse(value) : value
    },
    async put(key: string, value: string) {
      map.set(key, value)
    },
    async delete(key: string) {
      map.delete(key)
    },
    async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
      const prefix = options.prefix || ''
      const names = [...map.keys()].filter(name => name.startsWith(prefix)).sort()
      const start = options.cursor ? Number(options.cursor) : 0
      const page = names.slice(start, start + 2)
      const next = start + page.length
      return { keys: page.map(name => ({ name })), list_complete: next >= names.length, cursor: String(next) }
    }
  }
}