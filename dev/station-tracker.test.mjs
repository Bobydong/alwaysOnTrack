import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StationTracker, defaultSettings, demoSettings, parseRoute } from '../src/station-tracker.ts'
import { tripStatus } from '../src/trip-status.ts'

function session(settings = defaultSettings, armed = true, routeText = 'Start\nMiddle | 12\nEnd | 12') {
  const tracker = new StationTracker()
  let t = 0
  tracker.load(parseRoute(routeText), settings, t)
  if (armed) tracker.arm(t)
  const feed = (ms, acceleration = { x: 0.02, y: 0, z: 0 }) => {
    for (let i = 0; i < ms; i += 20) {
      t += 20
      tracker.ingest({ t, wallTime: '', label: 'test', acceleration,
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 20 })
    }
  }
  const motion = ms => feed(ms, { x: 0.8, y: 0, z: 0 })
  const brake = () => { motion(2000); feed(1400, { x: -0.8, y: 0, z: 0 }) }
  const depart = () => { feed(1000); motion(2000); assert.equal(tracker.state, 'travelling') }
  const candidate = () => {
    depart(); feed(12000); brake(); feed(4000)
    assert.equal(tracker.state, 'candidate')
  }
  return { tracker, feed, motion, brake, depart, candidate, now: () => t }
}

test('early motion is ignored; braking plus dwell plus veto time counts once and resets departure timing', () => {
  const s = session(); s.depart()
  s.brake(); s.feed(4000)
  assert.equal(s.tracker.state, 'travelling')
  assert.equal(s.tracker.stationIndex, 0)
  assert.ok(s.tracker.events.some(e => e.action === 'early-motion-ignored'))
  s.feed(6000)
  assert.equal(s.tracker.state, 'arrival-watch')
  assert.equal(s.tracker.stationIndex, 0)
  s.brake(); s.feed(4000)
  assert.equal(s.tracker.state, 'candidate')
  s.feed(9000)
  assert.equal(s.tracker.stationIndex, 1)
  assert.equal(s.tracker.state, 'waiting-departure')
  assert.equal(s.tracker.departureAt, null)
  s.feed(10000)
  assert.equal(s.tracker.stationIndex, 1)
  s.motion(2000); s.feed(12000); s.brake(); s.feed(14000)
  assert.equal(s.tracker.stationIndex, 2)
  assert.equal(s.tracker.state, 'complete')
})

test('passing the expected time while quiet never counts an arrival', () => {
  const s = session(); s.depart(); s.feed(60000)
  assert.equal(s.tracker.state, 'arrival-watch')
  assert.equal(s.tracker.stationIndex, 0)
  assert.ok(!s.tracker.events.some(e => e.action === 'arrival-candidate'))
})

test('veto cancels the count and requires new evidence after a cooldown', () => {
  const s = session(); s.candidate(); s.tracker.veto(s.now()); s.feed(20000)
  assert.equal(s.tracker.stationIndex, 0)
  assert.equal(s.tracker.state, 'arrival-watch')
  s.brake(); s.feed(14000)
  assert.equal(s.tracker.stationIndex, 1)
})

test('a sensor gap cancels a candidate; missing events do not count as dwell', () => {
  const s = session(); s.candidate()
  s.tracker.tick(s.now() + 20000)
  assert.equal(s.tracker.stationIndex, 0)
  assert.equal(s.tracker.state, 'cooldown')
  assert.match(tripStatus(s.tracker, s.now() + 20000).status, /cancelled.*unavailable/)
})

test('sub-second sensor gaps reset accumulated dwell evidence', () => {
  const s = session(); s.depart(); s.feed(12000); s.brake(); s.feed(2000)
  s.tracker.ingest({ t: s.now() + 800, wallTime: '', label: 'gap', acceleration: { x: 0, y: 0, z: 0 },
    accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 }, rotationRate: { alpha: 0, beta: 0, gamma: 0 }, interval: 20 })
  assert.equal(s.tracker.state, 'arrival-watch')
  assert.equal(s.tracker.meanMagnitude, null)
})

