import { Elysia } from 'elysia'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import { createApp } from './app'
import { kvStore } from './kv-store'

export default {
  async fetch(request: Request, env: Record<string, any>) {
    if (!env.LINKS_KV) return new Response('LINKS_KV binding is required in Cloudflare Worker', { status: 500 })
    const response = await new Elysia({ adapter: CloudflareAdapter }).mount(createApp(env, kvStore(env.LINKS_KV)).fetch).compile().handle(request)
    if (response.status !== 404 && response.status !== 405) return response
    return env.ASSETS?.fetch(request) || response
  }
}
