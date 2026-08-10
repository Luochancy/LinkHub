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
    if (response.status !== 404 && response.status !== 405) return response
    return env.ASSETS?.fetch(request) || response
  }
}
