import { test } from 'node:test'
import assert from 'node:assert/strict'
import { glassesView, glassesLayoutKey, glassesSpacing, stopRail, panelSignature } from '../src/glasses-view.ts'
import { artPng, pixelIcon } from '../src/glasses-art.ts'
import { unzlibSync } from 'fflate'
import { nativeObjects } from '../src/glasses-native.ts'
import { CreateStartUpPageContainer, RebuildPageContainer } from '@evenrealities/even_hub_sdk'
import { planningView } from '../src/planning-view.ts'
import { journeyView } from '../src/journey-view.ts'
import { StationTracker, demoSettings, parseRoute } from '../src/station-tracker.ts'
import { googlePlans } from '../src/google-routes.ts'
import { catalog, request, googleResponse } from './fixtures/routing.mjs'

const route = 'Start | 0 | Board the Blue Line\nMiddle | 12\nTransfer | 12 | Change to the Green Line | transfer\nEnd | 12 | Use the north exit'
const panel = (view, name) => {
  const item = view.find(p => p.containerName === name)
  if (!item) return undefined
  const value = item.content.replaceAll('\n', ' ')
  const paired = view.find(p => p.containerName === (name === 'trip-station' ? 'trip-next-name' : name === 'trip-detail' ? 'trip-end-name' : ''))
  return paired ? `${value} ${paired.content}` : value
}
const make = () => { const t = new StationTracker(); t.load(parseRoute(route), demoSettings, 0); return t }
function validate(view) {
  assert.equal(view.filter(p => p.isEventCapture === 1).length, 1)
  assert.equal(new Set(view.map(p => p.containerID)).size, view.length)
  assert.ok(view.length <= 12)
  assert.ok(view.filter(p => p.graphic).length <= 4)
  assert.ok(view.filter(p => !p.graphic).length <= 8)
  assert.ok(view.reduce((sum, p) => sum + p.content.length, 0) <= 1000)
  for (const a of view) {
    assert.ok(a.xPosition >= 0 && a.yPosition >= 0 && a.xPosition + a.width <= 576 && a.yPosition + a.height <= 288)
    if (a.graphic) {
      assert.ok(a.width >= 20 && a.width <= 288 && a.height >= 20 && a.height <= 144)
      assert.equal(a.graphic.width, a.width); assert.equal(a.graphic.height, a.height)
    } else assert.ok(a.content.split('\n').length * glassesSpacing.lineHeight + a.paddingLength * 2 <= a.height)
    if (a.containerName !== 'trip-input') {
      assert.equal(a.borderWidth, 0)
      if (a.xPosition < 304) assert.ok(a.yPosition + a.height <= 144 || a.yPosition >= 164)
      assert.ok(a.xPosition + a.width <= 272 || a.xPosition >= 304)
    }
    assert.ok(a.borderWidth <= 5 && a.borderColor <= 15 && a.borderRadius <= 10)
    assert.ok(a.containerName.length <= 16)
    for (const b of view.filter(b => b.containerID !== a.containerID && b.containerName !== 'trip-input' && a.containerName !== 'trip-input')) {
      assert.ok(a.xPosition + a.width <= b.xPosition || b.xPosition + b.width <= a.xPosition || a.yPosition + a.height <= b.yPosition || b.yPosition + b.height <= a.yPosition)
    }
  }
}

test('journey layouts keep the center clear, respect mixed-container SDK limits, and have one gesture target', () => {
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
  assert.equal(before.length, 5)
  assert.ok(before.find(p => p.containerName === 'state-icon').graphic)
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
  assert.equal(panel(after, 'trip-detail'), 'TRANSFER AT Transfer')
  assert.ok(!after.some(p => /Blue Line/.test(p.content)))
  assert.equal(panel(after, 'trip-progress'), '2 STOPS LEFT')
})

