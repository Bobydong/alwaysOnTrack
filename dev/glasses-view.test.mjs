import { test } from 'node:test'
import assert from 'node:assert/strict'
import { glassesView, glassesLayoutKey, glassesSpacing } from '../src/glasses-view.ts'
import { journeyView } from '../src/journey-view.ts'
import { StationTracker, demoSettings, parseRoute } from '../src/station-tracker.ts'
import { googlePlans } from '../src/google-routes.ts'
import { catalog, request, googleResponse } from './fixtures/routing.mjs'

const route = 'Start | 0 | Board the Blue Line\nMiddle | 12\nTransfer | 12 | Change to the Green Line | transfer\nEnd | 12 | Use the north exit'
const panel = (view, name) => view.find(p => p.containerName === name)?.content.replaceAll('\n', ' ')
const make = () => { const t = new StationTracker(); t.load(parseRoute(route), demoSettings, 0); return t }
function validate(view) {
  assert.equal(view.filter(p => p.isEventCapture === 1).length, 1)
  assert.equal(new Set(view.map(p => p.containerID)).size, view.length)
  assert.ok(view.reduce((sum, p) => sum + p.content.length, 0) <= 1000)
  for (const a of view) {
    assert.ok(a.xPosition >= 0 && a.yPosition >= 0 && a.xPosition + a.width <= 576 && a.yPosition + a.height <= 288)
    assert.ok(a.content.split('\n').length * glassesSpacing.lineHeight + a.paddingLength * 2 <= a.height)
    if (a.containerName !== 'trip-input') {
      assert.equal(a.paddingLength, 10)
      assert.equal(a.borderWidth, 0)
      assert.ok(a.yPosition + a.height <= 144 || a.yPosition >= 164)
      assert.ok(a.xPosition + a.width <= 272 || a.xPosition >= 304)
    }
    assert.ok(a.borderWidth <= 5 && a.borderColor <= 15 && a.borderRadius <= 10)
    assert.ok(a.containerName.length <= 16)
    for (const b of view.filter(b => b.containerID !== a.containerID && b.containerName !== 'trip-input' && a.containerName !== 'trip-input')) {
      assert.ok(a.xPosition + a.width <= b.xPosition || b.xPosition + b.width <= a.xPosition || a.yPosition + a.height <= b.yPosition || b.yPosition + b.height <= a.yPosition)
    }
  }
}

test('all journey layouts leave the center clear, have no borders, and fit with one gesture target', () => {
  const t = make()
  validate(glassesView(new StationTracker(), 0))
  for (const state of ['ready', 'waiting-departure', 'travelling', 'arrival-watch', 'candidate', 'cooldown', 'waiting-boarding', 'complete']) {
    t.state = state
    validate(glassesView(t, 0))
    t.stationIndex = 1; validate(glassesView(t, 0)); t.stationIndex = 0
  }
})

test('boarding contains only station, train and boarding tap prompt; tapping switches to tracking', () => {
  const t = make(), before = glassesView(t, 0)
  assert.equal(before.length, 4)
  assert.match(panel(before, 'trip-station'), /BOARD AT Start/)
  assert.match(panel(before, 'trip-detail'), /Blue Line/)
  assert.equal(panel(before, 'trip-action'), 'TAP ONCE ABOARD')
  assert.equal(before.find(p => p.containerName === 'trip-detail').borderWidth, 0)
  assert.equal(before.find(p => p.containerName === 'trip-action').isEventCapture, 0)
  assert.equal(before.find(p => p.isEventCapture === 1).content.trim(), '')
  assert.ok(before.find(p => p.containerName === 'trip-action').height >= 40)
  assert.equal(panel(before, 'trip-progress'), undefined)
  assert.ok(before.find(p => p.containerName === 'trip-station').xPosition < 288)
  assert.ok(before.find(p => p.containerName === 'trip-detail').xPosition > 288)
  assert.ok(before.find(p => p.containerName === 'trip-action').yPosition >= 192)
  t.arm(0)
  const after = glassesView(t, 0)
  assert.notEqual(glassesLayoutKey(before), glassesLayoutKey(after))
  assert.match(panel(after, 'trip-station'), /NEXT STATION Middle/)
  assert.equal(panel(after, 'trip-detail'), 'GET OFF AT Transfer')
  assert.ok(!after.some(p => /Blue Line/.test(p.content)))
  assert.equal(panel(after, 'trip-progress'), 'STOP 0/2')
})

