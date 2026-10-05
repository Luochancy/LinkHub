import { Elysia } from 'elysia'
import { WebStandardAdapter } from 'elysia/adapter/web-standard'
import { env } from 'cloudflare:workers'
import { createApp } from './app'
import { kvStore } from './kv-store'

const workerApp = new Elysia({ adapter: WebStandardAdapter, aot: false })
  .mount(createApp(env, kvStore(env.LINKS_KV)).fetch)
  .compile()

export default {
  async fetch(request: Request, env: Record<string, any>) {
    if (!env.LINKS_KV) return new Response('LINKS_KV binding is required in Cloudflare Worker', { status: 500 })
    const response = await workerApp.handle(request)
    // 业务 404（例如编辑不存在的记录、修改他人记录）必须原样返回 JSON 与状态码，
    // 不能回退到静态资源，否则生产环境会把它变成一张 HTML 页面。
    if (new URL(request.url).pathname.startsWith('/api/')) return response
    if (response.status !== 404 && response.status !== 405) return response
    return env.ASSETS?.fetch(request) || response
  }
}
