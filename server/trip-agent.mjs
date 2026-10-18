import { ApiError } from './http.mjs'
import { singleCall } from './gemini.mjs'

const functions = [
  { name: 'ask_question', description: 'Ask one concise clarification when origin, destination, or NYC location is missing or ambiguous. Never guess the current location.',
    parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
  { name: 'find_subway_routes', description: 'Find real NYC subway routes and expand their ordered station lists using Google Routes and MTA schedules. Call only after origin and destination are clear.',
    parameters: { type: 'object', properties: { origin: { type: 'string' }, destination: { type: 'string' } }, required: ['origin', 'destination'] } },
  { name: 'recommend_route', description: 'Select one index from the verified routes returned by find_subway_routes, considering the rider preferences.',
    parameters: { type: 'object', properties: { index: { type: 'integer' } }, required: ['index'] } },
]
const instructions = `You prepare NYC subway journeys for AlwaysOnTrack glasses. Use only the declared tools.
Ask one short question if an endpoint is missing or ambiguous; "here" is unknown without an explicit location.
Use the conversation to resolve follow-up answers and corrections. Do not silently replace endpoints or invent addresses.
Only walking and NYC subway are supported. Ask for a supported journey if a request is outside scope.
Call find_subway_routes once when both endpoints are known. The tool, not you, supplies routes, stations, directions and timings.
Then call recommend_route with an available index. Prefer the rider's requested fewest transfers or least walking; otherwise prefer the earliest arrival.
Never invent intermediate stops, platforms, street exits, live delays, fares, or accessibility claims. No executable scripts.
Calls to load or start tracking do not exist: the rider reviews and loads the route on the phone, then taps when aboard.`
const requestConfig = allowed => ({
  systemInstruction: { parts: [{ text: instructions }] }, tools: [{ functionDeclarations: functions }],
  toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: allowed } },
  generationConfig: { maxOutputTokens: 2048 },
})
function shortText(value, limit, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new ApiError(400, `Invalid ${label}.`)
  return value.trim()
}
function summarize(plan, index) {
  return { index, id: plan.id, origin: plan.origin, destination: plan.destination, arrivalTime: plan.arrivalTime,
    departureTime: plan.departureTime, walkingSeconds: plan.legs.filter(l => l.kind === 'walk').reduce((s, l) => s + l.durationSeconds, 0),
    rides: plan.legs.filter(l => l.kind === 'subway').map(l => ({ line: l.line, stations: l.stops.map(s => s.name) })) }
}
export async function runTripAgent({ generate, planner, body }) {
  if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 12) throw new ApiError(400, 'Provide 1-12 conversation messages.')
  const contents = body.messages.map((m, i) => {
    if (!m || !['user', 'assistant'].includes(m.role) || (i === body.messages.length - 1 && m.role !== 'user')) throw new ApiError(400, 'Conversation must end with a user message.')
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: shortText(m.text, 2000, 'message') }] }
  })
  const first = await generate({ ...requestConfig(['ask_question', 'find_subway_routes']), contents })
  const action = singleCall(first, ['ask_question', 'find_subway_routes'])
  if (action.name === 'ask_question') return { message: shortText(action.args?.question, 500, 'clarification'), plans: [], recommendedId: null }
  const request = { origin: shortText(action.args?.origin, 300, 'origin'), destination: shortText(action.args?.destination, 300, 'destination') }
  const result = await planner.plan(request)
  // Preserve the complete model content, including Gemini thought signatures.
  const response = { name: action.name, response: { routes: result.plans.map(summarize) }, ...(action.id ? { id: action.id } : {}) }
  let recommendedId = null
  try {
    const ranking = await generate({ ...requestConfig(['recommend_route']), contents: [
      ...contents, first, { role: 'user', parts: [{ functionResponse: response }] },
    ] })
    const choice = singleCall(ranking, ['recommend_route']).args?.index
    if (Number.isInteger(choice) && choice >= 0 && choice < result.plans.length) recommendedId = result.plans[choice].id
  } catch { /* Verified routes remain usable if optional model ranking fails. */ }
  return { ...result, recommendedId, request,
    message: `Found ${result.plans.length} verified itinerary(s) from ${request.origin} to ${request.destination}. ${recommendedId ? 'A recommended route is marked below.' : 'Choose a route below; agent ranking was unavailable.'} Review before loading.` }
}
