/**
 * 真实 HTTP 端到端测试：直接打运行中的本地服务，验证完整审核链路。
 * 用法：npx tsx scripts/e2e-live.ts
 */
import { readFile } from 'node:fs/promises'
import { sessionCookie } from '../src/server/session'

const BASE = 'http://localhost:3000'
const envFile = await readFile('.env', 'utf8')
const env: Record<string, string> = {}
for (const line of envFile.split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/)
  if (match) env[match[1]] = match[2].trim()
}
const runtime = { ...env, APP_URL: BASE } as Record<string, any>

const firstOf = (value: string) => (value || '').split(',').map(x => x.trim()).filter(Boolean)[0] || ''
// 管理身份必须与 .env 里配置的 ADMIN_GITHUB_IDS / ADMIN_GITHUB_LOGINS 真正匹配，
// 否则会拿到一个「已登录但非管理员」的会话，把 403 误判成 200 通过。
const adminCookie = await sessionCookie({ id: firstOf(env.ADMIN_GITHUB_IDS) || '1', login: firstOf(env.ADMIN_GITHUB_LOGINS) || 'e2e-admin' }, runtime)
const plainCookie = await sessionCookie({ id: 'not-an-admin', login: 'not-an-admin' }, runtime)

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`  ok  ${name}`)
  else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
async function call(path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, init)
  const text = await response.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { body = text.slice(0, 200) }
  return { status: response.status, body }
}
const asAdmin = (path: string, init: RequestInit = {}) => call(path, { ...init, headers: { ...(init.headers || {}), Cookie: adminCookie } })

try {
  console.log('真实服务端到端（http://localhost:3000）\n')

  console.log('公开接口')
  const links = await call('/api/links')
  check('GET /api/links 返回 200 与数组', links.status === 200 && Array.isArray(links.body?.links), JSON.stringify(links.body).slice(0, 120))
  const leaked = ['ownerGithubId', 'wpId', 'syncError', 'syncStatus', 'ownerAssignedBy']
  const leakedFields = links.body?.links?.flatMap((l: any) => leaked.filter(k => k in l)) ?? []
  check('公开列表不含内部字段', leakedFields.length === 0, leakedFields.join(','))

  console.log('\n鉴权边界')
  for (const [method, path] of [['GET', '/api/admin/links'], ['GET', '/api/admin/pending'], ['GET', '/api/admin/unowned'], ['GET', '/api/admin/storage'], ['POST', '/api/admin/import'], ['POST', '/api/admin/migrate']] as const) {
    const res = await call(path, { method })
    check(`${method} ${path} 匿名 401`, res.status === 401, `实际 ${res.status}`)
  }
  const authed = await asAdmin('/api/admin/links')
  check('管理员签名 Cookie 可访问 /api/admin/links', authed.status === 200, `实际 ${authed.status} body=${JSON.stringify(authed.body).slice(0, 120)}`)
  const forged = await call('/api/admin/links', { headers: { Cookie: 'link_session=eyJpZCI6IjEifQ.forged' } })
  check('伪造 Cookie 被拒', forged.status === 401, `实际 ${forged.status}`)
  // 已登录但非管理员必须 403；曾因 requireAdmin 未设置状态码而返回 200 + 错误体。
  const nonAdmin = await call('/api/admin/links', { headers: { Cookie: plainCookie } })
  check('已登录的非管理员返回 403（而非 200）', nonAdmin.status === 403, `实际 ${nonAdmin.status} body=${JSON.stringify(nonAdmin.body)}`)
  const nonAdminStorage = await call('/api/admin/storage', { headers: { Cookie: plainCookie } })
  check('非管理员访问 /api/admin/storage 返回 403', nonAdminStorage.status === 403, `实际 ${nonAdminStorage.status}`)

  console.log('\n存储迁移接口')
  const storage = await asAdmin('/api/admin/storage')
  check('GET /api/admin/storage 返回 200', storage.status === 200, `实际 ${storage.status}`)
  check('返回 migratable 字段', typeof storage.body?.migratable === 'boolean', JSON.stringify(storage.body))
  // 本地 JSON 存储没有旧 blob，迁移接口应明确报告「不需要迁移」，而不是报服务器错误。
  const migrate = await asAdmin('/api/admin/migrate', { method: 'POST' })
  check('POST /api/admin/migrate 语义正确（本地存储无需迁移）', migrate.status === 200 || migrate.status === 400, `实际 ${migrate.status} ${JSON.stringify(migrate.body)}`)

  console.log('\n输入校验')
  const badCreate = await call('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) })
  check('匿名提交 401（先于校验）', badCreate.status === 401, `实际 ${badCreate.status}`)

  console.log('\nSPA 与静态资源')
  for (const path of ['/', '/admin', '/mine']) {
    const res = await fetch(`${BASE}${path}`)
    const type = res.headers.get('content-type') || ''
    check(`${path} 返回 HTML`, res.status === 200 && type.includes('text/html'), `${res.status} ${type}`)
  }
} finally {
  console.log(`\n${failures === 0 ? '端到端全部通过' : `端到端失败 ${failures} 项`}`)
}
process.exit(failures === 0 ? 0 : 1)