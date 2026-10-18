import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { loadEnv } from 'vite'

const env = loadEnv('beta', process.cwd(), '')
if (!env.COMPANION_URL || !env.DEMO_ACCESS_TOKEN) throw new Error('Run beta:configure first.')
const headers = { Authorization: `Bearer ${env.DEMO_ACCESS_TOKEN}`, Origin: 'null' }
const get = (path, options = {}) => fetch(`${env.COMPANION_URL}${path}`, { ...options, signal: AbortSignal.timeout(30000) })
const root = await get('/')
assert.equal(root.status, 404, 'The public tunnel must not serve frontend assets.')
const denied = await get('/api/agent/status')
assert.equal(denied.status, 401, 'Unauthenticated API requests must be denied.')
const preflight = await get('/api/speech/transcribe', { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } })
assert.equal(preflight.status, 204, 'Packaged WebView preflight must succeed.')
assert.equal(preflight.headers.get('access-control-allow-origin'), 'null')
for (const endpoint of ['/api/agent/status', '/api/trips/status']) {
  const response = await get(endpoint, { headers })
  assert.equal(response.status, 200, `${endpoint} must be reachable with beta access.`)
  assert.equal(response.headers.get('access-control-allow-origin'), 'null')
  const status = await response.json()
  console.log(`${endpoint}: ${JSON.stringify(status)}`)
}
const manifest = JSON.parse(await readFile('release/app.json', 'utf8'))
assert.deepEqual(manifest.permissions.find(p => p.name === 'network').whitelist, [env.COMPANION_URL])
const assets = (await readdir('dist/assets')).filter(p => p.endsWith('.js'))
const bundle = (await Promise.all(assets.map(p => readFile(`dist/assets/${p}`, 'utf8')))).join('\n')
assert.ok(bundle.includes(env.COMPANION_URL), 'The beta bundle must use its configured backend.')
assert.ok(bundle.includes(env.DEMO_ACCESS_TOKEN), 'The private beta must have its access token.')
for (const name of ['GOOGLE_MAPS_API_KEY', 'GOOGLE_PLACES_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY']) {
  if (env[name]?.length > 8) assert.ok(!bundle.includes(env[name]), `${name} must never appear in the frontend bundle.`)
}
console.log('Beta networking, access checks, whitelist, and provider-key exclusion passed. No paid provider requests were made. Physical G2 speech and motion still require an installed-beta test.')
