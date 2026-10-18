import type { TripStation } from './trip-plan.ts'

export type GtfsCatalog = {
  schemaVersion: 1; fetchedAt: string; sourceUrl: string; sha256: string
  stops: Record<string, { name: string; latitude: number; longitude: number; parent: string }>
  routes: Record<string, { name: string; type: string }>
  calendars: Record<string, { start: string; end: string; days: number[] }>
  exceptions: Record<string, Record<string, number>>
  trips: { id: string; routeId: string; serviceId: string; directionId: string; headsign: string;
    stops: { id: string; arrival: number; departure: number }[] }[]
}
export type SubwayRequest = {
  lineId: string; stopCount: number; departureTime: string; arrivalTime: string
  from: { latitude: number; longitude: number }; to: { latitude: number; longitude: number }
}
function distance(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180, dlat = (a.latitude - b.latitude) * rad, dlon = (a.longitude - b.longitude) * rad
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dlon / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)))
}
function serviceDays(timestamp: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(timestamp)).map(p => [p.type, p.value]))
  const midnight = Date.UTC(+values.year, +values.month - 1, +values.day)
  return [0, 1, 2].map(offset => {
    const day = new Date(midnight - offset * 86400000)
    return { date: day.toISOString().slice(0, 10), weekday: day.getUTCDay(),
      seconds: +values.hour * 3600 + +values.minute * 60 + +values.second + offset * 86400 }
  })
}
// Google may call a service "Q Line" while GTFS names it "Q".
const canonicalLine = (s: string) => s.trim().toUpperCase().replace(/\s+LINE$/, '').replace(/\s+/g, '').replace(/X$/, '')
function active(catalog: GtfsCatalog, service: string, date: string, weekday: number) {
  const key = date.replaceAll('-', ''), exception = catalog.exceptions[service]?.[key]
  if (exception !== undefined) return exception === 1
  const calendar = catalog.calendars[service]
  return !!calendar && key >= calendar.start && key <= calendar.end && calendar.days[weekday] === 1
}

export function matchSubway(request: SubwayRequest, catalog: GtfsCatalog) {
  if (catalog.schemaVersion !== 1 || !Number.isInteger(request.stopCount) || request.stopCount < 1 || request.stopCount > 49) throw new Error('Missing subway stop count or invalid MTA catalog.')
  const days = serviceDays(request.departureTime), arrivalDelta = (Date.parse(request.arrivalTime) - Date.parse(request.departureTime)) / 1000
  const candidates: { stops: TripStation[]; tripId: string; directionId: string; serviceDate: string; score: number; key: string }[] = []
  for (const trip of catalog.trips) {
    const route = catalog.routes[trip.routeId]
    if (!route || route.type !== '1' || canonicalLine(route.name) !== canonicalLine(request.lineId)) continue
    for (const day of days) {
      if (!active(catalog, trip.serviceId, day.date, day.weekday)) continue
      for (let from = 0; from + request.stopCount < trip.stops.length; from++) {
        const to = from + request.stopCount, board = trip.stops[from], alight = trip.stops[to]
        const boardPlace = catalog.stops[board.id], alightPlace = catalog.stops[alight.id]
        if (!boardPlace || !alightPlace || distance(boardPlace, request.from) > 250 || distance(alightPlace, request.to) > 250) continue
        const departDiff = Math.abs(board.departure - day.seconds), arrivalDiff = Math.abs(alight.arrival - (day.seconds + arrivalDelta))
        if (departDiff > 300 || arrivalDiff > 300) continue
        const slice = trip.stops.slice(from, to + 1)
        const stops = slice.map((s, i) => ({ id: s.id, name: catalog.stops[s.id].name,
          latitude: catalog.stops[s.id].latitude, longitude: catalog.stops[s.id].longitude,
          travelSeconds: i ? s.arrival - slice[i - 1].departure : 0 }))
        if (stops.some((s, i) => i > 0 && (s.travelSeconds < 5 || s.travelSeconds > 7200))) continue
        candidates.push({ stops, tripId: trip.id, directionId: trip.directionId || 'unknown', serviceDate: day.date,
          score: departDiff + arrivalDiff, key: stops.map(s => s.id).join('|') })
      }
    }
  }
  if (!candidates.length) throw new Error(`No MTA schedule match for line ${request.lineId}. Refresh the supplemented GTFS catalog or choose another itinerary.`)
  if (new Set(candidates.map(c => c.key)).size !== 1) throw new Error(`Ambiguous station sequence for line ${request.lineId}; this itinerary cannot be loaded safely.`)
  candidates.sort((a, b) => a.score - b.score)
  const chosen = candidates[0]
  return { stops: chosen.stops, schedule: { tripId: chosen.tripId, directionId: chosen.directionId,
    serviceDate: chosen.serviceDate, feedSha256: catalog.sha256 } }
}
