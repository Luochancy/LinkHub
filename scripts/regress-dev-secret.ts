/**
 * 回归验证：会话密钥引导（src/server/bootstrap.ts）。
 * 运行：npx tsx scripts/regress-dev-secret.ts
 *
 * 背景：曾出现「node.ts 注入开发密钥、但 sessionSecret 又拒绝该值」的组合，
 * 导致本地登录必然 500。这里锁住入口行为，包括「生产未配置密钥必须拒绝启动」。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/server/app'
import { isEphemeralSecretAllowed, resolveSessionSecret } from '../src/server/bootstrap'
import { localStore } from '../src/server/local-store'
import { readSession, sessionCookie } from '../src/server/session'

let failures = 0
const check = (name: string, condition: boolean, detail = '') => {
  if (condition) console.log(`  ok  ${name}`)
  else { failures++; console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
const base: Record<string, string> = { APP_URL: 'http://localhost:3000' }

console.log('会话密钥引导\n')

check('未配置密钥且未声明开发环境时，不允许临时密钥', !isEphemeralSecretAllowed(base))
let threw = false
try { resolveSessionSecret(base) } catch { threw = true }
check('未配置密钥 + 未声明开发环境 → 报错（拒绝启动）', threw)

// NODE_ENV=production 即使显式开启开关也必须拒绝，避免「忘了删开关」上生产。
threw = false
try { resolveSessionSecret({ ...base, NODE_ENV: 'production', ALLOW_EPHEMERAL_SESSION_SECRET: 'true' }) } catch { threw = true }
check('NODE_ENV=production 时拒绝一切临时密钥', threw)

const dev = resolveSessionSecret({ ...base, NODE_ENV: 'development' })
check('NODE_ENV=development 允许临时密钥', dev.ephemeral === true && dev.secret.length >= 16)
const viaFlag = resolveSessionSecret({ ...base, ALLOW_EPHEMERAL_SESSION_SECRET: 'true' })
check('显式开关允许临时密钥', viaFlag.ephemeral === true && viaFlag.secret.length >= 16)
check('两次临时密钥互不相同（不是固定常量）', dev.secret !== viaFlag.secret)

const configured = resolveSessionSecret({ ...base, SESSION_SECRET: 'k'.repeat(40) })
check('已配置密钥时不使用临时密钥', configured.ephemeral === false && configured.secret === 'k'.repeat(40))
threw = false
try { resolveSessionSecret({ ...base, SESSION_SECRET: 'local-development-secret' }) } catch { threw = true }
check('拒绝历史公开默认值', threw)
threw = false
try { resolveSessionSecret({ ...base, SESSION_SECRET: 'short' }) } catch { threw = true }
check('拒绝过短密钥', threw)

const env = { ...base, ...dev, SESSION_SECRET: dev.secret }
const cookie = await sessionCookie({ id: '999', login: 'admin' }, env)
const user = await readSession(new Request('http://localhost:3000/api/auth/me', { headers: { Cookie: cookie } }), env)
check('临时密钥下会话可签发与读取', user?.id === '999', JSON.stringify(user))

const dir = await mkdtemp(join(tmpdir(), 'linkhub-devsecret-'))
try {
  const app = createApp({ ...env, ADMIN_GITHUB_IDS: '999' }, localStore(join(dir, 'links.json')))
  const me = await app.handle(new Request('http://localhost:3000/api/auth/me', { headers: { Cookie: cookie } }))
  const body: any = await me.json()
  check('/api/auth/me 认得该会话', body.user?.id === '999', JSON.stringify(body))
  check('管理员身份被识别', body.isAdmin === true, JSON.stringify(body))
} finally {
  await rm(dir, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? '回归全部通过' : `回归失败 ${failures} 项`}`)
process.exit(failures === 0 ? 0 : 1)