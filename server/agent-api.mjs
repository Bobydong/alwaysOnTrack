import { ApiError, apiFailure, readBody, readJson, reply, sameOrigin } from './http.mjs'
import { defaultGeminiModel, geminiClient, transcribeSpeech } from './gemini.mjs'
import { runTripAgent } from './trip-agent.mjs'

export function agentApi({ apiKey, model = defaultGeminiModel, planner, fetchImpl = fetch }) {
  const generate = geminiClient({ apiKey, model, fetchImpl })
  let pending = 0
  return async (req, res, next) => {
    const pathname = req.url?.split('?')[0]
    if (!['/api/agent/status', '/api/agent/turn', '/api/speech/transcribe'].includes(pathname)) return next()
    let acquired = false
    try {
      if (pathname === '/api/agent/status') {
        if (req.method !== 'GET') throw new ApiError(405, 'GET required.')
        return reply(res, 200, { provider: 'gemini', configured: !!apiKey, model })
      }
      if (req.method !== 'POST') throw new ApiError(405, 'POST required.')
      sameOrigin(req)
      if (!apiKey) throw new ApiError(503, 'Add GEMINI_API_KEY to .env.local on the laptop and restart the server.')
      if (pending >= 2) throw new ApiError(429, 'A voice or planning request is already running. Try again shortly.')
      pending++; acquired = true
      if (pathname === '/api/speech/transcribe') {
        if (req.headers['content-type']?.split(';')[0] !== 'audio/wav') throw new ApiError(415, 'WAV audio required.')
        return reply(res, 200, await transcribeSpeech(generate, await readBody(req, 30 * 32000 + 44)))
      }
      return reply(res, 200, await runTripAgent({ generate, planner, body: await readJson(req) }))
    } catch (e) { apiFailure(res, e) }
    finally { if (acquired) pending-- }
  }
}