test('missing linear channels cannot use gravity-inclusive values to depart', () => {
  const s = session(); s.feed(10000, { x: null, y: null, z: null })
  assert.equal(s.tracker.state, 'waiting-departure')
  assert.equal(s.tracker.departureAt, null)
})

test('motion during the veto interval leaves the candidate pending until its deadline', () => {
  const s = session(); s.candidate(); s.motion(1000)
  assert.equal(s.tracker.state, 'candidate')
  assert.equal(s.tracker.stationIndex, 0)
  s.feed(s.tracker.candidateUntil - s.now() + 20)
  assert.equal(s.tracker.stationIndex, 1)
})

test('seat-shifting during the veto countdown does not cancel the proposal', () => {
  const s = session(demoSettings); s.tracker.manualDeparture(s.now()); s.feed(16000)
  s.feed(800, { x: 0.5, y: 0, z: 0 }); s.feed(1000)
  assert.equal(s.tracker.state, 'candidate')
  s.motion(500)
  assert.equal(s.tracker.state, 'candidate')
  const view = tripStatus(s.tracker, s.now())
  assert.equal(view.status, 'Possible arrival')
  assert.ok(!view.timing.includes('stay quiet'))
  assert.ok(!s.tracker.events.some(e => e.action === 'candidate-cancelled'))
  s.feed(s.tracker.candidateUntil - s.now() + 20)
  assert.equal(s.tracker.state, 'waiting-departure')
  assert.equal(s.tracker.stationIndex, 1)
})

test('manual correction resets the timer; manual departure can recover a missed departure', () => {
  const s = session(); s.depart(); s.tracker.correct(1, s.now())
  assert.equal(s.tracker.state, 'waiting-departure')
  assert.equal(s.tracker.departureAt, null)
  s.tracker.manualDeparture(s.now())
  assert.equal(s.tracker.state, 'travelling')
  assert.equal(s.tracker.watchAt, s.now() + 10000)
  s.tracker.correct(2, s.now())
  assert.equal(s.tracker.state, 'complete')
})

test('route/settings are validated and locked during tracking', () => {
  assert.throws(() => parseRoute('One stop'))
  assert.throws(() => parseRoute('Start\nEnd | 0'))
  const s = session()
  assert.throws(() => s.tracker.load(parseRoute('A\nB | 60'), defaultSettings, s.now()))
  s.tracker.stop(s.now())
  assert.throws(() => s.tracker.load(parseRoute('A\nB | 60'), { ...defaultSettings, quietThreshold: 2 }, s.now()))
})

test('alternating vibration does not satisfy consistent-direction departure evidence', () => {
  const s = session()
  for (let i = 0; i < 500; i++) s.feed(20, { x: i % 2 ? 1 : -1, y: 0, z: 0 })
  assert.equal(s.tracker.state, 'waiting-departure')
})

test('a loaded trip ignores motion until the user arms it', () => {
  const s = session(demoSettings, false)
  s.motion(3000)
  assert.equal(s.tracker.state, 'ready')
  assert.equal(s.tracker.departureAt, null)
  s.tracker.arm(s.now()); s.motion(2000)
  assert.equal(s.tracker.state, 'travelling')
})

test('demo preserves original departure sensitivity while detecting a softer, shorter braking jolt', () => {
  const s = session(demoSettings)
  s.feed(1000)
  s.feed(3000, { x: 0.25, y: 0, z: 0 })
  assert.equal(s.tracker.state, 'waiting-departure')
  s.feed(1000); s.motion(300); s.feed(1000)
  assert.equal(s.tracker.state, 'waiting-departure')
  s.motion(2000)
  assert.equal(s.tracker.state, 'travelling')
  s.feed(16000)
  assert.equal(s.tracker.state, 'arrival-watch')
  s.feed(700, { x: 0.45, y: 0, z: 0 }); s.feed(700, { x: -0.45, y: 0, z: 0 }); s.feed(1200)
  assert.equal(s.tracker.state, 'candidate')
  assert.equal(s.tracker.stationIndex, 0)
  s.feed(s.tracker.settings.vetoSeconds * 1000)
  assert.equal(s.tracker.stationIndex, 1)
})

