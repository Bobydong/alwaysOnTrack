import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GlassesSpeech } from '../src/asr/stt.ts'
import { GlassesPlanner } from '../src/glasses-planner.ts'
import { planningView } from '../src/planning-view.ts'
import { googlePlans } from '../src/google-routes.ts'
import { catalog, request, googleResponse } from './fixtures/routing.mjs'
import { understandTrip, planConfirmedTrip } from '../server/glasses-planning.mjs'
import { checkTripLocations } from '../server/locations.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))
const call = (name, args) => ({ role: 'model', parts: [{ functionCall: { name, args } }] })
const plans = googlePlans(googleResponse, request, catalog).plans
const resolvedIntent = () => ({ origin: 'Wall Street', destination: 'Bronx Zoo', resolutionId: 'fixture-resolution',
  originCandidates: [{ placeId: 'wall-street', name: 'Wall Street', address: 'Manhattan' }],
  destinationCandidates: [{ placeId: 'bronx-zoo', name: 'Bronx Zoo', address: 'Bronx' }] })
function setup(fetchImpl, load = () => {}) {
  const speech = new GlassesSpeech(async () => true, async () => ({ ok: true, json: async () => ({ text: 'Wall Street to Bronx Zoo' }) }))
  return { speech, controller: new GlassesPlanner(speech, load, fetchImpl) }
}
async function record(speech, controller) {
  await controller.tap(); speech.sendPcm(new Uint8Array(10000)); await controller.tap(); await tick()
}

test('glasses flow waits for endpoint confirmation, then automatically loads the recommended verified plan', async t => {
  let loaded, searches = 0
  const { speech, controller } = setup(async function (url, options) {
    assert.equal(this, globalThis)
    if (url.endsWith('/intent')) return { ok: true, json: async () => resolvedIntent() }
    searches++; assert.deepEqual(JSON.parse(options.body), { origin: 'Wall Street, Manhattan', destination: 'Bronx Zoo, Bronx',
      resolutionId: 'fixture-resolution', originPlaceId: 'wall-street', destinationPlaceId: 'bronx-zoo' })
    return { ok: true, json: async () => ({ plans, recommendedId: plans.at(-1).id }) }
  }, plan => { loaded = plan })
  t.after(() => speech.cancel())
  assert.equal(controller.snapshot().phase, 'prompt')
  await record(speech, controller)
  assert.equal(controller.snapshot().phase, 'confirm'); assert.equal(searches, 0)
  await controller.tap()
  assert.equal(controller.snapshot().phase, 'loaded'); assert.equal(loaded.id, plans.at(-1).id); assert.equal(searches, 1)
  assert.equal(await controller.tap(), false)
})

test('scroll and No discard the understood endpoints without a route request', async t => {
  const { speech, controller } = setup(async url => {
    assert.ok(url.endsWith('/intent'))
    return { ok: true, json: async () => resolvedIntent() }
  }, () => assert.fail('No must not load a route'))
  t.after(() => speech.cancel())
  await record(speech, controller); controller.scroll(); assert.equal(controller.snapshot().yes, false)
  await controller.tap(); assert.equal(controller.snapshot().phase, 'prompt'); assert.equal(controller.snapshot().origin, '')
  await controller.tap(); assert.equal(speech.phase, 'recording')
})

test('ambiguous landmarks can be scrolled and selected before final Yes/No; only selected IDs are submitted', async t => {
  let requestBody
  const intent = resolvedIntent()
  intent.originCandidates.push({ placeId: 'other-macy', name: "Macy's Herald Square", address: '151 W 34th St, New York, NY' })
  intent.destinationCandidates.push({ placeId: 'times-square', name: 'Times Square', address: 'Manhattan, NY' })
  const { speech, controller } = setup(async (url, options) => {
    if (url.endsWith('/intent')) return { ok: true, json: async () => intent }
    requestBody = JSON.parse(options.body); return { ok: true, json: async () => ({ plans }) }
  })
  t.after(() => speech.cancel())
  await record(speech, controller); assert.equal(controller.snapshot().phase, 'choose-origin')
  controller.scroll(-1); assert.equal(controller.snapshot().originIndex, 1)
  const view = planningView(controller.snapshot(), speech.snapshot())
  assert.match(view.map(p => p.content).join('\n'), /151 W 34th St/)
  await controller.tap(); assert.equal(controller.snapshot().phase, 'choose-destination')
  controller.scroll(); await controller.tap(); assert.equal(controller.snapshot().phase, 'confirm')
  assert.match(controller.snapshot().origin, /Herald Square/)
  await controller.tap(); assert.equal(requestBody.originPlaceId, 'other-macy'); assert.equal(requestBody.destinationPlaceId, 'times-square')
  assert.equal(requestBody.resolutionId, 'fixture-resolution')
})

