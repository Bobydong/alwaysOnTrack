import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agentApi } from '../server/agent-api.mjs'
import { createRoutePlanner } from '../server/route-service.mjs'
import { runTripAgent } from '../server/trip-agent.mjs'
import { geminiClient, validateSpeechWav, transcribeSpeech } from '../server/gemini.mjs'
import { pcmToWav } from '../src/asr/stt.ts'
import { StationTracker, demoSettings } from '../src/station-tracker.ts'
import { catalog, request, googleResponse } from './fixtures/routing.mjs'

const call = (name, args) => ({ role: 'model', parts: [{ thoughtSignature: 'fixture-signature', functionCall: { id: 'fixture-call', name, args } }] })
async function invoke(api, url, body, headers = {}) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
  const req = Readable.from([raw]); req.url = url; req.method = 'POST'
  req.headers = { host: 'localhost:5173', origin: 'http://localhost:5173', 'content-type': 'application/json', ...headers }
  let code, data
  await api(req, { writeHead(c) { code = c }, end(text) { data = JSON.parse(text) } }, () => assert.fail('Unexpected fallthrough'))
  return { code, data }
}

test('agent asks for missing origin without calling Google', async () => {
  let asked
  const result = await runTripAgent({ body: { messages: [{ role: 'user', text: 'Take me to Union Square' }] },
    generate: async body => { asked = body; return call('ask_question', { question: 'Where are you starting from?' }) },
    planner: { plan: () => assert.fail('Cannot route without both endpoints') } })
  assert.equal(result.message, 'Where are you starting from?'); assert.equal(result.plans.length, 0)
  assert.deepEqual(asked.toolConfig.functionCallingConfig.allowedFunctionNames, ['ask_question', 'find_subway_routes'])
})

test('speech -> Gemini route tool -> Google/MTA -> recommendation -> demo tracker preserves scheduled provenance', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'alwaysontrack-agent-')), file = path.join(dir, 'catalog.json')
  await writeFile(file, JSON.stringify(catalog)); t.after(async () => { await unlink(file); await rmdir(dir) })
  let geminiCalls = 0, googleCalls = 0, signedContent
  const planner = createRoutePlanner({ apiKey: 'fixture-maps-secret', catalogPath: file, fetchImpl: async () => {
    googleCalls++; return { ok: true, json: async () => googleResponse }
  } })
  // Freeze departure time to the fixture's service day, independent of the test clock.
  const fixturePlanner = { plan: body => planner.plan({ ...body, departureTime: request.departureTime }) }
  const api = agentApi({ apiKey: 'fixture-gemini-secret', planner: fixturePlanner, fetchImpl: async (url, options) => {
    geminiCalls++; assert.equal(options.headers['x-goog-api-key'], 'fixture-gemini-secret')
    const body = JSON.parse(options.body)
    if (geminiCalls === 1) {
      assert.equal(body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON')
      assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'audio/wav')
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: 'From Fixture origin to Fixture destination' }) }] } }] }) }
    }
    if (geminiCalls === 2) {
      signedContent = call('find_subway_routes', { origin: request.origin, destination: request.destination })
      return { ok: true, json: async () => ({ candidates: [{ content: signedContent }] }) }
    }
    assert.deepEqual(body.contents.at(-2), signedContent)
    assert.equal(body.contents.at(-1).parts[0].functionResponse.id, 'fixture-call')
    assert.deepEqual(body.contents.at(-1).parts[0].functionResponse.response.routes[0].rides[0].stations, ['Alpha', 'Bravo', 'Charlie'])
    return { ok: true, json: async () => ({ candidates: [{ content: call('recommend_route', { index: 0 }) }] }) }
  } })
  const speech = await invoke(api, '/api/speech/transcribe', Buffer.from(pcmToWav([new Uint8Array(8000).fill(1)])), { 'content-type': 'audio/wav' })
  assert.equal(speech.code, 200)
  const planned = await invoke(api, '/api/agent/turn', { messages: [{ role: 'user', text: speech.data.text }] })
  assert.equal(planned.code, 200); assert.equal(planned.data.recommendedId, planned.data.plans[0].id)
  const tracker = new StationTracker(); tracker.loadTripPlan(planned.data.plans[0], demoSettings, 0, 12)
  assert.equal(tracker.state, 'ready'); assert.equal(tracker.demoTravelSeconds, 12)
  assert.deepEqual(tracker.route.map(s => s.travelSeconds), [0, 12, 12, 12])
  assert.deepEqual(tracker.tripPlan.legs[0].stops.map(s => s.travelSeconds), [0, 120, 100])
  assert.equal(tracker.route[2].transfer, true); assert.equal(tracker.snapshot().demoTravelSeconds, 12)
  tracker.arm(0); tracker.correct(2, 100); assert.equal(tracker.state, 'waiting-boarding')
  tracker.arm(200); assert.equal(tracker.state, 'waiting-departure')
  assert.equal(geminiCalls, 3); assert.equal(googleCalls, 1)
  assert.ok(!JSON.stringify(planned.data).includes('fixture-gemini-secret'))
})

test('unknown or parallel tool calls are rejected; invalid recommendations cannot replace verified plans', async () => {
  const body = { messages: [{ role: 'user', text: 'Go from A to B' }] }
  for (const content of [call('run_script', { code: 'bad' }), { parts: [...call('ask_question', {}).parts, ...call('find_subway_routes', {}).parts] }]) {
    await assert.rejects(runTripAgent({ body, generate: async () => content, planner: { plan: () => assert.fail() } }), /unsupported action/)
  }
  let calls = 0
  const plans = [{ id: 'real', origin: 'A', destination: 'B', legs: [], departureTime: '2026-10-18T12:00:00Z', arrivalTime: '2026-10-18T12:10:00Z' }]
  const result = await runTripAgent({ body, planner: { plan: async () => ({ plans, rejected: [] }) }, generate: async () =>
    ++calls === 1 ? call('find_subway_routes', { origin: 'A', destination: 'B' }) : call('recommend_route', { index: 999 }) })
  assert.equal(result.recommendedId, null); assert.deepEqual(result.plans, plans)
})

test('API rejects foreign origins, malformed audio/history and missing keys before making provider calls', async () => {
  const api = agentApi({ apiKey: 'fixture', planner: {}, fetchImpl: () => assert.fail('No provider request expected') })
  assert.equal((await invoke(api, '/api/agent/turn', {}, { origin: 'https://foreign.example' })).code, 403)
  assert.equal((await invoke(api, '/api/agent/turn', { messages: [{ role: 'system', text: 'bad' }] })).code, 400)
  assert.equal((await invoke(api, '/api/speech/transcribe', Buffer.alloc(44), { 'content-type': 'audio/wav' })).code, 400)
  const missing = agentApi({ planner: {} })
  assert.equal((await invoke(missing, '/api/agent/turn', { messages: [] })).code, 503)
  assert.throws(() => validateSpeechWav(Buffer.alloc(1)), /Expected/)
})

test('Gemini errors are actionable and do not expose provider response bodies or credentials', async () => {
  const generate = geminiClient({ apiKey: 'fixture-secret', fetchImpl: async () => ({ ok: false, status: 429 }) })
  await assert.rejects(generate({}), e => e.status === 429 && !e.message.includes('fixture-secret'))
})

test('completely silent microphone audio is rejected without asking Gemini to invent a transcript', async () => {
  await assert.rejects(transcribeSpeech(() => assert.fail('Silent audio must not reach Gemini'),
    Buffer.from(pcmToWav([new Uint8Array(8000)]))), e => e.status === 422 && /silent/.test(e.message))
})