test('a single jolt followed by quiet proposes an arrival without recoil', () => {
  const s = session(); s.depart(); s.feed(12000); s.motion(2000); s.feed(4000)
  assert.equal(s.tracker.state, 'candidate')
  assert.ok(s.tracker.events.some(e => e.action === 'braking-jolt'))
})

test('a single jolt works on every phone axis in either direction', () => {
  for (const axis of ['x', 'y', 'z']) for (const sign of [-1, 1]) {
    const s = session(demoSettings); s.tracker.manualDeparture(s.now()); s.feed(16000)
    const pulse = { x: 0, y: 0, z: 0, [axis]: sign * 0.5 }
    s.feed(800, pulse); s.feed(1200)
    assert.equal(s.tracker.state, 'candidate', `${axis} sign ${sign}`)
    assert.ok(s.tracker.events.some(e => e.action === 'braking-jolt'))
  }
})

test('continued motion after a jolt does not count as a stop and expires the evidence', () => {
  const s = session(demoSettings); s.tracker.manualDeparture(s.now()); s.feed(16000)
  s.feed(14000, { x: 0.5, y: 0, z: 0 })
  assert.ok(s.tracker.events.some(e => e.action === 'braking-evidence-expired'))
  assert.ok(!s.tracker.events.some(e => e.action === 'arrival-candidate'))
  assert.equal(s.tracker.stationIndex, 0)
})

test('a sensor gap between a jolt and quiet discards the jolt evidence', () => {
  const s = session(demoSettings); s.tracker.manualDeparture(s.now()); s.feed(16000)
  s.feed(800, { x: 0.5, y: 0, z: 0 })
  s.feed(800, { x: null, y: null, z: null }); s.feed(6000)
  assert.ok(!s.tracker.events.some(e => e.action === 'arrival-candidate'))
})

test('settling time precedes the quiet dwell', () => {
  const s = session({ ...demoSettings, settlingSeconds: 1 })
  s.tracker.manualDeparture(s.now()); s.feed(16000)
  s.feed(800, { x: 0.5, y: 0, z: 0 }); s.feed(200)
  assert.equal(s.tracker.state, 'arrival-watch')
  s.feed(2000)
  assert.equal(s.tracker.state, 'candidate')
})

test('demo accepts the inclusive 0.25 quiet boundary without treating it as a jolt', () => {
  const s = session(demoSettings); s.tracker.manualDeparture(s.now()); s.feed(16000)
  s.feed(2000, { x: 0.25, y: 0, z: 0 })
  assert.ok(!s.tracker.events.some(e => e.action === 'braking-jolt'))
  s.feed(800, { x: 0.5, y: 0, z: 0 }); s.feed(1500, { x: 0.25, y: 0, z: 0 })
  assert.equal(s.tracker.state, 'candidate')
})

test('the blocked countdown and waiting-for-jolt message are mutually exclusive', () => {
  for (const settings of [defaultSettings, demoSettings]) {
    const s = session(settings); s.tracker.manualDeparture(s.now())
    s.feed(s.tracker.watchAt - s.now() - 20)
    assert.equal(s.tracker.state, 'travelling')
    const blocked = tripStatus(s.tracker, s.now())
    assert.match(blocked.status, /inputs blocked/)
    assert.match(blocked.timing, /opens in 1 s/)
    assert.ok(!blocked.glassesText.includes('waiting for jolt'))
    s.feed(20)
    assert.equal(s.tracker.state, 'arrival-watch')
    const open = tripStatus(s.tracker, s.now())
    assert.equal(open.status, 'waiting for jolt')
    assert.equal(open.timing, 'Arrival detection OPEN')
    assert.ok(s.tracker.expectedAt > s.now())
    assert.ok(!open.glassesText.includes('ETA'))
    assert.ok(!open.glassesText.includes('opens in'))
  }
})

