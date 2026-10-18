import { matchSubway, type GtfsCatalog } from './gtfs-match.ts'
import { parseTripPlan, type Place, type TripPlan, type WalkingLeg, type SubwayLeg } from './trip-plan.ts'

type Location = { latLng?: { latitude?: number; longitude?: number } }
type GoogleStep = {
  travelMode?: string; staticDuration?: string; startLocation?: Location; endLocation?: Location
  navigationInstruction?: { instructions?: string }
  transitDetails?: {
    stopDetails?: { departureStop?: { name?: string; location?: Location }; arrivalStop?: { name?: string; location?: Location }; departureTime?: string; arrivalTime?: string }
    transitLine?: { name?: string; nameShort?: string; vehicle?: { type?: string } }; headsign?: string; stopCount?: number
  }
}
export type GoogleRoutesResponse = { routes?: { duration?: string; legs?: { steps?: GoogleStep[] }[] }[] }
export type PlanRequest = { origin: string; destination: string; departureTime: string }

function location(name: string, point?: Location): Place {
  const latitude = point?.latLng?.latitude, longitude = point?.latLng?.longitude
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude + longitude)) throw new Error('Provider omitted station coordinates.')
  return { name, latitude, longitude }
}
export function googlePlans(response: GoogleRoutesResponse, request: PlanRequest, catalog: GtfsCatalog, preparedAt = new Date().toISOString()) {
  const plans: TripPlan[] = [], rejected: string[] = []
  for (const [index, route] of (response.routes ?? []).entries()) {
    try {
      const legs: (WalkingLeg | SubwayLeg)[] = []
      for (const step of route.legs?.flatMap(l => l.steps ?? []) ?? []) {
        const id = `leg-${legs.length + 1}`
        if (step.travelMode === 'WALK') {
          const duration = /^([\d.]+)s$/.exec(step.staticDuration ?? '')
          if (!duration) throw new Error('Provider omitted walking duration.')
          legs.push({ id, kind: 'walk', from: location('Walk start', step.startLocation), to: location('Walk end', step.endLocation),
            durationSeconds: +duration[1], instruction: step.navigationInstruction?.instructions || 'Follow walking directions to the next stop.' })
          continue
        }
        const details = step.transitDetails, stops = details?.stopDetails, line = details?.transitLine
        if (step.travelMode !== 'TRANSIT' || line?.vehicle?.type !== 'SUBWAY') throw new Error('This itinerary contains a mode other than walking or subway.')
        if (!line.nameShort || !details?.headsign || !stops?.departureTime || !stops.arrivalTime || !stops.departureStop?.name || !stops.arrivalStop?.name) throw new Error('Incomplete train, direction, or boarding data.')
        const from = location(stops.departureStop.name, stops.departureStop.location), to = location(stops.arrivalStop.name, stops.arrivalStop.location)
        const match = matchSubway({ lineId: line.nameShort, stopCount: details.stopCount ?? 0, departureTime: stops.departureTime,
          arrivalTime: stops.arrivalTime, from, to }, catalog)
        legs.push({ id, kind: 'subway', line: { id: line.nameShort, name: line.name || line.nameShort, headsign: details.headsign },
          departureTime: stops.departureTime, arrivalTime: stops.arrivalTime, ...match })
      }
      let lastRideIndex = legs.length - 1
      while (lastRideIndex >= 0 && legs[lastRideIndex].kind !== 'subway') lastRideIndex--
      if (lastRideIndex < 0) throw new Error('No subway ride in this itinerary.')
      const lastRide = legs[lastRideIndex] as SubwayLeg
      const egressSeconds = legs.slice(lastRideIndex + 1).reduce((sum, leg) => sum + (leg.kind === 'walk' ? leg.durationSeconds : 0), 0)
      plans.push(parseTripPlan({ schemaVersion: 1, id: `google-${Date.parse(preparedAt)}-${index + 1}`, preparedAt,
        origin: request.origin, destination: request.destination, departureTime: request.departureTime,
        arrivalTime: new Date(Date.parse(lastRide.arrivalTime) + egressSeconds * 1000).toISOString(), legs,
        source: { provider: 'google-routes-mta', attribution: 'Google Maps; MTA GTFS schedules', scheduleFetchedAt: catalog.fetchedAt, scheduleUrl: catalog.sourceUrl },
        warnings: ['Per-station travel times come from MTA schedules, not measured or live train motion.',
          'Board at the first station shown for each train ride. Walk to the next boarding station before tapping after a transfer.',
          'Specific exits, stairs, and platforms have not been verified. Follow station signs.'] }))
    } catch (error) { rejected.push(`Route ${index + 1}: ${error instanceof Error ? error.message : 'Invalid transit route.'}`) }
  }
  return { plans, rejected }
}
