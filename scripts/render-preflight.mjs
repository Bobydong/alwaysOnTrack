import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRoutePlanner } from '../server/route-service.mjs'

const catalogPath = process.argv[3] || process.argv[2] || 'data/mta-subway.json'
if (process.argv[2] === '--runtime') {
  const fixture = JSON.parse(process.env.RENDER_PROBE_FIXTURE)
  let providerCalls = 0
  const planner = createRoutePlanner({ catalogPath, apiKey: 'synthetic-preflight-key', fetchImpl: async () => {
    providerCalls++
    return { ok: true, json: async () => fixture.google }
  } })
  const started = performance.now()
  assert.equal((await planner.status()).catalogAvailable, true)
  const loadSeconds = (performance.now() - started) / 1000
  for (let i = 0; i < 6; i++) {
    const result = await planner.plan(fixture.request)
    assert.equal(result.plans.length, 1)
    assert.deepEqual(result.plans[0].legs[0].stops.map(s => s.id), fixture.stationIds)
  }
  const peakMiB = process.resourceUsage().maxRSS / 1024
  console.log(JSON.stringify({ catalogLoadSeconds: loadSeconds, sixRouteChecksSeconds: (performance.now() - started) / 1000 - loadSeconds,
    peakMiB, residentMiB: process.memoryUsage().rss / 1048576, fixtureProviderCalls: providerCalls, paidProviderCalls: 0 }))
  assert.ok(peakMiB < 480, 'Runtime peak exceeded the 480 MiB preflight budget. Do not assume the 512 MB free instance is sufficient.')
} else {
  // Fixture construction happens in a separate parent, outside the measured
  // service process. Only the service process loads/caches the real catalog.
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'))
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(catalog.fetchedAt))
  const key = date.replaceAll('-', ''), weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  const active = service => {
    const exception = catalog.exceptions[service]?.[key], calendar = catalog.calendars[service]
    return exception === undefined ? calendar && key >= calendar.start && key <= calendar.end && calendar.days[weekday] === 1 : exception === 1
  }
  const trip = catalog.trips.find(t => catalog.routes[t.routeId]?.name === '1' && active(t.serviceId) && t.stops.length >= 3 &&
    t.stops[0].departure < 86400 && t.stops.slice(1, 3).every((s, i) => s.arrival - t.stops[i].departure >= 5))
  assert.ok(trip, 'No active line 1 sample found in this catalog. Refresh it or extend the preflight fixture selection.')
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' }).formatToParts(new Date(`${date}T12:00:00Z`)).find(p => p.type === 'timeZoneName').value.replace('GMT', '')
  const midnight = Date.parse(`${date}T00:00:00${offset}`)
  const time = seconds => new Date(midnight + seconds * 1000).toISOString()
  const board = trip.stops[0], alight = trip.stops[2], from = catalog.stops[board.id], to = catalog.stops[alight.id]
  const point = stop => ({ latLng: { latitude: stop.latitude, longitude: stop.longitude } })
  const departureTime = time(board.departure), arrivalTime = time(alight.arrival)
  const fixture = { request: { origin: `${from.name} on subway line 1`, destination: `${to.name} on subway line 1`, departureTime }, stationIds: trip.stops.slice(0, 3).map(s => s.id),
    google: { routes: [{ legs: [{ steps: [{ travelMode: 'TRANSIT', transitDetails: { stopDetails: {
      departureStop: { name: from.name, location: point(from) }, arrivalStop: { name: to.name, location: point(to) }, departureTime, arrivalTime },
      transitLine: { nameShort: '1', name: '1', vehicle: { type: 'SUBWAY' } }, headsign: trip.headsign || 'Line 1 direction', stopCount: 2,
    } }] }] }] } }
  const child = spawnSync(process.execPath, ['--max-old-space-size=320', 'scripts/render-preflight.mjs', '--runtime', catalogPath], {
    encoding: 'utf8', env: { ...process.env, RENDER_PROBE_FIXTURE: JSON.stringify(fixture) }, maxBuffer: 1024 * 1024,
  })
  process.stdout.write(child.stdout || ''); process.stderr.write(child.stderr || '')
  if (child.error) throw child.error
  if (child.status !== 0) process.exit(child.status || 1)
  console.log('Local runtime preflight passed with the full MTA catalog and synthetic Google responses. This does not emulate Linux cgroup limits, Render CPU throttling, or live provider behavior.')
}
