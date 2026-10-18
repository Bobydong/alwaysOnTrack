import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { catalog, request, googleResponse } from './fixtures/routing.mjs'
import { googlePlans } from '../src/google-routes.ts'
import { matchSubway } from '../src/gtfs-match.ts'
import { parseTripPlan, toTrackerStops, routeTextFromPlan } from '../src/trip-plan.ts'
import { StationTracker, defaultSettings, parseRoute } from '../src/station-tracker.ts'
import { plannerApi } from '../server/planner-api.mjs'

const clone = value => structuredClone(value)
const segment = { lineId: '1', stopCount: 2, departureTime: request.departureTime, arrivalTime: '2026-10-17T16:04:00Z', from: catalog.stops.A, to: catalog.stops.C }

test('Google train legs expand to actual scheduled stops and exclude station dwell from travel time', () => {
  const result = googlePlans(googleResponse, request, catalog, request.departureTime)
  assert.equal(result.rejected.length, 0)
  const plan = result.plans[0]
  assert.deepEqual(plan.legs[0].stops.map(s => s.id), ['A', 'B', 'C'])
  assert.deepEqual(plan.legs[0].stops.map(s => s.travelSeconds), [0, 120, 100])
  assert.equal(plan.legs[1].kind, 'walk')
  assert.equal(plan.legs[2].schedule.tripId, 'train-two')
  assert.deepEqual(parseTripPlan(JSON.parse(JSON.stringify(plan))), plan)
})

test('Google line suffixes match MTA service names without accepting other lines', () => {
  const response = clone(googleResponse)
  response.routes[0].legs[0].steps[0].transitDetails.transitLine.nameShort = '1 Line'
  response.routes[0].legs[0].steps[2].transitDetails.transitLine.nameShort = '2 Line'
  assert.equal(googlePlans(response, request, catalog).plans.length, 1)
  assert.throws(() => matchSubway({ ...segment, lineId: '3 Line' }, catalog), /No MTA schedule match/)
})

test('journey arrival uses explicit train times and egress, rather than assuming a duration begins at the requested clock time', () => {
  const response = clone(googleResponse)
  response.routes[0].duration = '600s'
  const result = googlePlans(response, request, catalog)
  assert.equal(result.plans[0].arrivalTime, '2026-10-17T16:18:00.000Z')
})

test('transfer walks do not create a counted boarding stop, and the original full plan survives tracker export', () => {
  const plan = googlePlans(googleResponse, request, catalog).plans[0]
  const stops = toTrackerStops(plan)
  assert.deepEqual(stops.map(s => s.name), ['Alpha', 'Bravo', 'Charlie', 'Echo'])
  assert.equal(stops[2].transfer, true)
  assert.match(stops[2].instruction, /Delta boarding/)
  assert.match(stops[0].instruction, /Line 1.*Uptown/)
  assert.deepEqual(parseRoute(routeTextFromPlan(plan)), stops)
  const tracker = new StationTracker(); tracker.loadTripPlan(plan, defaultSettings, 0)
  assert.equal(tracker.snapshot().tripPlan.legs[2].stops[0].id, 'D')
  tracker.correct(2, 100)
  assert.equal(tracker.state, 'waiting-boarding')
  // Loading a manual route clears provider provenance after stopping.
  tracker.stop(200); tracker.load(parseRoute('A\nB | 12'), defaultSettings, 300)
  assert.equal(tracker.tripPlan, null)
})

test('express/local mismatch, wrong direction, missing timings, and stale calendars are rejected', () => {
  assert.throws(() => matchSubway({ ...segment, stopCount: 1 }, catalog), /No MTA schedule match/)
  assert.throws(() => matchSubway({ ...segment, from: segment.to, to: segment.from }, catalog), /No MTA schedule match/)
  const stale = clone(catalog); stale.calendars.daily.end = '20260102'
  assert.throws(() => matchSubway(segment, stale), /No MTA schedule match/)
  const response = clone(googleResponse); delete response.routes[0].legs[0].steps[0].transitDetails.stopCount
  assert.equal(googlePlans(response, request, catalog).plans.length, 0)
})

test('multiple valid paths with the same stop count are rejected instead of guessed', () => {
  const ambiguous = clone(catalog)
  ambiguous.stops.X = { name: 'Other station', latitude: 40.7, longitude: -73.9, parent: '' }
  const alternate = clone(ambiguous.trips[0]); alternate.id = 'other-pattern'; alternate.stops[1].id = 'X'
  ambiguous.trips.push(alternate)
  assert.throws(() => matchSubway(segment, ambiguous), /Ambiguous/)
})