test('countdown ticks retain geometry and detection/veto status stays bottom anchored', () => {
  const t = make(); t.arm(0); t.manualDeparture(0)
  t.ingest({ t: 1000, acceleration: { x: 0.02, y: 0, z: 0 } })
  const a = glassesView(t, 1000), b = glassesView(t, 1500)
  assert.match(panel(a, 'trip-action'), /DETECTION OPENS IN 9s/)
  assert.equal(glassesLayoutKey(a), glassesLayoutKey(b))
  t.state = 'candidate'; t.candidateUntil = 6000
  assert.match(panel(glassesView(t, 1500), 'trip-action'), /TAP IF NOT AT Middle/)
  assert.equal(panel(glassesView(t, 1500), 'trip-station'), 'NEXT STATION Transfer')
  assert.equal(panel(glassesView(t, 1500), 'trip-progress'), 'STOP 1/2')
  assert.equal(t.stationIndex, 0)
  const candidate = glassesView(t, 1500)
  for (const view of [a, candidate]) {
    const status = view.find(p => p.containerName === 'trip-action')
    assert.equal(status.yPosition + status.height, 288 - glassesSpacing.margin)
  }
  validate(candidate)
})

test('next station matches get-off station on approach; transfer train appears only after arrival', () => {
  const t = make(); t.arm(0); t.correct(1, 0)
  const approaching = glassesView(t, 0)
  assert.equal(panel(approaching, 'trip-station'), 'NEXT STATION Transfer')
  assert.equal(panel(approaching, 'trip-detail'), 'GET OFF AT Transfer')
  assert.ok(!approaching.some(p => /Green Line/.test(p.content)))
  assert.equal(panel(approaching, 'trip-progress'), 'STOP 1/2')
  t.state = 'candidate'; t.candidateUntil = 6000; t.lastValidAt = 0
  const detected = glassesView(t, 0)
  assert.equal(detected.length, 4)
  assert.equal(panel(detected, 'trip-station'), 'BOARD AT Transfer')
  assert.match(panel(detected, 'trip-detail'), /Green Line/)
  assert.match(panel(detected, 'trip-action'), /TAP IF NOT AT Transfer/)
  assert.ok(!detected.some(p => /TAP ONCE ABOARD/.test(p.content)))
  t.veto(0)
  assert.equal(t.stationIndex, 1)
  assert.match(panel(glassesView(t, 0), 'trip-action'), /RETRY IN/)
  assert.match(panel(glassesView(t, 0), 'trip-station'), /NEXT STATION Transfer/)
  t.correct(2, 100)
  assert.equal(t.state, 'waiting-boarding')
  const board = glassesView(t, 100)
  assert.equal(board.length, 4)
  assert.match(panel(board, 'trip-station'), /BOARD AT Transfer/)
  assert.match(panel(board, 'trip-detail'), /Green Line/)
  assert.equal(panel(board, 'trip-action'), 'TAP ONCE ABOARD')
  t.arm(200)
  assert.match(panel(glassesView(t, 200), 'trip-station'), /NEXT STATION End/)
  assert.equal(panel(glassesView(t, 200), 'trip-detail'), 'GET OFF AT End')
  assert.ok(!glassesView(t, 200).some(p => /Green Line|exit signs/i.test(p.content)))
  assert.equal(panel(glassesView(t, 200), 'trip-progress'), 'STOP 0/1')
  t.correct(3, 300)
  assert.equal(glassesView(t, 300).length, 3)
  assert.match(panel(glassesView(t, 300), 'trip-station'), /YOU HAVE ARRIVED End/)
  assert.equal(panel(glassesView(t, 300), 'trip-detail'), 'Follow exit signs.')
  const exit = glassesView(t, 300).find(p => p.containerName === 'trip-detail')
  assert.equal(exit.yPosition, glassesSpacing.margin)
  assert.equal(exit.xPosition + exit.width, 576 - glassesSpacing.margin)
})

test('API plans use the next ride boarding station across transfer walks and keep direction headsign', () => {
  const plan = googlePlans(googleResponse, request, catalog).plans[0]
  const t = new StationTracker(); t.loadTripPlan(plan, demoSettings, 0)
  assert.deepEqual(journeyView(t).boarding, { station: 'Alpha', train: 'Board the 1-line to Uptown' })
  t.arm(0); t.correct(1, 0)
  assert.equal(journeyView(t).approaching, true)
  assert.match(journeyView(t).instruction, /2 train toward East.*Delta boarding/)
  t.state = 'candidate'; t.candidateUntil = 6000; t.lastValidAt = 0
  const pendingTransfer = glassesView(t, 0)
  assert.match(panel(pendingTransfer, 'trip-station'), /BOARD AT Delta boarding/)
  assert.match(panel(pendingTransfer, 'trip-action'), /TAP IF NOT AT Charlie/)
  t.correct(2, 100)
  assert.equal(journeyView(t).boarding.station, 'Delta boarding')
  assert.match(panel(glassesView(t, 100), 'trip-station'), /BOARD AT Delta boarding/)
  assert.match(panel(glassesView(t, 100), 'trip-detail'), /Board the 2-line to East/)
  t.arm(200)
  assert.equal(panel(glassesView(t, 200), 'trip-progress'), 'STOP 0/1')
})

