import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPlaceResolver } from '../server/places.mjs'
import { createRoutePlanner } from '../server/route-service.mjs'
import { catalog, request, googleResponse } from './fixtures/routing.mjs'

const place = (id, text = id) => ({ id, displayName: { text }, formattedAddress: '151 W 34th St, New York, NY, USA', location: { latitude: 40.75, longitude: -73.99 } })
test('Google Places search requests names, addresses and IDs with NYC bias; filters duplicates and outside results', async () => {
  const calls = []
  const resolver = createPlaceResolver({ apiKey: 'fixture-secret', fetchImpl: async (url, options) => {
    calls.push(JSON.parse(options.body)); assert.equal(url, 'https://places.googleapis.com/v1/places:searchText')
    assert.equal(options.headers['X-Goog-Api-Key'], 'fixture-secret'); assert.match(options.headers['X-Goog-FieldMask'], /places.id/)
    return { ok: true, json: async () => ({ places: [place('macy'), place('macy'), { ...place('outside'), location: { latitude: 51, longitude: 0 } }] }) }
  } })
  const result = await resolver.resolve({ origin: "Macy's", destination: 'Times Square' })
  assert.equal(calls.length, 2); assert.equal(calls[0].textQuery, "Macy's, New York City")
  assert.ok(calls[0].locationBias.rectangle); assert.equal(calls[0].pageSize, 5)
  assert.equal(result.originCandidates.length, 1); assert.equal(result.originCandidates[0].placeId, 'macy')
  assert.ok(!JSON.stringify(result).includes('fixture-secret'))
})

test('place confirmations reject forged selections, unknown sessions, and expired lookups', async () => {
  let now = 0
  const resolver = createPlaceResolver({ apiKey: 'fixture', now: () => now, fetchImpl: async () => ({ ok: true, json: async () => ({ places: [place('valid')] }) }) })
  const result = await resolver.resolve({ origin: "Macy's", destination: 'Times Square' })
  const body = { resolutionId: result.resolutionId, originPlaceId: 'valid', destinationPlaceId: 'valid' }
  assert.equal(resolver.confirmed(body).origin.placeId, 'valid')
  assert.throws(() => resolver.confirmed({ ...body, originPlaceId: 'invented' }), e => e.status === 400)
  assert.throws(() => resolver.confirmed({ ...body, resolutionId: 'invented' }), e => e.status === 422)
  now = 15 * 60000
  assert.throws(() => resolver.confirmed(body), /expired/)
})

test('Places permission failures and no results are explicit and do not fall back to model guesses', async () => {
  const input = { origin: "Macy's", destination: 'Times Square' }
  const denied = createPlaceResolver({ apiKey: 'fixture', fetchImpl: async () => ({ ok: false, status: 403 }) })
  await assert.rejects(denied.resolve(input), /Enable Places API \(New\)/)
  const missing = createPlaceResolver({ apiKey: 'fixture', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) })
  await assert.rejects(missing.resolve(input), e => e.status === 422 && /No NYC place/.test(e.message))
})

test('Routes uses selected server-verified place IDs and ignores client-supplied place labels', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'alwaysontrack-places-')), file = path.join(dir, 'catalog.json')
  await writeFile(file, JSON.stringify(catalog)); t.after(async () => { await unlink(file); await rmdir(dir) })
  let searches = 0, routeCalls = 0
  const planner = createRoutePlanner({ apiKey: 'fixture', catalogPath: file, fetchImpl: async (url, options) => {
    if (url.includes('places:searchText')) { searches++; return { ok: true, json: async () => ({ places: [place('first'), place('second')] }) } }
    routeCalls++
    const body = JSON.parse(options.body)
    assert.deepEqual(body.origin, { placeId: 'second' }); assert.deepEqual(body.destination, { placeId: 'first' })
    return { ok: true, json: async () => googleResponse }
  } })
  const lookup = await planner.resolveLocations({ origin: "Macy's", destination: 'Times Square' })
  const body = { ...request, resolutionId: lookup.resolutionId, originPlaceId: 'second', destinationPlaceId: 'first' }
  const result = await planner.plan(body)
  assert.equal(searches, 2); assert.equal(routeCalls, 1); assert.match(result.plans[0].origin, /^second,/)
  await assert.rejects(planner.plan({ ...body, originPlaceId: 'invented' }), e => e.status === 400)
  assert.equal(routeCalls, 1)
})
