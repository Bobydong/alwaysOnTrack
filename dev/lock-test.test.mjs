import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LockTest, readLockTestReport } from '../src/lock-test.ts'
import { lockTestGlasses } from '../src/lock-test-ui.ts'

test('hidden silence is measured as a gap, not as continued motion or JavaScript execution', () => {
  const p = new LockTest(); p.start(0, false)
  p.phone(20, false, true); p.heartbeat(500, false)
  p.visibility(true, 1000)
  // No callbacks during lock. The first callback on unlock closes the hidden interval.
  p.visibility(false, 31000); p.phone(31020, false, true); p.stop(32000, false)
  const r = p.snapshot(999999)
  assert.equal(r.hidden.durationMs, 30000)
  assert.equal(r.hidden.validLinearEvents, 0)
  assert.equal(r.hidden.heartbeats, 0)
  assert.equal(r.hidden.maxLinearGapMs, 30000)
  assert.equal(r.hidden.maxHeartbeatGapMs, 30000)
  assert.equal(r.visible.validLinearEvents, 2)
})

test('native bridge activity can continue while phone linear acceleration is unavailable', () => {
  const p = new LockTest(); p.start(0, false); p.visibility(true, 1000)
  for (let at = 1500; at <= 5000; at += 500) {
    p.heartbeat(at, true); p.bridgeResult(true, at, true)
    p.phone(at, true, false) // gravity-only or null acceleration is not a usable channel
  }
  p.tap(4000, true); p.glassesImu(4500, true); p.stop(5000, true)
  const r = p.snapshot(5000)
  assert.equal(r.hidden.validLinearEvents, 0)
  assert.equal(r.hidden.phoneEvents, 8)
  assert.equal(r.hidden.heartbeats, 8)
  assert.equal(r.hidden.maxHeartbeatGapMs, 500)
  assert.equal(r.hidden.maxLinearGapMs, 4000)
  assert.equal(r.hidden.bridgeAccepted, 8)
  assert.equal(r.hidden.taps, 1)
})

test('active snapshots do not double-count duration and stopped tests ignore subsequent callbacks', () => {
  const p = new LockTest(); p.start(0, true)
  assert.equal(p.snapshot(1000).hidden.durationMs, 1000)
  assert.equal(p.snapshot(2000).hidden.durationMs, 2000)
  p.stop(3000, true); p.phone(4000, true, true); p.heartbeat(5000, true)
  assert.equal(p.snapshot(6000).hidden.durationMs, 3000)
  assert.equal(p.snapshot(6000).hidden.phoneEvents, 0)
})

test('saved unfinished diagnostics can be inspected after reload without restarting the experiment', () => {
  const p = new LockTest(); p.start(1000, false); p.phone(1020, false, true)
  const saved = readLockTestReport(JSON.stringify(p.snapshot(2000)))
  assert.equal(saved.endedAt, null)
  assert.equal(saved.visible.validLinearEvents, 1)
  assert.equal(new LockTest().active, false)
  assert.equal(readLockTestReport('bad json'), null)
  assert.equal(readLockTestReport(JSON.stringify({ ...saved, hidden: {} })), null)
})

test('diagnostic screen reports actual received counts and has one empty gesture target', () => {
  const p = new LockTest(); p.start(0, false)
  p.phone(20, false, true); p.phone(40, false, false); p.tap(50, false)
  const panels = lockTestGlasses(p.report, 3000)
  assert.equal(panels.find(x => x.containerName === 'trip-station').content, 'LOCK TEST\n3s')
  assert.equal(panels.find(x => x.containerName === 'trip-detail').content, 'PHONE EVENTS\n2')
  assert.equal(panels.find(x => x.containerName === 'trip-action').content, 'VALID LINEAR\n1')
  assert.equal(panels.filter(x => x.isEventCapture).length, 1)
  for (const x of panels) assert.ok(x.xPosition + x.width <= 576 && x.yPosition + x.height <= 288)
})
