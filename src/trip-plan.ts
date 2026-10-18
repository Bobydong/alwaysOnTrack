import type { Stop } from './station-tracker.ts'

export type Place = { name: string; latitude: number; longitude: number }
export type TripStation = Place & { id: string; travelSeconds: number }
export type WalkingLeg = { id: string; kind: 'walk'; from: Place; to: Place; durationSeconds: number; instruction: string }
export type SubwayLeg = {
  id: string; kind: 'subway'; line: { id: string; name: string; headsign: string }
  departureTime: string; arrivalTime: string; stops: TripStation[]
  schedule: { tripId: string; directionId: string; serviceDate: string; feedSha256: string }
}
export type TripPlan = {
  schemaVersion: 1; id: string; preparedAt: string; origin: string; destination: string
  departureTime: string; arrivalTime: string
  source: { provider: 'google-routes-mta'; attribution: string; scheduleFetchedAt: string; scheduleUrl: string }
  legs: (WalkingLeg | SubwayLeg)[]; warnings: string[]
}

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected a trip-plan object.')
  return v as Record<string, unknown>
}
const text = (v: unknown, limit = 500) => {
  if (typeof v !== 'string' || !v.trim() || v.length > limit) throw new Error('Missing or oversized trip-plan text.')
  return v.trim()
}
const number = (v: unknown, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error('Invalid trip-plan number.')
  return v
}
const date = (v: unknown) => {
  const s = text(v, 40)
  if (!/^\d{4}-\d\d-\d\dT/.test(s) || !Number.isFinite(Date.parse(s))) throw new Error('Invalid trip-plan timestamp.')
  return s
}
const list = (v: unknown, max: number) => {
  if (!Array.isArray(v) || v.length > max) throw new Error('Invalid trip-plan list.')
  return v as unknown[]
}
function place(v: unknown): Place {
  const p = object(v)
  return { name: text(p.name, 200), latitude: number(p.latitude, -90, 90), longitude: number(p.longitude, -180, 180) }
}

// A provider response becomes a portable, versioned plan before it can reach detection.
export function parseTripPlan(value: unknown): TripPlan {
  const p = object(value), source = object(p.source)
  if (p.schemaVersion !== 1 || source.provider !== 'google-routes-mta') throw new Error('Unsupported trip-plan version or source.')
  const plan: TripPlan = {
    schemaVersion: 1, id: text(p.id, 100), preparedAt: date(p.preparedAt), origin: text(p.origin, 300), destination: text(p.destination, 300),
    departureTime: date(p.departureTime), arrivalTime: date(p.arrivalTime),
    source: { provider: 'google-routes-mta', attribution: text(source.attribution), scheduleFetchedAt: date(source.scheduleFetchedAt), scheduleUrl: text(source.scheduleUrl) },
    warnings: list(p.warnings, 20).map(v => text(v)),
    legs: list(p.legs, 40).map(value => {
      const leg = object(value), id = text(leg.id, 100)
      if (leg.kind === 'walk') return { id, kind: 'walk', from: place(leg.from), to: place(leg.to),
        durationSeconds: number(leg.durationSeconds, 0, 86400), instruction: text(leg.instruction, 1000) }
      if (leg.kind !== 'subway') throw new Error('Only walking and subway legs are supported.')
      const line = object(leg.line), schedule = object(leg.schedule)
      const stops = list(leg.stops, 50).map((value, i) => {
        const s = object(value)
        return { ...place(s), id: text(s.id, 100), travelSeconds: number(s.travelSeconds, i ? 5 : 0, i ? 7200 : 0) }
      })
      if (stops.length < 2) throw new Error('A subway leg needs at least two ordered stops.')
      if (!/^\d{4}-\d\d-\d\d$/.test(String(schedule.serviceDate)) || !/^[a-f0-9]{64}$/.test(String(schedule.feedSha256))) throw new Error('Invalid schedule provenance.')
      const departureTime = date(leg.departureTime), arrivalTime = date(leg.arrivalTime)
      if (Date.parse(arrivalTime) <= Date.parse(departureTime)) throw new Error('Subway arrival must follow departure.')
      return { id, kind: 'subway', line: { id: text(line.id, 100), name: text(line.name, 200), headsign: text(line.headsign, 200) },
        departureTime, arrivalTime, stops, schedule: { tripId: text(schedule.tripId, 200), directionId: text(schedule.directionId, 10),
          serviceDate: String(schedule.serviceDate), feedSha256: String(schedule.feedSha256) } }
    }),
  }
  if (!plan.legs.some(l => l.kind === 'subway') || Date.parse(plan.arrivalTime) <= Date.parse(plan.departureTime)) throw new Error('No usable subway journey in plan.')
  if (new Set(plan.legs.map(l => l.id)).size !== plan.legs.length) throw new Error('Trip leg IDs must be unique.')
  let previousArrival = Date.parse(plan.departureTime)
  for (const leg of plan.legs) {
    if (leg.kind !== 'subway') continue
    if (Date.parse(leg.departureTime) < previousArrival || Date.parse(leg.arrivalTime) > Date.parse(plan.arrivalTime)) throw new Error('Train legs are out of journey order.')
    if (leg.stops.some((s, i) => i > 0 && s.id === leg.stops[i - 1].id)) throw new Error('Consecutive train stops must be distinct.')
    previousArrival = Date.parse(leg.arrivalTime)
  }
  if (toTrackerStops(plan).length > 50) throw new Error('The tracker currently supports at most 50 stops.')
  return plan
}

const prompt = (s: string) => s.length > 160 ? `${s.slice(0, 157)}...` : s
export function toTrackerStops(plan: TripPlan): Stop[] {
  const rides = plan.legs.filter((leg): leg is SubwayLeg => leg.kind === 'subway')
  const stops: Stop[] = []
  rides.forEach((ride, i) => {
    if (i === 0) stops.push({ name: ride.stops[0].name, travelSeconds: 0,
      instruction: prompt(`Board ${ride.line.name} toward ${ride.line.headsign} at ${ride.stops[0].name}.`) })
    // The next ride's boarding stop is reached on foot, not counted as a train stop.
    ride.stops.slice(1).forEach(s => stops.push({ name: s.name, travelSeconds: s.travelSeconds }))
    const last = stops[stops.length - 1], next = rides[i + 1]
    if (next) {
      last.transfer = true
      last.instruction = prompt(`Change to ${next.line.name} toward ${next.line.headsign}. Board at ${next.stops[0].name}, then tap.`)
    } else last.instruction = prompt(`Leave the train at ${last.name}. Follow station exit signs.`)
  })
  return stops
}

export function routeTextFromPlan(plan: TripPlan) {
  return toTrackerStops(plan).map(s => `${s.name.replaceAll('|', '/')} | ${s.travelSeconds} | ${(s.instruction ?? '').replaceAll('|', '/')}${s.transfer ? ' | transfer' : ''}`).join('\n')
}
