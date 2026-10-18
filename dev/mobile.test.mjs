import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mobileJourney } from '../src/mobile-view.ts'
import { mobileMirror } from '../src/mobile-ui.ts'
import { StationTracker, demoSettings, parseRoute } from '../src/station-tracker.ts'
import { glassesView } from '../src/glasses-view.ts'

const planning = phase => ({ phase, origin: 'Wall Street', destination: 'Bronx Zoo', yes: true, error: '' })
const speech = phase => ({ phase })
const tracker = () => { const t = new StationTracker(); t.load(parseRoute('Start | 0 | Board N\nMiddle | 12\nTransfer | 12 | Board F | transfer\nEnd | 12'), demoSettings, 0); return t }

test('phone primary action follows recording and confirmation and blocks during processing', () => {
  const t = tracker()
  assert.equal(mobileJourney(t, planning('prompt'), speech('idle'), 0).action, 'Start recording')
  assert.equal(mobileJourney(t, planning('listening'), speech('starting'), 0).canAct, false)
  assert.equal(mobileJourney(t, planning('listening'), speech('recording'), 0).action, 'Submit recording')
  assert.equal(mobileJourney(t, planning('listening'), speech('transcribing'), 0).canAct, false)
  assert.equal(mobileJourney(t, planning('planning'), speech('idle'), 0).action, '')
  assert.equal(mobileJourney(t, planning('confirm'), speech('idle'), 0).action, 'Yes, plan route')
  assert.equal(mobileJourney(t, { ...planning('confirm'), yes: false }, speech('idle'), 0).action, 'No, record again')
  const choice = { ...planning('choose-origin'), originCandidates: [{ name: "Macy's", address: '151 W 34th St' }], originIndex: 0 }
  const view = mobileJourney(t, choice, speech('idle'), 0)
  assert.match(view.detail, /151 W 34th St/); assert.equal(view.canChoose, true)
})

test('phone boarding and correction actions preserve the detector and transfer loop', () => {
  const t = tracker(), p = planning('loaded')
  assert.equal(mobileJourney(t, p, speech('idle'), 0).action, 'I’m aboard')
  t.arm(0); assert.equal(mobileJourney(t, p, speech('idle'), 0).action, '')
  t.state = 'candidate'; t.candidateUntil = 20000; t.lastValidAt = 0
  let view = mobileJourney(t, p, speech('idle'), 0)
  assert.equal(view.action, 'Not at Middle'); assert.equal(view.stopsLeft, 1)
  t.veto(0); assert.equal(mobileJourney(t, p, speech('idle'), 0).stopsLeft, 2)
  t.correct(2, 100); view = mobileJourney(t, p, speech('idle'), 100)
  assert.equal(view.title, 'Board the next train'); assert.equal(view.action, 'I’m aboard')
  assert.equal(view.stopsLeft, 1)
  t.correct(3, 200); view = mobileJourney(t, p, speech('idle'), 200)
  assert.equal(view.title, 'You’ve arrived'); assert.equal(view.stopsLeft, 0)
})

test('mirror keeps the last fully sent frame until the new display is acknowledged', () => {
  const t = tracker(), delivered = glassesView(t, 0)
  t.arm(0); const desired = glassesView(t, 0)
  const base = { connected: true, previewOnly: false, sending: true, displayError: '', desired, delivered }
  assert.equal(mobileMirror(base).label, 'Updating glasses'); assert.equal(mobileMirror(base).panels, delivered)
  const synced = mobileMirror({ ...base, sending: false, delivered: desired })
  assert.equal(synced.label, 'Sent to glasses'); assert.equal(synced.panels, desired)
  assert.equal(mobileMirror({ ...base, displayError: 'Image failed' }).label, 'Update failed')
  const disconnected = mobileMirror({ ...base, connected: false })
  assert.equal(disconnected.label, 'Preview only'); assert.equal(disconnected.panels, desired)
  assert.equal(mobileMirror({ ...base, previewOnly: true }).label, 'Preview only')
})

test('detector countdown and phases remain on the phone while the glasses stay quiet', () => {
  const t = tracker(), p = planning('loaded')
  assert.equal(mobileJourney(t, p, speech('idle'), 0).detector, null)
  t.arm(0); t.manualDeparture(0); t.lastValidAt = 1000
  assert.match(mobileJourney(t, p, speech('idle'), 1000).detail, /Detection opens in 12 s/)
  assert.equal(mobileJourney(t, p, speech('idle'), 1000).detector.timing, 'Detection opens in 12 s')
  for (const state of ['waiting-departure', 'travelling', 'arrival-watch', 'cooldown']) {
    t.state = state; t.lastValidAt = 1000; t.retryAfter = 10000
    const panels = glassesView(t, 1000)
    assert.ok(!panels.some(panel => /DETECTION|JOLT|SETTLING|WAITING|RETRY/.test(panel.content)))
    assert.ok(!panels.some(panel => panel.containerName === 'trip-action'))
  }
  t.state = 'arrival-watch'
  assert.match(mobileJourney(t, p, speech('idle'), 1000).detail, /waiting for jolt.*\nArrival detection OPEN/)
  assert.equal(mobileJourney(t, p, speech('idle'), 1000).detector.status, 'waiting for jolt')
  assert.equal(mobileJourney(t, planning('prompt'), speech('idle'), 1000).detector, null)
})
