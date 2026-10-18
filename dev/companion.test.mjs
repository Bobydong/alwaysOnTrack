import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { createCompanionFetch } from '../src/companion.ts'
import { demoAccess } from '../server/demo-access.mjs'
import { agentApi } from '../server/agent-api.mjs'
import { plannerApi } from '../server/planner-api.mjs'

const token = 'a'.repeat(64)
test('packaged client sends both WAV and planning to configured backend without losing cancellation', async () => {
  const requests = [], abort = new AbortController(), audio = new Blob(['fixture'], { type: 'audio/wav' })
  const send = createCompanionFetch({ url: 'https://demo.example/', token }, async (url, init) => { requests.push({ url, init }); return new Response('{}') })
  await send('/api/speech/transcribe', { method: 'POST', body: audio, signal: abort.signal, headers: { 'Content-Type': 'audio/wav' } })
  await send('/api/agent/intent', { method: 'POST', body: '{"text":"fixture"}', headers: { 'Content-Type': 'application/json' } })
  assert.equal(requests[0].url, 'https://demo.example/api/speech/transcribe')
  assert.equal(requests[0].init.headers.get('Authorization'), `Bearer ${token}`)
  assert.equal(requests[0].init.headers.get('Content-Type'), 'audio/wav')
  assert.equal(requests[0].init.body, audio); assert.equal(requests[0].init.signal, abort.signal)
  assert.equal(requests[1].url, 'https://demo.example/api/agent/intent')
  assert.equal(requests[1].init.credentials, 'omit')
  assert.throws(() => send('https://unrelated.example/api/key'), /\/api\//)
})

test('local client retains relative API paths and no authorization by default', async () => {
  await createCompanionFetch({}, async (url, init) => {
    assert.equal(url, '/api/agent/status'); assert.equal(init.headers.has('Authorization'), false)
    return new Response('{}')
  })('/api/agent/status')
})

test('beta API supports opaque WebView origins but requires a token for status and paid requests', async () => {
  const access = demoAccess(token)
  for (const origin of ['null', 'https://webview.example', undefined]) {
    assert.doesNotThrow(() => access.authorize({ method: 'POST', headers: { origin, authorization: `Bearer ${token}` } }))
    assert.throws(() => access.authorize({ method: 'POST', headers: { origin } }), /access/)
  }
  for (const api of [agentApi({ apiKey: 'fixture', authorize: access.authorize, planner: {} }), plannerApi({ planner: { status: async () => ({ configured: true }) }, authorize: access.authorize })]) {
    for (const url of ['/api/agent/status', '/api/trips/status']) {
      let status, fellThrough = false
      await api({ url, method: 'GET', headers: {} }, { writeHead(code) { status = code }, end() {} }, () => { fellThrough = true })
      if (!fellThrough) assert.equal(status, 401)
    }
  }
  const api = plannerApi({ planner: { plan: async () => ({ plans: ['fixture'] }) }, authorize: access.authorize })
  const req = Readable.from([Buffer.from('{}')])
  Object.assign(req, { url: '/api/trips/plan', method: 'POST', headers: { origin: 'null', authorization: `Bearer ${token}`, 'content-type': 'application/json' } })
  await api(req, { writeHead(code) { assert.equal(code, 200) }, end(body) { assert.deepEqual(JSON.parse(body).plans, ['fixture']) } }, () => assert.fail())
})

test('CORS permits authenticated-client headers, refuses unsupported headers, and keeps local mode closed', () => {
  const access = demoAccess(token), headers = new Map()
  let status
  const res = { setHeader(k, v) { headers.set(k, v) }, writeHead(code) { status = code }, end() {} }
  const req = { url: '/api/speech/transcribe', method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } }
  assert.equal(access.cors(req, res), true); assert.equal(status, 204)
  assert.equal(headers.get('Access-Control-Allow-Origin'), 'null')
  req.headers['access-control-request-headers'] = 'cookie'
  access.cors(req, res); assert.equal(status, 403)
  assert.equal(demoAccess().cors(req, res), false)
  assert.throws(() => demoAccess().authorize({ method: 'POST', headers: { origin: 'null', host: 'localhost:5173' } }), /Same-origin/)
})