test('routine detector phases stay off glasses, while arrival correction stays bottom anchored', () => {
  const t = make(); t.arm(0); t.manualDeparture(0)
  t.ingest({ t: 1000, acceleration: { x: 0.02, y: 0, z: 0 } })
  const a = glassesView(t, 1000), b = glassesView(t, 1500)
  assert.equal(panel(a, 'trip-action'), undefined)
  assert.equal(glassesLayoutKey(a), glassesLayoutKey(b))
  t.state = 'candidate'; t.candidateUntil = 6000
  assert.match(panel(glassesView(t, 1500), 'trip-action'), /TAP IF NOT AT Middle/)
  assert.equal(panel(glassesView(t, 1500), 'trip-station'), 'NEXT / TRANSFER Transfer')
  assert.equal(panel(glassesView(t, 1500), 'trip-progress'), '1 STOP LEFT')
  assert.equal(t.stationIndex, 0)
  const candidate = glassesView(t, 1500)
  for (const view of [candidate]) {
    const status = view.find(p => p.containerName === 'trip-action')
    assert.equal(status.yPosition + status.height, 288 - glassesSpacing.margin)
  }
  validate(candidate)
})

test('next station matches get-off station on approach; transfer train appears only after arrival', () => {
  const t = make(); t.arm(0); t.correct(1, 0)
  const approaching = glassesView(t, 0)
  assert.equal(panel(approaching, 'trip-station'), 'NEXT / TRANSFER Transfer')
  assert.equal(panel(approaching, 'trip-detail'), undefined)
  assert.ok(!approaching.some(p => /Green Line/.test(p.content)))
  assert.equal(panel(approaching, 'trip-progress'), '1 STOP LEFT')
  t.state = 'candidate'; t.candidateUntil = 6000; t.lastValidAt = 0
  const detected = glassesView(t, 0)
  assert.equal(detected.length, 5)
  assert.equal(panel(detected, 'trip-station'), 'BOARD AT Transfer')
  assert.match(panel(detected, 'trip-detail'), /Green Line/)
  assert.match(panel(detected, 'trip-action'), /TAP IF NOT AT Transfer/)
  assert.ok(!detected.some(p => /TAP ONCE ABOARD/.test(p.content)))
  t.veto(0)
  assert.equal(t.stationIndex, 1)
  assert.equal(panel(glassesView(t, 0), 'trip-action'), undefined)
  assert.match(panel(glassesView(t, 0), 'trip-station'), /NEXT \/ TRANSFER Transfer/)
  t.correct(2, 100)
  assert.equal(t.state, 'waiting-boarding')
  const board = glassesView(t, 100)
  assert.equal(board.length, 5)
  assert.match(panel(board, 'trip-station'), /BOARD AT Transfer/)
  assert.match(panel(board, 'trip-detail'), /Green Line/)
  assert.equal(panel(board, 'trip-action'), 'TAP ONCE ABOARD')
  t.arm(200)
  assert.match(panel(glassesView(t, 200), 'trip-station'), /NEXT \/ GET OFF End/)
  assert.equal(panel(glassesView(t, 200), 'trip-detail'), undefined)
  assert.ok(!glassesView(t, 200).some(p => /Green Line|exit signs/i.test(p.content)))
  assert.equal(panel(glassesView(t, 200), 'trip-progress'), '1 STOP LEFT')
  t.correct(3, 300)
  assert.equal(glassesView(t, 300).length, 4)
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
  assert.equal(panel(glassesView(t, 200), 'trip-progress'), '1 STOP LEFT')
  assert.equal(stopRail(t).last, 'Delta boarding')
})

test('lost sensing shows a rider-facing pause action, and long boarding instructions fit', () => {
  const t = make(); t.arm(0)
  assert.equal(panel(glassesView(t, 2000), 'trip-action'), 'TRACKING PAUSED CHECK PHONE')
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
  assert.equal(panel(glassesView(t, 0), 'trip-action'), undefined)
  t.state = 'candidate'; t.candidateUntil = 16000
  const correction = glassesView(t, 0).find(p => p.containerName === 'trip-action')
  t.state = 'travelling'
  const stale = glassesView(t, 2000).find(p => p.containerName === 'trip-action')
  assert.equal(correction.yPosition + correction.height, stale.yPosition + stale.height)
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
  assert.equal(panel(restored, 'trip-station'), 'NEXT / GET OFF End')
  assert.equal(panel(restored, 'trip-detail'), undefined)
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
  assert.equal(panel(restored, 'trip-station'), 'NEXT / TRANSFER Transfer')
  assert.equal(panel(restored, 'trip-detail'), undefined)
})

