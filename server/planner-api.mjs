import { readFile, stat } from 'node:fs/promises'
import { googlePlans } from '../src/google-routes.ts'

const fieldMask = ['routes.duration', 'routes.legs.steps.travelMode', 'routes.legs.steps.staticDuration',
  'routes.legs.steps.navigationInstruction', 'routes.legs.steps.startLocation', 'routes.legs.steps.endLocation', 'routes.legs.steps.transitDetails'].join(',')

export function plannerApi({ apiKey, catalogPath, fetchImpl = fetch }) {
  let catalog, modified
  async function schedules() {
    const info = await stat(catalogPath).catch(() => null)
    if (!info) throw new Error('MTA schedules are missing. Run npm run gtfs:import on the laptop first.')
    if (info.size > 256 * 1024 * 1024) throw new Error('MTA catalog is too large.')
    if (!catalog || modified !== info.mtimeMs) {
      const data = JSON.parse(await readFile(catalogPath, 'utf8'))
      if (data.schemaVersion !== 1 || !Array.isArray(data.trips) || !data.stops || !data.calendars || !data.exceptions) throw new Error('Invalid MTA catalog; import it again.')
      catalog = data; modified = info.mtimeMs
    }
    return catalog
  }
  return async (req, res, next) => {
    const pathname = req.url?.split('?')[0]
    if (pathname !== '/api/trips/plan' && pathname !== '/api/trips/status') return next()
    const reply = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(data))
    }
    if (pathname === '/api/trips/status') {
      if (req.method !== 'GET') return reply(405, { error: 'GET required.' })
      const data = await schedules().catch(() => null)
      return reply(200, { provider: 'google-routes-mta', configured: !!apiKey,
        catalogAvailable: !!data, scheduleFetchedAt: data?.fetchedAt ?? null })
    }
    if (req.method !== 'POST') return reply(405, { error: 'POST required.' })
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return reply(415, { error: 'JSON required.' })
    try {
      if (!req.headers.origin || new URL(req.headers.origin).host !== req.headers.host) return reply(403, { error: 'Same-origin request required.' })
    } catch { return reply(403, { error: 'Same-origin request required.' }) }
    try {
      const chunks = []; let length = 0
      for await (const chunk of req) {
        length += chunk.length
        if (length > 8192) return reply(413, { error: 'Trip request is too large.' })
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!body || Array.isArray(body) || typeof body.origin !== 'string' || !body.origin.trim() || body.origin.length > 300 ||
          typeof body.destination !== 'string' || !body.destination.trim() || body.destination.length > 300 ||
          (body.departureTime !== undefined && (typeof body.departureTime !== 'string' || !Number.isFinite(Date.parse(body.departureTime))))) {
        return reply(400, { error: 'Provide origin and destination, with an optional ISO departure time.' })
      }
      if (!apiKey) return reply(503, { error: 'Add GOOGLE_MAPS_API_KEY to .env.local on the laptop and restart Vite. Enable Routes API for that key.' })
      const data = await schedules()
      const request = { origin: body.origin.trim(), destination: body.destination.trim(), departureTime: body.departureTime || new Date().toISOString() }
      const response = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': fieldMask },
        body: JSON.stringify({ origin: { address: request.origin }, destination: { address: request.destination }, travelMode: 'TRANSIT',
          departureTime: request.departureTime, computeAlternativeRoutes: true, languageCode: 'en-US', units: 'METRIC',
          transitPreferences: { allowedTravelModes: ['SUBWAY'] } }), signal: AbortSignal.timeout(20000),
      })
      if (!response.ok) return reply(502, { error: `Google Routes returned ${response.status}. Check Routes API access, billing, and key restrictions.` })
      const result = googlePlans(await response.json(), request, data)
      if (!result.plans.length) return reply(422, { error: 'No fully resolved NYC subway itinerary was found.', rejected: result.rejected })
      return reply(200, result)
    } catch (error) {
      if (error instanceof SyntaxError) return reply(400, { error: 'Invalid JSON.' })
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return reply(504, { error: 'Transit provider timed out. Try again.' })
      return reply(503, { error: error instanceof Error ? error.message : 'Route preparation failed.' })
    }
  }
}
