import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { loadEnv } from 'vite'

const env = loadEnv('beta', process.cwd(), '')
let url
try { url = new URL(env.COMPANION_URL) } catch { throw new Error('Run npm run beta:configure -- https://YOUR-BACKEND-HOST first.') }
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('COMPANION_URL must be an HTTPS origin.')
if (!/^[a-f0-9]{64}$/.test(env.DEMO_ACCESS_TOKEN || '')) throw new Error('Configure a private-beta access token first.')
function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
run('node_modules/typescript/bin/tsc', ['--noEmit'])
run('node_modules/vite/bin/vite.js', ['build', '--mode', 'beta'])
const manifest = JSON.parse(await readFile('app.json', 'utf8'))
manifest.package_id = env.EVENHUB_PACKAGE_ID || 'com.alwaysontrack.subway'
manifest.permissions = manifest.permissions.map(p => p.name === 'network' ? { ...p, whitelist: [url.origin] } : p)
await mkdir('release', { recursive: true })
await writeFile('release/app.json', JSON.stringify(manifest, null, 2) + '\n')
const sdk = JSON.parse(await readFile('node_modules/@evenrealities/even_hub_sdk/package.json', 'utf8'))
run('node_modules/@evenrealities/evenhub-cli/main.js', ['pack', 'release/app.json', 'dist', '-o', 'release/alwaysontrack.ehpk', '--sdk-ver', sdk.version])
console.log('Private beta: release/alwaysontrack.ehpk. The package contains the demo access token, never provider keys. Distribute only to your invited testers.')