test('reset ignores a late intent result and a late route result', async t => {
  for (const pendingStage of ['intent', 'plan-confirmed']) {
    let resolve
    const wait = new Promise(r => { resolve = r })
    const { speech, controller } = setup(async url => {
      if (url.endsWith(pendingStage)) return wait
      return { ok: true, json: async () => resolvedIntent() }
    }, () => assert.fail('Cancelled preparation cannot load a route'))
    t.after(() => speech.cancel())
    await record(speech, controller)
    const tap = pendingStage === 'plan-confirmed' ? controller.tap() : Promise.resolve()
    await controller.reset()
    resolve({ ok: true, json: async () => pendingStage === 'intent' ? { origin: 'Old', destination: 'Old' } : { plans } })
    await tap; await tick(); assert.equal(controller.snapshot().phase, 'prompt')
  }
})

test('planning failure displays an error and cannot fall back to an unrelated route', async t => {
  const { speech, controller } = setup(async url => ({ ok: url.endsWith('/intent'), json: async () => url.endsWith('/intent')
    ? resolvedIntent() : { error: 'No fully resolved NYC subway itinerary was found.' } }), () => assert.fail())
  t.after(() => speech.cancel())
  await record(speech, controller); await controller.tap()
  assert.equal(controller.snapshot().phase, 'error'); assert.match(controller.snapshot().error, /No fully resolved/)
  await controller.tap(); assert.equal(speech.phase, 'recording')
})

test('full-display setup layouts fit and keep a single empty gesture target', () => {
  for (const phase of ['prompt', 'listening', 'understanding', 'confirm', 'planning', 'error']) {
    const state = { phase, origin: 'Wall Street', destination: 'Bronx Zoo', yes: false, error: 'Please try again.' }
    const panels = planningView(state, { phase: 'recording' })
    assert.equal(panels.filter(p => p.isEventCapture).length, 1)
    for (const p of panels) { assert.ok(p.xPosition + p.width <= 576); assert.ok(p.yPosition + p.height <= 288) }
    const text = panels.map(p => p.content).join('\n')
    if (phase === 'confirm') { assert.match(text, /FROM: Wall Street/); assert.match(text, /TO: Bronx Zoo/); assert.match(text, /> NO/) }
    if (phase === 'listening') assert.match(text, /TAP TO SUBMIT PLAN/)
  }
})

test('intent extraction never routes, rejects missing endpoints, and uses bounded tool output', async () => {
  const result = await understandTrip(async () => call('understood_trip', { origin: 'Wall Street', destination: 'Bronx Zoo' }), { text: 'Wall Street to Bronx Zoo' })
  assert.deepEqual(result, { origin: 'Wall Street', destination: 'Bronx Zoo' })
  await assert.rejects(understandTrip(async () => call('understood_trip', { origin: '', destination: 'Bronx Zoo' }), { text: 'Take me to Bronx Zoo' }), e => e.status === 422)
})

test('bare numbered streets require an intersection before a route request', async () => {
  for (const origin of ['42nd Street', '22nd St', 'West 42nd Street, Manhattan', '42 St station, NYC']) {
    assert.throws(() => checkTripLocations({ origin, destination: 'Bronx Zoo' }), e => e.status === 422 && /avenue or station/.test(e.message))
  }
  for (const origin of ['Times Sq-42 St', 'Grand Central-42 St', '42nd Street and Broadway', '23 St on the F line']) {
    assert.doesNotThrow(() => checkTripLocations({ origin, destination: 'Bronx Zoo' }))
  }
  await assert.rejects(understandTrip(async () => call('understood_trip', { origin: '42nd Street', destination: '22nd Street' }),
    { text: 'From 42nd Street to 22nd Street' }), e => e.status === 422)
  await assert.rejects(planConfirmedTrip({ body: { origin: '42nd Street', destination: '22nd Street' }, planner: { plan: () => assert.fail('Do not guess broad street endpoints') } }), e => e.status === 422)
})

test('confirmed route planning keeps exact approved endpoints and falls back to a verified route if ranking fails', async () => {
  const body = { origin: 'Wall Street', destination: 'Bronx Zoo' }
  const result = await planConfirmedTrip({ body, planner: { plan: async request => { assert.deepEqual(request, body); return { plans } } }, generate: async () => { throw Error('Ranking unavailable') } })
  assert.equal(result.recommendedId, plans[0].id)
  await assert.rejects(planConfirmedTrip({ body: {}, planner: { plan: () => assert.fail() } }), e => e.status === 400)
})