test('motion before the detection window cannot become a braking jolt at opening', () => {
  const s = session(demoSettings); s.tracker.manualDeparture(s.now())
  s.feed(s.tracker.watchAt - s.now() - 1000); s.motion(1000); s.feed(2000)
  assert.equal(s.tracker.state, 'arrival-watch')
  assert.ok(!s.tracker.events.some(e => e.action === 'braking-jolt'))
  assert.equal(s.tracker.stationIndex, 0)
})

test('veto cooldown blocks all evidence and presents its own countdown', () => {
  const s = session(); s.candidate(); s.tracker.veto(s.now())
  const until = s.tracker.retryAfter
  assert.equal(s.tracker.state, 'cooldown')
  s.motion(9800)
  const blocked = tripStatus(s.tracker, s.now())
  assert.equal(blocked.status, 'Arrival vetoed')
  assert.match(blocked.glassesText, /Detection paused: 1 s/)
  assert.ok(!blocked.glassesText.includes('waiting for jolt'))
  s.feed(until - s.now()); s.feed(5000)
  assert.equal(s.tracker.state, 'arrival-watch')
  assert.equal(s.tracker.brakingPhase, 'waiting for jolt')
  assert.equal(s.tracker.stationIndex, 0)
})

test('veto expiry counts exactly once and switches both displays to the next departure', () => {
  const s = session(demoSettings); s.tracker.manualDeparture(s.now()); s.feed(16000)
  s.motion(800); s.feed(1000)
  assert.equal(s.tracker.state, 'candidate')
  const deadline = s.tracker.candidateUntil
  s.feed(deadline - s.now() - 20)
  const pending = tripStatus(s.tracker, s.now())
  assert.equal(pending.status, 'Possible arrival')
  assert.match(pending.glassesText, /Count in 1 s; tap to VETO/)
  assert.equal(s.tracker.stationIndex, 0)
  s.feed(20)
  assert.equal(s.tracker.stationIndex, 1)
  assert.equal(s.tracker.state, 'waiting-departure')
  const accepted = tripStatus(s.tracker, s.now())
  assert.equal(accepted.status, 'Waiting for departure')
  assert.ok(accepted.glassesText.startsWith('Middle -> End'))
  assert.ok(!accepted.glassesText.includes('VETO'))
  s.feed(5000)
  assert.equal(s.tracker.events.filter(e => e.action === 'arrival-counted').length, 1)
})

const transferRoute = 'Start | 0 | Board Blue Line\nMiddle | 12 | Stay on Blue Line\nJunction | 12 | Change to Green Line | transfer\nEnd | 12 | Use north exit'

test('old routes remain valid and itinerary metadata survives load and export', () => {
  assert.deepEqual(parseRoute('A\nB | 12'), [{ name: 'A', travelSeconds: 0 }, { name: 'B', travelSeconds: 12 }])
  const s = session(demoSettings, false, transferRoute)
  assert.equal(s.tracker.route[2].transfer, true)
  assert.equal(s.tracker.route[2].instruction, 'Change to Green Line')
  assert.equal(s.tracker.snapshot().route[3].instruction, 'Use north exit')
  assert.equal(tripStatus(s.tracker, s.now()).instruction, 'Board Blue Line')
  assert.throws(() => parseRoute('A | 0 | Board | transfer\nB | 12'))
  assert.throws(() => parseRoute('A\nB | 12 | Exit | transfer'))
  assert.throws(() => parseRoute('A\nB | 12 | Exit | typo'))
  assert.throws(() => parseRoute(`A\nB | 12 | ${'x'.repeat(161)}`))
})

