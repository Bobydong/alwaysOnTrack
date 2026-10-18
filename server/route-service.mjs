import { readFile, stat } from 'node:fs/promises'
import { googlePlans } from '../src/google-routes.ts'
import { ApiError } from './http.mjs'
import { checkTripLocations } from './locations.mjs'
import { createPlaceResolver } from './places.mjs'

const fieldMask = ['routes.duration', 'routes.legs.steps.travelMode', 'routes.legs.steps.staticDuration',
  'routes.legs.steps.navigationInstruction', 'routes.legs.steps.startLocation', 'routes.legs.steps.endLocation', 'routes.legs.steps.transitDetails'].join(',')

export function createRoutePlanner({ apiKey, placesApiKey = apiKey, catalogPath, fetchImpl = fetch }) {
  const places = createPlaceResolver({ apiKey: placesApiKey, fetchImpl })
  let catalog, modified
  async function schedules() {
    const info = await stat(catalogPath).catch(() => null)
    if (!info) throw new ApiError(503, 'MTA schedules are missing. Run npm run gtfs:import on the laptop first.')
    if (info.size > 256 * 1024 * 1024) throw new ApiError(503, 'MTA catalog is too large.')
    if (!catalog || modified !== info.mtimeMs) {
      const data = JSON.parse(await readFile(catalogPath, 'utf8'))
      if (data.schemaVersion !== 1 || !Array.isArray(data.trips) || !data.stops || !data.calendars || !data.exceptions) throw new ApiError(503, 'Invalid MTA catalog; import it again.')
      catalog = data; modified = info.mtimeMs
    }
    return catalog
  }
  return {
    resolveLocations: body => places.resolve(body),
    async status() {
      const data = await schedules().catch(() => null)
      return { provider: 'google-routes-mta', configured: !!apiKey, catalogAvailable: !!data, scheduleFetchedAt: data?.fetchedAt ?? null }
    },
    async plan(body) {
      if (!body || Array.isArray(body) || typeof body.origin !== 'string' || !body.origin.trim() || body.origin.length > 300 ||
        typeof body.destination !== 'string' || !body.destination.trim() || body.destination.length > 300 ||
        (body.departureTime !== undefined && (typeof body.departureTime !== 'string' || !Number.isFinite(Date.parse(body.departureTime))))) {
        throw new ApiError(400, 'Provide origin and destination, with an optional ISO departure time.')
      }
      checkTripLocations(body)
      const confirmed = body.resolutionId ? places.confirmed(body) : null
      if (!apiKey) throw new ApiError(503, 'Add GOOGLE_MAPS_API_KEY to .env.local on the laptop and restart Vite. Enable Routes API for that key.')
      const data = await schedules()
      const request = { origin: confirmed ? `${confirmed.origin.name}, ${confirmed.origin.address}` : body.origin.trim(),
        destination: confirmed ? `${confirmed.destination.name}, ${confirmed.destination.address}` : body.destination.trim(),
        departureTime: body.departureTime || new Date().toISOString() }
      const response = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': fieldMask },
        body: JSON.stringify({ origin: confirmed ? { placeId: confirmed.origin.placeId } : { address: request.origin },
          destination: confirmed ? { placeId: confirmed.destination.placeId } : { address: request.destination }, travelMode: 'TRANSIT',
          departureTime: request.departureTime, computeAlternativeRoutes: true, languageCode: 'en-US', units: 'METRIC',
          transitPreferences: { allowedTravelModes: ['SUBWAY'] } }), signal: AbortSignal.timeout(20000),
      })
      if (!response.ok) throw new ApiError(502, `Google Routes returned ${response.status}. Check Routes API access, billing, and key restrictions.`)
      const google = await response.json()
      if (!Array.isArray(google.routes) || !google.routes.length) throw new ApiError(422,
        'Google returned no subway route for these locations. Try specific stations or street intersections.')
      const result = googlePlans(google, request, data)
      if (!result.plans.length) throw new ApiError(422, 'No fully resolved NYC subway itinerary was found.', { rejected: result.rejected })
      return result
    },
  }
}
