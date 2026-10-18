import { ApiError, apiFailure, readBody, readJson, reply } from './http.mjs'
import { defaultGeminiModel, geminiClient, transcribeSpeech } from './gemini.mjs'
import { runTripAgent } from './trip-agent.mjs'
import { understandTrip, planConfirmedTrip } from './glasses-planning.mjs'
import { defaultGroqAgentModel, defaultGroqSttModel, groqClient, groqTranscriber } from './groq.mjs'
import { demoAccess } from './demo-access.mjs'

export function agentApi({ provider = 'gemini', apiKey, model = provider === 'groq' ? defaultGroqAgentModel : defaultGeminiModel,
  sttModel = defaultGroqSttModel, planner, fetchImpl = fetch, authorize = demoAccess().authorize }) {
  if (!['groq', 'gemini'].includes(provider)) throw new Error('Unsupported AI provider.')
  const generate = (provider === 'groq' ? groqClient : geminiClient)({ apiKey, model, fetchImpl })
  const transcribe = provider === 'groq' ? groqTranscriber({ apiKey, model: sttModel, fetchImpl }) : bytes => transcribeSpeech(generate, bytes)
  let pending = 0
  return async (req, res, next) => {
    const pathname = req.url?.split('?')[0]
    if (!['/api/agent/status', '/api/agent/turn', '/api/agent/intent', '/api/agent/plan-confirmed', '/api/speech/transcribe'].includes(pathname)) return next()
    let acquired = false
    try {
      authorize(req)
      if (pathname === '/api/agent/status') {
        if (req.method !== 'GET') throw new ApiError(405, 'GET required.')
        return reply(res, 200, { provider, configured: !!apiKey, model, sttModel: provider === 'groq' ? sttModel : model })
      }
      if (req.method !== 'POST') throw new ApiError(405, 'POST required.')
      if (!apiKey) throw new ApiError(503, `Add ${provider === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY'} to .env.local on the laptop and restart the server.`)
      if (pending >= 2) throw new ApiError(429, 'A voice or planning request is already running. Try again shortly.')
      pending++; acquired = true
      if (pathname === '/api/speech/transcribe') {
        if (req.headers['content-type']?.split(';')[0] !== 'audio/wav') throw new ApiError(415, 'WAV audio required.')
        return reply(res, 200, await transcribe(await readBody(req, 30 * 32000 + 44)))
      }
      const body = await readJson(req)
      if (pathname === '/api/agent/intent') {
        const intent = await understandTrip(generate, body)
        if (typeof planner.resolveLocations !== 'function') throw new ApiError(503, 'Place lookup is unavailable. Restart the companion server.')
        return reply(res, 200, { ...intent, ...await planner.resolveLocations(intent) })
      }
      if (pathname === '/api/agent/plan-confirmed') {
        if (!body?.resolutionId) throw new ApiError(400, 'Resolve and confirm both places before planning.')
        return reply(res, 200, await planConfirmedTrip({ generate, planner, body }))
      }
      return reply(res, 200, await runTripAgent({ generate, planner, body }))
    } catch (e) { apiFailure(res, e) }
    finally { if (acquired) pending-- }
  }
}
