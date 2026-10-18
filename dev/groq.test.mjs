import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { groqClient, groqTranscriber } from '../server/groq.mjs'
import { agentOptions } from '../server/ai-config.mjs'
import { agentApi } from '../server/agent-api.mjs'
import { pcmToWav } from '../src/asr/stt.ts'
import { runTripAgent } from '../server/trip-agent.mjs'
import { googlePlans } from '../src/google-routes.ts'
import { catalog, request, googleResponse } from './fixtures/routing.mjs'

const tool = (name, args, id = 'call-fixture') => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'tool_calls',
  message: { tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }) })

test('provider selection uses only the selected key and honors explicit Gemini configuration', () => {
  const env = { GROQ_API_KEY: 'groq-secret', GEMINI_API_KEY: 'gemini-secret' }
  assert.equal(agentOptions(env, {}).provider, 'groq'); assert.equal(agentOptions(env, {}).apiKey, 'groq-secret')
  assert.equal(agentOptions({ ...env, AI_PROVIDER: 'gemini' }, {}).apiKey, 'gemini-secret')
  assert.equal(agentOptions({}, {}).provider, 'gemini')
  assert.throws(() => agentOptions({ AI_PROVIDER: 'invalid' }, {}), /AI_PROVIDER/)
})

test('Groq transcription sends the exact WAV multipart upload and validates the transcript', async () => {
  const wav = Buffer.from(pcmToWav([new Uint8Array(8000).fill(3)]))
  const transcribe = groqTranscriber({ apiKey: 'fixture', fetchImpl: async (url, options) => {
    assert.ok(url.endsWith('/audio/transcriptions')); assert.equal(options.headers.Authorization, 'Bearer fixture')
    assert.equal(options.headers['Content-Type'], undefined, 'FormData must supply its own multipart boundary')
    assert.equal(options.body.get('model'), 'whisper-large-v3-turbo'); assert.equal(options.body.get('language'), 'en')
    assert.deepEqual(Buffer.from(await options.body.get('file').arrayBuffer()), wav)
    return { ok: true, json: async () => ({ text: ' Wall Street to Bronx Zoo ' }) }
  } })
  assert.deepEqual(await transcribe(wav), { text: 'Wall Street to Bronx Zoo' })
  const silent = groqTranscriber({ apiKey: 'fixture', fetchImpl: () => assert.fail('Silence must not upload') })
  await assert.rejects(silent(Buffer.from(pcmToWav([new Uint8Array(8000)]))), e => e.status === 422)
})

test('Groq tool adapter filters allowed tools and preserves IDs through route-tool feedback', async () => {
  const plans = googlePlans(googleResponse, request, catalog).plans
  let calls = 0
  const generate = groqClient({ apiKey: 'fixture', fetchImpl: async (url, options) => {
    assert.ok(url.endsWith('/chat/completions'))
    const body = JSON.parse(options.body); calls++
    assert.equal(body.model, 'openai/gpt-oss-120b'); assert.equal(body.parallel_tool_calls, false)
    if (calls === 1) {
      assert.deepEqual(body.tools.map(t => t.function.name), ['ask_question', 'find_subway_routes'])
      assert.equal(body.tool_choice, 'required')
      return tool('find_subway_routes', { origin: request.origin, destination: request.destination })
    }
    assert.deepEqual(body.tools.map(t => t.function.name), ['recommend_route'])
    assert.equal(body.messages.at(-2).tool_calls[0].id, 'call-fixture')
    assert.equal(body.messages.at(-1).tool_call_id, 'call-fixture')
    assert.equal(body.messages.at(-1).role, 'tool')
    assert.ok(JSON.parse(body.messages.at(-1).content).routes.length)
    return tool('recommend_route', { index: 0 }, 'rank-fixture')
  } })
  const result = await runTripAgent({ generate, planner: { plan: async () => ({ plans }) },
    body: { messages: [{ role: 'user', text: 'From Alpha to Delta' }] } })
  assert.equal(result.recommendedId, plans[0].id); assert.equal(calls, 2)
})

test('Groq rate-limit/provider errors are sanitized and no automatic retry occurs', async () => {
  for (const status of [429, 401, 503]) {
    let calls = 0
    const transcribe = groqTranscriber({ apiKey: 'fixture-secret', fetchImpl: async () => {
      calls++; return { ok: false, status, json: () => assert.fail('Provider response body must not reach the user') }
    } })
    await assert.rejects(transcribe(Buffer.from(pcmToWav([new Uint8Array(8000).fill(1)]))), e =>
      e.status === (status === 429 ? 429 : 502) && !e.message.includes('fixture-secret'))
    assert.equal(calls, 1)
  }
})

test('Groq rejects unsupported tool actions and invalid JSON arguments', async () => {
  const body = { contents: [{ role: 'user', parts: [{ text: 'test' }] }], tools: [{ functionDeclarations: [{ name: 'allowed', parameters: { type: 'object' } }] }] }
  await assert.rejects(groqClient({ apiKey: 'fixture', fetchImpl: async () => tool('bad', {}) })(body), /unsupported/)
  await assert.rejects(groqClient({ apiKey: 'fixture', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'tool_calls', message: {
    tool_calls: [{ id: 'call', function: { name: 'allowed', arguments: 'invalid' } }],
  } }] }) }) })(body), /invalid tool arguments/)
})

test('glasses intent API works with Groq and status exposes configuration without secrets', async () => {
  const api = agentApi({ provider: 'groq', apiKey: 'fixture-secret', planner: { resolveLocations: async () => ({ resolutionId: 'fixture-resolution' }) }, fetchImpl: async () => tool('understood_trip', { origin: 'Wall Street', destination: 'Bronx Zoo' }) })
  async function invoke(url, method, body) {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []); req.url = url; req.method = method
    req.headers = { host: 'localhost:5173', origin: 'http://localhost:5173', 'content-type': 'application/json' }
    let status, data
    await api(req, { writeHead(code) { status = code }, end(bytes) { data = JSON.parse(bytes) } }, () => assert.fail())
    return { status, data }
  }
  const status = await invoke('/api/agent/status', 'GET')
  assert.equal(status.data.provider, 'groq'); assert.equal(status.data.sttModel, 'whisper-large-v3-turbo')
  assert.ok(!JSON.stringify(status.data).includes('fixture-secret'))
  const result = await invoke('/api/agent/intent', 'POST', { text: 'From Wall Street to Bronx Zoo' })
  assert.equal(result.status, 200); assert.deepEqual(result.data, { origin: 'Wall Street', destination: 'Bronx Zoo', resolutionId: 'fixture-resolution' })
})
