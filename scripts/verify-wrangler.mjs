import { readFile } from 'node:fs/promises'

const files = ['wrangler.toml', 'wrangler.toml.example']
let failed = false

function check(name, condition) {
  console.log(`${condition ? '  ok ' : 'FAIL '} ${name}`)
  if (!condition) failed = true
}

console.log('\nCloudflare 部署配置保护')
for (const file of files) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
  check(`${file} 声明 Worker 入口`, /^main\s*=\s*["']src\/server\/worker\.ts["']/m.test(source))
  check(`${file} 声明静态资源 binding`, /^binding\s*=\s*["']ASSETS["']/m.test(source))
  check(`${file} 启用 keep_vars`, /^keep_vars\s*=\s*true\s*$/m.test(source))
  check(`${file} 不含 [vars]（避免覆盖 Dashboard 变量）`, !/^\s*\[vars\]\s*$/m.test(source))
}

if (failed) process.exit(1)
