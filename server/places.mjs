import { randomUUID } from 'node:crypto'
import { ApiError } from './http.mjs'
import { checkTripLocations } from './locations.mjs'

const bounds = { low: { latitude: 40.49, longitude: -74.26 }, high: { latitude: 40.92, longitude: -73.69 } }
export function createPlaceResolver({ apiKey, fetchImpl = fetch, now = Date.now }) {
  const resolutions = new Map()
  async function search(text) {
    const response = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location' },
      body: JSON.stringify({ textQuery: `${text}, New York City`, languageCode: 'en', regionCode: 'US',
        locationBias: { rectangle: bounds }, pageSize: 5 }), signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 502,
      response.status === 403 ? 'Enable Places API (New) and allow it for your Google key, then try again.'
        : `Google Places returned ${response.status}. Check Places API access, billing, and key restrictions.`)
    const data = await response.json(), seen = new Set()
    const candidates = (data.places || []).filter(p => {
      const point = p.location
      if (!p.id || !p.displayName?.text || !p.formattedAddress || !point || seen.has(p.id)) return false
      if (point.latitude < bounds.low.latitude || point.latitude > bounds.high.latitude ||
        point.longitude < bounds.low.longitude || point.longitude > bounds.high.longitude ||
        !Number.isFinite(point.latitude + point.longitude)) return false
      seen.add(p.id); return true
    }).map(p => ({ placeId: p.id, name: p.displayName.text, address: p.formattedAddress,
      latitude: p.location.latitude, longitude: p.location.longitude }))
    if (!candidates.length) throw new ApiError(422, 'No NYC place found. Tap and give a specific landmark, station, or full address.')
    return candidates
  }
  return {
    async resolve(body) {
      if (!body || [body.origin, body.destination].some(v => typeof v !== 'string' || !v.trim() || v.length > 300)) throw new ApiError(400, 'Provide both places.')
      checkTripLocations(body)
      if (!apiKey) throw new ApiError(503, 'Configure GOOGLE_MAPS_API_KEY (or GOOGLE_PLACES_API_KEY) for Places API (New).')
      // Independent lookups; never ask the model to invent a place ID/address.
      const [originCandidates, destinationCandidates] = await Promise.all([search(body.origin.trim()), search(body.destination.trim())])
      for (const [id, value] of resolutions) if (value.expires <= now()) resolutions.delete(id)
      while (resolutions.size >= 100) resolutions.delete(resolutions.keys().next().value)
      const resolutionId = randomUUID()
      resolutions.set(resolutionId, { originCandidates, destinationCandidates, expires: now() + 15 * 60000 })
      return { resolutionId, originCandidates, destinationCandidates }
    },
    confirmed(body) {
      const saved = resolutions.get(body.resolutionId)
      if (!saved || saved.expires <= now()) throw new ApiError(422, 'Place confirmation expired. Tap to record your trip again.')
      const origin = saved.originCandidates.find(p => p.placeId === body.originPlaceId)
      const destination = saved.destinationCandidates.find(p => p.placeId === body.destinationPlaceId)
      if (!origin || !destination) throw new ApiError(400, 'Select places from the confirmed search results.')
      return { origin, destination }
    },
  }
}