test('service exceptions and after-midnight GTFS times use the NYC service date', () => {
  const overnight = clone(catalog)
  overnight.calendars = {}
  overnight.exceptions.daily = { '20261016': 1 }
  overnight.trips[0].stops.forEach(s => { s.arrival += 44100; s.departure += 44100 })
  const result = matchSubway({ ...segment, departureTime: '2026-10-17T04:15:00Z', arrivalTime: '2026-10-17T04:19:00Z' }, overnight)
  assert.equal(result.schedule.serviceDate, '2026-10-16')
  overnight.exceptions.daily['20261016'] = 2
  assert.throws(() => matchSubway({ ...segment, departureTime: '2026-10-17T04:15:00Z', arrivalTime: '2026-10-17T04:19:00Z' }, overnight), /No MTA/)
})

test('non-subway alternatives are rejected individually and invalid plans cannot load', () => {
  const response = clone(googleResponse)
  const bad = clone(response.routes[0]); bad.legs[0].steps[0].transitDetails.transitLine.vehicle.type = 'BUS'
  response.routes.unshift(bad)
  const result = googlePlans(response, request, catalog)
  assert.equal(result.plans.length, 1); assert.equal(result.rejected.length, 1)
  const plan = clone(result.plans[0]); plan.legs[0].stops[1].travelSeconds = -1
  assert.throws(() => parseTripPlan(plan), /number/)
})

async function invoke(api, payload, headers = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(payload))])
  req.method = 'POST'; req.url = '/api/trips/plan'
  req.headers = { host: 'localhost:5173', origin: 'http://localhost:5173', 'content-type': 'application/json', ...headers }
  let code, body
  await api(req, { writeHead(c) { code = c }, end(value) { body = JSON.parse(value) } }, () => assert.fail('Unexpected fallthrough'))
  return { code, body }
}

test('route API keeps the key on the server, sends subway fields, and rejects foreign origins', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'alwaysontrack-routing-')), file = path.join(dir, 'catalog.json')
  await writeFile(file, JSON.stringify(catalog))
  t.after(async () => { await unlink(file); await rmdir(dir) })
  let calls = 0
  const api = plannerApi({ apiKey: 'fixture-secret-key', catalogPath: file, fetchImpl: async (url, options) => {
    calls++
    assert.equal(url, 'https://routes.googleapis.com/directions/v2:computeRoutes')
    assert.equal(options.headers['X-Goog-Api-Key'], 'fixture-secret-key')
    assert.match(options.headers['X-Goog-FieldMask'], /transitDetails/)
    assert.deepEqual(JSON.parse(options.body).transitPreferences.allowedTravelModes, ['SUBWAY'])
    return { ok: true, json: async () => googleResponse }
  } })
  const result = await invoke(api, request)
  assert.equal(result.code, 200)
  assert.ok(!JSON.stringify(result.body).includes('fixture-secret-key'))
  assert.equal((await invoke(api, request, { origin: 'https://elsewhere.example' })).code, 403)
  assert.equal((await invoke(api, request, { origin: 'invalid-url' })).code, 403)
  assert.equal((await invoke(api, null)).code, 400)
  assert.equal(calls, 1)
  const denied = plannerApi({ apiKey: 'fixture', catalogPath: file, fetchImpl: async () => ({ ok: false, status: 403 }) })
  assert.equal((await invoke(denied, request)).code, 502)
  const unresolved = plannerApi({ apiKey: 'fixture', catalogPath: file, fetchImpl: async () => ({ ok: true, json: async () => ({ routes: [] }) }) })
  assert.equal((await invoke(unresolved, request)).code, 422)
})

test('missing key, missing catalog and provider failures are actionable without fake fallback', async () => {
  const missingKey = plannerApi({ catalogPath: 'missing-fixture.json', fetchImpl: () => assert.fail('No provider call expected') })
  assert.equal((await invoke(missingKey, request)).code, 503)
  const missingCatalog = plannerApi({ apiKey: 'fixture', catalogPath: 'missing-fixture.json', fetchImpl: () => assert.fail('No provider call expected') })
  assert.match((await invoke(missingCatalog, request)).body.error, /gtfs:import/)
})
