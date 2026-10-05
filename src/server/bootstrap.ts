import { randomBytes } from 'node:crypto'
import { assertSessionSecret } from './session'
import type { RuntimeEnv } from './config'

export type SecretBootstrap = { secret: string; ephemeral: boolean }

/**
 * 是否允许使用「本次进程临时生成的随机密钥」。
 *
 * 只有在**明确声明**是开发环境时才允许：要么 NODE_ENV=development，要么显式设置
 * ALLOW_EPHEMERAL_SESSION_SECRET=true（本地 dev 脚本会设置它）。
 *
 * 刻意不采用「NODE_ENV 不等于 production 就算开发」这种判断：生产环境用 Node 部署时
 * 常常根本不设 NODE_ENV，那会静默启用临时密钥 —— 多实例各自生成不同密钥，会话会随
 * 请求落点随机失效，单实例重启则全部会话失效，且与「生产必须显式配置」的承诺矛盾。
 */
export function isEphemeralSecretAllowed(runtime: RuntimeEnv) {
  // 生产环境永远不允许临时密钥，即便开关被误配成 true 也拒绝：
  // 多实例会各自生成不同密钥，会话随请求落点随机失效。
  if (runtime.NODE_ENV === 'production') return false
  return runtime.NODE_ENV === 'development' || String(runtime.ALLOW_EPHEMERAL_SESSION_SECRET || '').toLowerCase() === 'true'
}

/**
 * 解析会话密钥。
 *
 * 已配置则走严格校验（长度 / 拒绝历史公开默认值）；未配置时只有明确声明开发环境才
 * 生成临时密钥，否则报错由调用方决定如何终止。抽成纯函数是为了能直接测试入口行为，
 * 不必启动真实进程。
 */
export function resolveSessionSecret(runtime: RuntimeEnv): SecretBootstrap {
  const configured = runtime.SESSION_SECRET
  if (configured) {
    assertSessionSecret(runtime)
    return { secret: configured, ephemeral: false }
  }
  if (!isEphemeralSecretAllowed(runtime)) {
    throw new Error(
      '缺少 SESSION_SECRET 环境变量：生产环境必须配置随机密钥（openssl rand -base64 32）。' +
      '本地开发请在 .env 中配置，或设置 NODE_ENV=development / ALLOW_EPHEMERAL_SESSION_SECRET=true 以允许临时密钥。'
    )
  }
  return { secret: randomBytes(32).toString('base64'), ephemeral: true }
}