test('ordinary stops loop automatically, transfers wait for boarding tap, and destination keeps exit directions', () => {
  const s = session(demoSettings, true, transferRoute)
  const arrive = () => {
    s.feed(12000); s.motion(800); s.feed(1000)
    assert.equal(s.tracker.state, 'candidate')
    assert.equal(tripStatus(s.tracker, s.now()).instruction, null)
    s.feed(s.tracker.candidateUntil - s.now() + 20)
  }
  s.depart()
  assert.equal(s.tracker.currentInstruction, null)
  arrive()
  assert.equal(s.tracker.stationIndex, 1)
  assert.equal(s.tracker.state, 'waiting-departure')
  assert.equal(s.tracker.currentInstruction, 'Stay on Blue Line')
  s.motion(2000)
  assert.equal(s.tracker.state, 'travelling')
  assert.equal(s.tracker.currentInstruction, null)
  arrive()
  assert.equal(s.tracker.stationIndex, 2)
  assert.equal(s.tracker.state, 'waiting-boarding')
  assert.equal(s.tracker.sensing, false)
  const view = tripStatus(s.tracker, s.now())
  assert.match(view.glassesText, /Change to Green Line/)
  assert.match(view.timing, /Board next train, then tap/)
  assert.ok(!view.timing.includes('unavailable'))
  s.motion(30000)
  s.tracker.tick(s.now())
  s.tracker.manualDeparture(s.now())
  s.tracker.suspend(s.now(), 'Foreground resume during transfer')
  assert.equal(s.tracker.state, 'waiting-boarding')
  assert.equal(s.tracker.departureAt, null)
  assert.equal(s.tracker.currentInstruction, 'Change to Green Line')
  assert.throws(() => s.tracker.load(parseRoute('A\nB | 12'), demoSettings, s.now()))
  s.tracker.arm(s.now())
  assert.equal(s.tracker.state, 'waiting-departure')
  assert.equal(s.tracker.departureAt, null)
  assert.equal(s.tracker.currentInstruction, 'Change to Green Line')
  s.motion(2000)
  assert.equal(s.tracker.state, 'travelling')
  assert.equal(s.tracker.currentInstruction, null)
  arrive()
  assert.equal(s.tracker.stationIndex, 3)
  assert.equal(s.tracker.state, 'complete')
  assert.equal(s.tracker.currentInstruction, 'Use north exit')
  assert.match(tripStatus(s.tracker, s.now()).glassesText, /Use north exit/)
  s.motion(30000); s.tracker.arm(s.now())
  assert.equal(s.tracker.state, 'complete')
  assert.equal(s.tracker.currentInstruction, 'Use north exit')
  assert.equal(s.tracker.events.filter(e => e.action === 'arrival-counted').length, 3)
  assert.equal(s.tracker.events.filter(e => e.action === 'station-instruction').length, 4)
  assert.ok(s.tracker.events.some(e => e.action === 'armed' && e.detail.boardingAfterTransfer))
})

test('vetoing a transfer proposal does not advance, pause for boarding, or expose its instruction', () => {
  const s = session(demoSettings, true, 'A\nTransfer | 12 | Board Green | transfer\nEnd | 12 | Exit north')
  s.tracker.manualDeparture(s.now()); s.feed(12000); s.motion(800); s.feed(1000)
  assert.equal(s.tracker.state, 'candidate')
  assert.equal(tripStatus(s.tracker, s.now()).instruction, null)
  s.tracker.veto(s.now()); s.feed(12000)
  assert.equal(s.tracker.stationIndex, 0)
  assert.equal(s.tracker.state, 'arrival-watch')
  assert.equal(tripStatus(s.tracker, s.now()).instruction, null)
})

test('station corrections respect transfers and long directions stay complete on the phone', () => {
  const route = parseRoute(transferRoute)
  route[2].instruction = 'Follow signs for the Green Line toward the riverside platform. Take the stairs at the end of the concourse, then board the next train.'
  const s = session(demoSettings, false)
  s.tracker.load(route, demoSettings, s.now())
  s.tracker.correct(2, s.now())
  assert.equal(s.tracker.state, 'waiting-boarding')
  const view = tripStatus(s.tracker, s.now())
  assert.equal(view.instruction, route[2].instruction)
  assert.ok(view.glassesText.includes('...'))
  assert.ok(view.glassesText.split('\n').length <= 6)
  s.tracker.correct(3, s.now())
  assert.equal(s.tracker.state, 'complete')
  assert.equal(s.tracker.currentInstruction, 'Use north exit')
})
