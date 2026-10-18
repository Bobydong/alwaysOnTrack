import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { imuStorage } from './imu-storage.mjs'

async function request(root, payload, options = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(payload))])
  Object.assign(req, { url: '/__imu/recordings', method: 'POST',
    headers: { host: 'localhost:5173', origin: 'http://localhost:5173', 'content-type': 'application/json', ...options } })
  let status, body
  await imuStorage(root)(req, { writeHead(code) { status = code }, end(text) { body = JSON.parse(text) } }, () => assert.fail('Unexpected next'))
  return { status, body }
}

test('saves exact JSON bytes with a server-generated filename, ignoring client paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'imu-export-test-'))
  const content = JSON.stringify({ schemaVersion: 1, samples: [{ x: 0, y: null, z: 1 }] })
  const result = await request(root, { filename: '../../escape.json', content })
  assert.equal(result.status, 201)
  assert.match(result.body.saved, /^recordings\/g2-imu-[\w.:-]+\.json$/)
  assert.equal(await readFile(path.join(root, result.body.saved), 'utf8'), content)
  assert.equal((await readdir(path.join(root, 'recordings'))).length, 1)
})
test('rejects other origins before writing', async () => {
  const result = await request('/unused', { filename: 'capture.json', content: '{}' }, { origin: 'https://elsewhere.example' })
  assert.equal(result.status, 403)
})
test('rejects malformed recording and unsupported extensions', async () => {
  assert.equal((await request('/unused', { filename: 'capture.json', content: '{}' })).status, 400)
  assert.equal((await request('/unused', { filename: 'capture.exe', content: 'text' })).status, 400)
})
test('saves CSV without changing labels or newlines', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'imu-export-test-'))
  const content = 'x,label\r\n0,"head turn"\r\n'
  const result = await request(root, { filename: 'capture.csv', content })
  assert.equal(result.status, 201)
  assert.equal(await readFile(path.join(root, result.body.saved), 'utf8'), content)
})
