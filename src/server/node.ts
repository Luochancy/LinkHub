import { Elysia } from 'elysia'
import { node } from '@elysia/node'
import { createApp } from './app'
import { localStore } from './local-store'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.PORT || 3000)
for (const envFile of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(new URL(`../../${envFile}`, import.meta.url), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (match && (envFile === '.env.local' || !process.env[match[1]])) process.env[match[1]] = match[2]
    }
  } catch {}
}
const root = join(fileURLToPath(new URL('../../public', import.meta.url)))
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
const assets = { fetch: async (request: Request) => { const url = new URL(request.url); const requested = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, ''); try { const file = await readFile(join(root, requested)); return new Response(file, { headers: { 'Content-Type': mime[extname(requested)] || 'application/octet-stream' } }) } catch { try { const file = await readFile(join(root, 'index.html')); return new Response(file, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) } catch { return new Response('Build the frontend first', { status: 404 }) } } } }
const store = localStore(join(fileURLToPath(new URL('../../data', import.meta.url)), 'links.json'))
new Elysia({ adapter: node() }).mount(createApp({ ASSETS: assets }, store).fetch).listen(port)
console.log(`Link Manager running at http://localhost:${port}`)