test('missing motion overrides detection status, and long train instructions fit the boarding card', () => {
  const t = make(); t.arm(0)
  assert.equal(panel(glassesView(t, 2000), 'trip-action'), 'WAITING FOR PHONE MOTION')
  const stops = parseRoute(route); stops[0].instruction = 'Long instruction for the next train and its boarding station. '.repeat(2)
  t.stop(3000); t.load(stops, demoSettings, 4000)
  const view = glassesView(t, 4000); validate(view)
  assert.ok(panel(view, 'trip-detail').endsWith('...'))
})

test('long station names and instructions resize inward from fixed outer corner anchors', () => {
  const t = make()
  const stops = parseRoute(route).map(s => ({ ...s, name: 'A very long station name including an avenue and neighborhood'.repeat(2).slice(0, 100), instruction: 'Board the downtown train to the next station and follow transfer signs. '.repeat(2) }))
  t.load(stops, demoSettings, 0)
  const short = glassesView(make(), 0).find(p => p.containerName === 'trip-station')
  const long = glassesView(t, 0).find(p => p.containerName === 'trip-station')
  assert.ok(long.height > short.height)
  assert.equal(long.xPosition, short.xPosition)
  for (const state of ['ready', 'waiting-departure', 'travelling', 'arrival-watch', 'candidate', 'cooldown', 'waiting-boarding', 'complete']) {
    for (const index of [0, 1, 2, 3]) {
      t.state = state; t.stationIndex = index
      validate(glassesView(t, 0)); validate(glassesView(t, 2000))
    }
  }
})

test('right text blocks grow leftward and bottom blocks grow upward', () => {
  const t = make()
  const short = glassesView(t, 0).find(p => p.containerName === 'trip-detail')
  const stops = parseRoute(route); stops[0].instruction = 'Board the downtown D-line to the final station'
  t.load(stops, demoSettings, 0)
  const longer = glassesView(t, 0).find(p => p.containerName === 'trip-detail')
  assert.ok(longer.width > short.width)
  assert.ok(longer.xPosition < short.xPosition)
  assert.equal(short.xPosition + short.width, longer.xPosition + longer.width)
  assert.equal(short.yPosition, longer.yPosition)
  t.arm(0); t.manualDeparture(0); t.lastValidAt = 0
  const fresh = glassesView(t, 0).find(p => p.containerName === 'trip-action')
  const stale = glassesView(t, 2000).find(p => p.containerName === 'trip-action')
  assert.equal(fresh.yPosition + fresh.height, stale.yPosition + stale.height)
})

test('destination directions appear during correction window and disappear if arrival is rejected', () => {
  const t = make(); t.arm(0); t.correct(2, 0); t.arm(0)
  t.state = 'candidate'; t.candidateUntil = 6000; t.lastValidAt = 0
  const pending = glassesView(t, 0)
  assert.equal(panel(pending, 'trip-station'), 'YOU HAVE ARRIVED End')
  assert.equal(panel(pending, 'trip-detail'), 'Follow exit signs.')
  assert.match(panel(pending, 'trip-action'), /TAP IF NOT AT End 6s left/)
  assert.equal(t.stationIndex, 2)
  t.veto(0)
  const restored = glassesView(t, 0)
  assert.equal(panel(restored, 'trip-station'), 'NEXT STATION End')
  assert.equal(panel(restored, 'trip-detail'), 'GET OFF AT End')
  assert.ok(!restored.some(p => /Follow exit signs/.test(p.content)))
})

test('sensor gap removes provisional transfer instructions without changing confirmed position', () => {
  const t = make(); t.arm(0); t.correct(1, 0)
  t.state = 'candidate'; t.candidateUntil = 6000; t.lastValidAt = 0
  assert.match(panel(glassesView(t, 0), 'trip-detail'), /Green Line/)
  t.arm(100)
  assert.equal(t.state, 'candidate', 'boarding cannot start while a tap means station correction')
  t.suspend(2000, 'Sensor gap')
  const restored = glassesView(t, 2000)
  assert.equal(t.stationIndex, 1)
  assert.equal(panel(restored, 'trip-station'), 'NEXT STATION Transfer')
  assert.equal(panel(restored, 'trip-detail'), 'GET OFF AT Transfer')
})
