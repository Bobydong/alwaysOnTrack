import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { catalog } from './fixtures/routing.mjs'

test('Render entry honors the host port, preloads schedules, exposes health, and keeps APIs private', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'alwaysontrack-render-'))
  const file = path.join(dir, 'catalog.json')
  await writeFile(file, JSON.stringify(catalog))
  t.after(() => rm(dir, { recursive: true, force: true }))
  Object.assign(process.env, { PORT: '0', MTA_GTFS_CATALOG: file, GOOGLE_MAPS_API_KEY: 'fixture-maps',
    GROQ_API_KEY: 'fixture-groq', AI_PROVIDER: 'groq', DEMO_ACCESS_TOKEN: 'a'.repeat(64) })
  await import('../server/render.mjs')
  const { server } = await import('../server/index.mjs')
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  if (!server.listening) await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  assert.notEqual(server.address().port, 5174)
  assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true })
  assert.equal((await fetch(`${base}/`)).status, 404)
  assert.equal((await fetch(`${base}/api/trips/status`)).status, 401)
  const status = await fetch(`${base}/api/trips/status`, { headers: { authorization: `Bearer ${process.env.DEMO_ACCESS_TOKEN}`, origin: 'null' } })
  assert.equal(status.status, 200)
  assert.equal((await status.json()).catalogAvailable, true)
  assert.equal(status.headers.get('access-control-allow-origin'), 'null')
})