test('long rides slide a bounded window; the endpoint stays anchored and short rides have no hidden stops', () => {
  const t = new StationTracker()
  t.load(Array.from({ length: 21 }, (_, i) => ({ name: `Station ${i}`, travelSeconds: i ? 12 : 0 })), demoSettings, 0)
  t.arm(0)
  assert.deepEqual(stopRail(t), { remaining: 20, hidden: true, endIndex: 20, currentIndex: 0,
    last: 'Station 0', next: 'Station 1', destination: 'Station 20', transfer: false })
  const first = glassesView(t, 0), endpoint = first.find(p => p.containerName === 'trip-detail')
  assert.ok(first.length <= 11); validate(first)
  t.correct(10, 100)
  const middle = glassesView(t, 100)
  assert.equal(stopRail(t).last, 'Station 10'); assert.equal(stopRail(t).next, 'Station 11')
  assert.equal(panel(middle, 'trip-progress'), '10 STOPS LEFT')
  assert.equal(middle.find(p => p.containerName === 'trip-detail').yPosition, endpoint.yPosition)
  t.correct(17, 200); assert.equal(stopRail(t).hidden, true)
  t.correct(18, 300); assert.equal(stopRail(t).hidden, false)
  t.correct(19, 400)
  assert.equal(stopRail(t).remaining, 1); assert.equal(panel(glassesView(t, 400), 'trip-station'), 'NEXT / GET OFF Station 20')
})

test('arrival preview advances the rail, while correction restores the old window and remaining count', () => {
  const t = new StationTracker()
  t.load(parseRoute('Start\nNext | 12\nBeyond | 12\nLater | 12\nDestination | 12'), demoSettings, 0)
  t.arm(0)
  const before = stopRail(t)
  t.state = 'candidate'; t.candidateUntil = 20000; t.lastValidAt = 0
  assert.equal(stopRail(t).last, 'Next'); assert.equal(stopRail(t).next, 'Beyond'); assert.equal(stopRail(t).remaining, 3)
  t.veto(0)
  assert.deepEqual(stopRail(t), before)
  assert.equal(panel(glassesView(t, 0), 'trip-progress'), '4 STOPS LEFT')
})

test('pixel assets are valid small grayscale PNGs and art content changes do not rebuild geometry', () => {
  for (const kind of ['train', 'transfer', 'exit', 'mic', 'check', 'route']) {
    const art = pixelIcon(kind), png = Buffer.from(artPng(art))
    assert.equal(png.toString('ascii', 1, 4), 'PNG'); assert.equal(png.readUInt32BE(16), 24); assert.equal(png.readUInt32BE(20), 24)
    const size = png.readUInt32BE(33), raw = unzlibSync(png.subarray(41, 41 + size))
    assert.equal(raw.length, 25 * 24); assert.ok(raw.some(v => v === 255))
    assert.ok(png.length < 1000)
  }
  const t = make(), a = glassesView(t, 0), b = a.map(p => p.graphic ? { ...p, graphic: pixelIcon('exit') } : p)
  assert.equal(glassesLayoutKey(a), glassesLayoutKey(b))
  assert.notEqual(panelSignature(a.find(p => p.graphic)), panelSignature(b.find(p => p.graphic)))
})

