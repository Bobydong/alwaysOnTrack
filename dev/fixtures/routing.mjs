// Synthetic contract fixtures, not evidence of a live Google/MTA itinerary.
export const request = { origin: 'Fixture origin', destination: 'Fixture destination', departureTime: '2026-10-17T16:00:00Z' }
export const catalog = {
  schemaVersion: 1, fetchedAt: '2026-10-17T00:00:00Z', sourceUrl: 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip', sha256: 'a'.repeat(64),
  stops: {
    A: { name: 'Alpha', latitude: 40.75, longitude: -73.99, parent: '' },
    B: { name: 'Bravo', latitude: 40.76, longitude: -73.98, parent: '' },
    C: { name: 'Charlie', latitude: 40.77, longitude: -73.97, parent: '' },
    D: { name: 'Delta boarding', latitude: 40.775, longitude: -73.965, parent: '' },
    E: { name: 'Echo', latitude: 40.78, longitude: -73.95, parent: '' },
  },
  routes: { one: { name: '1', type: '1' }, two: { name: '2', type: '1' } },
  calendars: { daily: { start: '20260101', end: '20261231', days: [1, 1, 1, 1, 1, 1, 1] } }, exceptions: {},
  trips: [
    { id: 'train-one', routeId: 'one', serviceId: 'daily', directionId: '0', headsign: 'Uptown', stops: [
      { id: 'A', arrival: 43200, departure: 43200 }, { id: 'B', arrival: 43320, departure: 43340 }, { id: 'C', arrival: 43440, departure: 43440 },
    ] },
    { id: 'train-two', routeId: 'two', serviceId: 'daily', directionId: '0', headsign: 'East', stops: [
      { id: 'D', arrival: 44100, departure: 44100 }, { id: 'E', arrival: 44280, departure: 44280 },
    ] },
  ],
}
const location = id => ({ latLng: { latitude: catalog.stops[id].latitude, longitude: catalog.stops[id].longitude } })
const subway = (from, to, line, headsign, departureTime, arrivalTime, count) => ({ travelMode: 'TRANSIT', transitDetails: {
  stopDetails: { departureStop: { name: catalog.stops[from].name, location: location(from) }, arrivalStop: { name: catalog.stops[to].name, location: location(to) }, departureTime, arrivalTime },
  transitLine: { nameShort: line, name: `Line ${line}`, vehicle: { type: 'SUBWAY' } }, headsign, stopCount: count,
} })
export const googleResponse = { routes: [{ duration: '1080s', legs: [{ steps: [
  subway('A', 'C', '1', 'Uptown', '2026-10-17T16:00:00Z', '2026-10-17T16:04:00Z', 2),
  { travelMode: 'WALK', staticDuration: '600s', startLocation: location('C'), endLocation: location('D'), navigationInstruction: { instructions: 'Walk to Delta boarding.' } },
  subway('D', 'E', '2', 'East', '2026-10-17T16:15:00Z', '2026-10-17T16:18:00Z', 1),
] }] }] }
