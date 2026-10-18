import { ApiError } from './http.mjs'
import { validateSpeechWav } from './gemini.mjs'

export const defaultGroqAgentModel = 'openai/gpt-oss-120b'
export const defaultGroqSttModel = 'whisper-large-v3-turbo'

async function responseJson(response) {
  if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 502,
    response.status === 429 ? 'Groq rate limit reached. Wait before trying again or check your Groq usage limits.'
      : `Groq returned ${response.status}. Check the Groq key, model access, and service availability.`)
  return response.json()
}
function checkKey(apiKey) {
  if (!apiKey) throw new ApiError(503, 'Add GROQ_API_KEY to .env.local on the laptop and restart the server.')
}
function checkModel(model) {
  if (typeof model !== 'string' || !/^[a-zA-Z0-9._/-]+$/.test(model)) throw new Error('Invalid Groq model configuration.')
}

// Adapt the existing bounded agent request/response envelope to Groq chat tools.
// The route tools and all Google/MTA validation continue to run on our backend.
export function groqClient({ apiKey, model = defaultGroqAgentModel, fetchImpl = fetch }) {
  checkModel(model)
  return async body => {
    checkKey(apiKey)
    const messages = []
    const system = body.systemInstruction?.parts?.map(p => p.text || '').join('\n')
    if (system) messages.push({ role: 'system', content: system })
    for (const content of body.contents || []) {
      const toolResponses = content.parts.filter(p => p.functionResponse)
      if (toolResponses.length) {
        for (const { functionResponse: response } of toolResponses) {
          if (!response.id) throw new ApiError(502, 'Agent tool response is missing its call ID.')
          messages.push({ role: 'tool', tool_call_id: response.id, content: JSON.stringify(response.response) })
        }
      } else {
        const text = content.parts.map(p => p.text || '').join('\n')
        const calls = content.parts.filter(p => p.functionCall).map(({ functionCall: call }) => ({
          id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) },
        }))
        messages.push({ role: content.role === 'model' ? 'assistant' : 'user', content: text || null,
          ...(calls.length ? { tool_calls: calls } : {}) })
      }
    }
    const allowed = body.toolConfig?.functionCallingConfig?.allowedFunctionNames
    const tools = (body.tools || []).flatMap(t => t.functionDeclarations || [])
      .filter(tool => !allowed || allowed.includes(tool.name)).map(tool => ({ type: 'function', function: tool }))
    const request = { model, messages, tools, parallel_tool_calls: false,
      tool_choice: tools.length === 1 ? { type: 'function', function: { name: tools[0].function.name } } : 'required',
      max_completion_tokens: body.generationConfig?.maxOutputTokens || 2048,
      ...(model.startsWith('openai/gpt-oss-') ? { reasoning_effort: 'low' } : {}),
    }
    const data = await responseJson(await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(request), signal: AbortSignal.timeout(30000),
    }))
    const choice = data.choices?.[0]
    if (!choice?.message?.tool_calls?.length || choice.finish_reason !== 'tool_calls') {
      throw new ApiError(502, 'Groq did not finish a usable agent action. Please try again.')
    }
    const parts = choice.message.tool_calls.map(call => {
      let args
      try { args = JSON.parse(call.function.arguments) } catch { throw new ApiError(502, 'Groq returned invalid tool arguments. Please try again.') }
      if (!call.id || !tools.some(t => t.function.name === call.function.name)) throw new ApiError(502, 'Groq returned an unsupported agent action.')
      return { functionCall: { id: call.id, name: call.function.name, args } }
    })
    return { role: 'model', parts }
  }
}

export function groqTranscriber({ apiKey, model = defaultGroqSttModel, fetchImpl = fetch }) {
  checkModel(model)
  return async bytes => {
    checkKey(apiKey); validateSpeechWav(bytes)
    if (!bytes.subarray(44).some(v => v !== 0)) throw new ApiError(422, 'The microphone recording is silent. Please retry or type your request.')
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'trip.wav')
    form.append('model', model); form.append('language', 'en'); form.append('response_format', 'json'); form.append('temperature', '0')
    const data = await responseJson(await fetchImpl('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(30000),
    }))
    if (typeof data.text !== 'string' || data.text.length > 2000) throw new ApiError(502, 'Groq returned an invalid transcript. Please try again.')
    if (!data.text.trim()) throw new ApiError(422, 'No speech was recognized. Please retry or type your request.')
    return { text: data.text.trim() }
  }
}