test('SDK startup and rebuild payloads contain only supported image fields, never preview/text data', () => {
  const t = make()
  const views = [planningView({ phase: 'prompt', origin: '', destination: '', yes: true, error: '' }, { phase: 'idle' }), glassesView(t, 0)]
  t.arm(0); views.push(glassesView(t, 0))
  for (const panels of views) {
    for (const Container of [CreateStartUpPageContainer, RebuildPageContainer]) {
      const payload = new Container(nativeObjects(panels)).toJson()
      assert.equal(payload.containerTotalNum, payload.textObject.length + payload.imageObject.length)
      assert.equal(payload.textObject.filter(p => p.isEventCapture === 1).length, 1)
      for (const image of payload.imageObject) {
        assert.deepEqual(Object.keys(image).sort(), ['containerID', 'containerName', 'height', 'width', 'xPosition', 'yPosition'].sort())
      }
      assert.ok(!JSON.stringify(payload).includes('graphic'))
    }
  }
})

test('sideways train adds trailing lines only after departure and removes them on arrival', () => {
  const t = make(); t.arm(0); t.lastValidAt = 0
  const icon = view => view.find(p => p.containerName === 'ride-motion')
  const waiting = glassesView(t, 0)
  assert.deepEqual(icon(waiting).graphic, pixelIcon('train-stopped'))
  t.manualDeparture(0)
  const moving = glassesView(t, 0)
  assert.deepEqual(icon(moving).graphic, pixelIcon('train-moving'))
  assert.deepEqual(pixelIcon('train-moving').rects.slice(0, -3), pixelIcon('train-stopped').rects)
  assert.equal(glassesLayoutKey(waiting), glassesLayoutKey(moving))
  t.state = 'arrival-watch'
  assert.equal(glassesLayoutKey(moving), glassesLayoutKey(glassesView(t, 0)))
  t.state = 'candidate'; t.candidateUntil = 16000
  const stopped = glassesView(t, 0)
  assert.deepEqual(icon(stopped).graphic, pixelIcon('train-stopped'))
  assert.match(panel(stopped, 'trip-action'), /TAP IF NOT AT Middle/)
  t.veto(0)
  assert.deepEqual(icon(glassesView(t, 0)).graphic, pixelIcon('train-moving'))
  assert.deepEqual(icon(glassesView(t, 2000)).graphic.rects, [])
  assert.equal(panel(glassesView(t, 2000), 'trip-action'), 'TRACKING PAUSED CHECK PHONE')
  for (const view of [waiting, moving, stopped, glassesView(t, 2000)]) validate(view)
  t.correct(2, 3000)
  assert.deepEqual(glassesView(t, 3000).find(p => p.containerName === 'state-icon').graphic, pixelIcon('train-stopped'))
})

test('rail labels and count align close to the rail, with only the last-station circle filled', () => {
  const t = make(); t.arm(0)
  const view = glassesView(t, 0)
  assert.ok(!view.some(p => /THEN:/.test(p.content) || p.containerName === 'trip-beyond'))
  for (const name of ['trip-last', 'trip-station', 'trip-next-name', 'trip-detail', 'trip-end-name', 'trip-progress']) {
    const text = view.find(p => p.containerName === name)
    assert.equal(text.xPosition + text.width, 548)
    assert.ok(text.content.split('\n').length === 1)
  }
  assert.ok(view.find(p => p.containerName === 'trip-next-name').xPosition > view.find(p => p.containerName === 'trip-station').xPosition)
  assert.ok(view.find(p => p.containerName === 'trip-progress').xPosition > 316)
  const pixel = (y, x = 9) => {
    const tile = y < 112 ? 0 : 1, graphic = view.find(p => p.containerName === `stop-rail-${tile}`).graphic
    const png = Buffer.from(artPng(graphic)), length = png.readUInt32BE(33)
    const pixels = unzlibSync(png.subarray(41, 41 + length))
    return pixels[(y - tile * 112) * 21 + 1 + x]
  }
  assert.equal(pixel(18), 255, 'Last station is filled')
  assert.equal(pixel(72), 0, 'Next station is hollow')
  assert.equal(pixel(188), 0, 'Endpoint is hollow')
})
