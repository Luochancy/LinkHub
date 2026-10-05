// Guards the SVG icon pipeline introduced to drop the ~2.2 MB MDI webfont.
//
// The icon map is generated, so the real risks are silent regressions:
// a template gains an `mdi-*` name nobody regenerated, the font creeps back
// into the bundle, or the generator stops failing closed on unknown names.
// Each of those is asserted below.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
function check (name: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function walk (dir: string, acc: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (/\.(vue|ts|html)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

const clientDir = path.join(root, 'src/client')
const generated = fs.readFileSync(path.join(clientDir, 'icons.ts'), 'utf8')

// 1. Every `mdi-*` name referenced by the app must exist in the generated map.
const used = new Set<string>()
for (const file of walk(clientDir)) {
  if (file.endsWith('icons.ts')) continue
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/mdi-[a-z0-9-]+/g)) used.add(m[0])
}
const unmapped = [...used].filter(n => !generated.includes(`'${n}':`))
check('every referenced mdi-* name is in the generated map', unmapped.length === 0, unmapped.join(', '))
check('generated map is non-trivial', used.size >= 10, `only ${used.size} names used`)

// 2. The webfont must be gone from both source and dependencies.
const sources = walk(clientDir)
  .map(f => ({ f, text: fs.readFileSync(f, 'utf8') }))
  .filter(({ text }) => /@mdi\/font|materialdesignicons/.test(text))
check('no @mdi/font import remains in client sources', sources.length === 0, sources.map(s => s.f).join(', '))

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
check('@mdi/font is not a dependency', !pkg.dependencies?.['@mdi/font'])
check('@mdi/js is a dependency', Boolean(pkg.dependencies?.['@mdi/js']))
check('icon map is regenerated before every build', pkg.scripts?.prebuild === 'npm run icons')

// 3. The generator must fail closed: an unknown name has to be a hard error,
//    otherwise a typo would silently render an empty icon.
const probe = path.join(clientDir, '__probe_unmapped.vue')
fs.writeFileSync(probe, '<template><v-icon icon="mdi-definitely-not-a-real-icon-xyz" /></template>\n')
let failedClosed = false
try {
  execFileSync('node', ['scripts/gen-icons.mjs'], { cwd: root, stdio: 'pipe' })
} catch {
  failedClosed = true
} finally {
  fs.unlinkSync(probe)
  // Restore the map the probe's failure stopped us from writing.
  execFileSync('node', ['scripts/gen-icons.mjs'], { cwd: root, stdio: 'pipe' })
}
check('generator exits non-zero on an unmapped icon name', failedClosed)

// 4. Built output must contain no font payload and no leftover font classes.
const assetsDir = path.join(root, 'public/assets')
if (fs.existsSync(assetsDir)) {
  const files = fs.readdirSync(assetsDir, { recursive: true }) as string[]
  const fonts = files.filter(f => /\.(woff2?|ttf|eot)$/i.test(f))
  check('built assets contain no font files', fonts.length === 0, fonts.join(', '))
  const css = files.filter(f => f.endsWith('.css'))
    .map(f => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
    .join('\n')
  check('built CSS has no Material Design Icons font-face', !/Material Design Icons/i.test(css))
} else {
  console.log('  skip built-asset checks (run `npm run build` first)')
}

if (failures) {
  console.error(`\nicons: ${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nicons: all checks passed')