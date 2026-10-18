import { defaultSettings, demoSettings, parseRoute, StationTracker, type TrackerSettings } from './station-tracker'
import { el } from './imu-ui'
import { tripStatus } from './trip-status'
import { mountPlannerControls } from './planner-ui'
import { routeTextFromStops } from './trip-plan'
import type { GlassesSpeech } from './asr/stt.ts'
import { speechGlasses } from './asr/speech-view.ts'
import { glassesView, renderGlassesPreview } from './glasses-view'

// Fixed NYC demonstration; durations are simulated, not MTA schedules.
const exampleRoute = (seconds: number) => `Times Sq-42 St | 0 | Board downtown N-line to Coney Island-Stillwell Av\n34 St-Herald Sq | ${seconds} | Board downtown F-line to Brooklyn | transfer\n23 St | ${seconds} | Stay on the F train\n14 St | ${seconds} | Follow exit signs`

export function mountTripControls(tracker: StationTracker, now: () => number, onArm: () => void, speech?: GlassesSpeech) {
  const style = document.createElement('style')
  style.textContent = '#trip-panel fieldset{border:1px solid #52687b;border-radius:7px;padding:12px}#trip-panel input{font:inherit;padding:8px;width:90px}#trip-panel details{margin:12px 0}#trip-events{max-height:280px;overflow:auto;overflow-wrap:anywhere}#trip-error{color:#ff8c92}#trip-route{height:110px}#trip-planner input{width:260px;max-width:100%}#trip-planner input[type=checkbox]{width:auto}#trip-planner textarea{width:100%;min-height:100px}'
  document.head.append(style)
  el('trip-panel').innerHTML = `<h2>Experimental station counter</h2>
    <p><strong>Board a train, then single-tap the glasses to start tracking.</strong> Enable phone motion and load a route first. At a transfer, tracking pauses until you board the next train and tap again. Ordinary stops continue automatically. You can also use Start tracking on the phone.</p>
    <fieldset id="trip-config"><legend>Route and detector settings</legend>
    <div id="trip-planner"></div>
    <div class="controls"><button id="trip-real-preset">NYC example (simulated 3-minute segments)</button><button id="trip-demo-preset">NYC demo with transfer (12-second segments)</button></div>
    <label for="trip-route">One station per line: name | seconds | optional instruction | transfer</label>
    <textarea id="trip-route" aria-label="Trip route">${exampleRoute(12)}</textarea>
    <p class="hint">The default NYC demo is preloaded: N from Times Sq-42 St to 34 St-Herald Sq, then F via 23 St to 14 St. Each segment takes a simulated 12 seconds; no route API request is made. This is a demonstration, not a verified live itinerary. Use 0 seconds for the starting station. Add “transfer” only to intermediate stops where you change trains. Instructions are optional (160 characters max); old name | seconds routes still work.</p>
    <details><summary>Adjust timing and motion detection</summary><div class="controls">
    <label>Departure window (ms) <input id="trip-departureWindowMs" type="number" min="100" max="1000" step="50" value="${defaultSettings.departureWindowMs}"></label>
    <label>Departure threshold (m/s²) <input id="trip-departureThreshold" type="number" min="0.01" max="20" step="0.01" value="${defaultSettings.departureThreshold}"></label>
    <label>Departure sustained motion (seconds) <input id="trip-departureSeconds" type="number" min="0.1" max="10" step="0.1" value="${defaultSettings.departureSeconds}"></label>
    <label>Braking window (ms) <input id="trip-windowMs" type="number" min="100" max="1000" step="50" value="${defaultSettings.windowMs}"></label>
    <label>Braking threshold (m/s²) <input id="trip-motionThreshold" type="number" min="0.01" max="20" step="0.01" value="${defaultSettings.motionThreshold}"></label>
    <label>Quiet threshold (m/s²) <input id="trip-quietThreshold" type="number" min="0" max="19" step="0.01" value="${defaultSettings.quietThreshold}"></label>
    <label>Braking sustained motion (seconds) <input id="trip-motionSeconds" type="number" min="0.1" max="10" step="0.1" value="${defaultSettings.motionSeconds}"></label>
    <label>Settling time (seconds) <input id="trip-settlingSeconds" type="number" min="0" max="3" step="0.1" value="${defaultSettings.settlingSeconds}"></label>
    <label>Quiet dwell (seconds) <input id="trip-dwellSeconds" type="number" min="0.2" max="30" step="0.05" value="${defaultSettings.dwellSeconds}"></label>
    <label>Correction window (seconds) <input id="trip-vetoSeconds" type="number" min="1" max="30" step="1" value="${defaultSettings.vetoSeconds}"></label>
    </div></details><button id="trip-load">Load route, then tap glasses to start</button></fieldset>
    <p class="hint">Arrival inputs stay blocked until 90% of the expected segment duration has elapsed. Then a jolt, settling, and quiet dwell can propose an arrival. Short demo: 0.35 m/s² for 0.4 seconds, 0.3 seconds to settle, then acceleration at or below 0.25 m/s² for 0.25 seconds. No recoil is required. Directions advance immediately when a stop is detected. During the correction window, tap if not at station to restore your previous position. Shifting or other phone motion does not reset it. Quiet readings do not measure train speed.</p>
    <div class="controls"><button id="trip-arm" disabled>Start tracking (or tap glasses)</button><button id="trip-stop" disabled>Stop tracking</button>
    <button id="trip-depart" disabled>Mark departure now</button><button id="trip-veto" disabled>Not at station</button></div>
    <p id="trip-error" role="alert"></p><p id="trip-start-hint" role="status"></p><p id="trip-status" role="status"></p><p id="trip-instruction" role="status"></p><p id="trip-timing"></p><p id="trip-evidence" class="hint"></p>
    <details open><summary>Glasses layout preview</summary><svg id="glasses-preview" viewBox="0 0 576 288" role="img" aria-label="Live glasses layout preview" style="display:block;width:100%;max-width:720px;border-radius:12px;margin:12px auto"></svg><p class="hint">Live layout preview. Font appearance may differ on G2.</p></details>
    <div class="controls"><label>Correct current station <select id="trip-correction" disabled></select></label><button id="trip-correct" disabled>Set current station</button></div>
    <p class="hint">After a correction to a transfer station, board the next train and tap. At ordinary stops, wait for departure or use Mark departure now if already moving. Correcting a detected arrival pauses detection for 10 seconds. New boarding/exit directions appear immediately during the correction window. At the destination, the exit instruction stays on screen.</p>
    <details><summary>Detection log (also included in JSON export)</summary><ol id="trip-events"></ol></details>`

  let lastEvent: unknown
  let lastRoute: unknown
  let lastDiagnostic: string | undefined
  const readSettings = () => Object.fromEntries(Object.keys(defaultSettings).map(k => [k, Number(el<HTMLInputElement>(`trip-${k}`).value)])) as TrackerSettings
  const plannerControls = mountPlannerControls(el('trip-planner'), (plan, options) => {
    if (options.demoTiming) for (const [key, value] of Object.entries(demoSettings)) el<HTMLInputElement>(`trip-${key}`).value = String(value)
    tracker.loadTripPlan(plan, readSettings(), now(), options.demoTiming ? 12 : undefined)
    el<HTMLTextAreaElement>('trip-route').value = routeTextFromStops(tracker.route)
    el('trip-error').textContent = ''; render()
  }, speech)
  function render(diagnostic?: string) {
    if (diagnostic !== undefined) lastDiagnostic = diagnostic
    const t = now(), active = tracker.active
    const view = tripStatus(tracker, t)
    const display = view.presentation, journey = display.journey
    renderGlassesPreview(document.getElementById('glasses-preview')! as unknown as SVGSVGElement,
      speech && (speech.busy || speech.snapshot().micMayBeOn) ? speechGlasses(speech.snapshot()) : glassesView(tracker, t, lastDiagnostic))
    el('trip-start-hint').textContent = display.pending ? 'Arrival detected: directions have advanced. Tap if not at this station to restore the previous position. Wait for the correction window to finish before tapping to board the next train.' : tracker.state === 'waiting-boarding' ? 'TRANSFER: board the next train, then SINGLE-TAP THE GLASSES to resume tracking. Walking between trains is ignored.' : tracker.state === 'ready' ? 'Board your train, then SINGLE-TAP THE GLASSES to begin tracking.' : tracker.state === 'idle' ? 'First load your route. Then board your train and single-tap the glasses.' : ''
    el<HTMLFieldSetElement>('trip-config').disabled = active
    el<HTMLButtonElement>('trip-arm').disabled = !tracker.canArm || plannerControls.busy() || !!speech?.busy || !!speech?.snapshot().micMayBeOn
    el('trip-arm').textContent = tracker.state === 'waiting-boarding' ? 'Boarded next train: start tracking (or tap glasses)' : 'Start tracking (or tap glasses)'
    el<HTMLButtonElement>('trip-stop').disabled = !active
    el<HTMLButtonElement>('trip-depart').disabled = tracker.state !== 'waiting-departure'
    el<HTMLButtonElement>('trip-veto').disabled = tracker.state !== 'candidate'
    el('trip-veto').textContent = display.pending ? `Not at ${display.current?.name ?? 'this station'}` : 'Not at station'
    el<HTMLButtonElement>('trip-correct').disabled = !tracker.route.length
    const select = el<HTMLSelectElement>('trip-correction')
    select.disabled = !tracker.route.length
    if (lastRoute !== tracker.route) {
      select.replaceChildren(...tracker.route.map((s, i) => new Option(`${i + 1}. ${s.name}`, String(i))))
      lastRoute = tracker.route
    }
    const current = display.current?.name
    el('trip-status').textContent = `${view.status}${current ? ` | ${display.pending ? 'Detected station' : 'Current'}: ${current} (${display.stationIndex + 1}/${tracker.route.length})` : ''}${display.nextStop ? ` | Next: ${display.nextStop.name}` : ''}`
    el('trip-timing').textContent = `${tracker.demoTravelSeconds ? `DEMO: simulated ${tracker.demoTravelSeconds}-second segments. ` : ''}${view.timing}`
    const instruction = display.state === 'complete' ? 'Follow exit signs.'
      : display.canArm ? view.instruction : tracker.sensing ? `Get off at ${journey.destination}.` : null
    el('trip-instruction').textContent = instruction ? `Instruction: ${instruction}` : ''
    el('trip-instruction').hidden = !instruction
    el('trip-evidence').textContent = `${tracker.sensing && t - tracker.lastValidAt > 1500 ? 'Waiting for fresh phone linear acceleration. ' : ''}${tracker.motionWindowMs} ms mean acceleration: ${tracker.meanMagnitude?.toFixed(3) ?? '--'} m/s²; direction consistency: ${tracker.coherence?.toFixed(2) ?? '--'} (motion needs ≥ 0.50). Glasses IMU is recorded as context; it does not drive the count.`
    if (lastEvent !== tracker.events.at(-1)) {
      lastEvent = tracker.events.at(-1)
      el('trip-events').replaceChildren(...tracker.events.slice(-25).reverse().map(event => {
        const li = document.createElement('li')
        li.textContent = `${(event.t / 1000).toFixed(1)} s: ${event.action} — ${JSON.stringify(event.detail)}`
        return li
      }))
    }
  }
  function arm() {
    if (plannerControls.busy() || speech?.busy || speech?.snapshot().micMayBeOn) { el('trip-error').textContent = 'Finish planning or cancel voice input before starting tracking.'; return }
    tracker.arm(now()); if (tracker.active) onArm(); render()
  }
  el('trip-load').onclick = () => {
    try {
      const settings = readSettings()
      tracker.load(parseRoute(el<HTMLTextAreaElement>('trip-route').value), settings, now())
      el('trip-error').textContent = ''; render()
    } catch (error) { el('trip-error').textContent = String(error) }
  }
  el('trip-real-preset').onclick = () => {
    el<HTMLTextAreaElement>('trip-route').value = exampleRoute(180)
    for (const [key, value] of Object.entries(defaultSettings)) el<HTMLInputElement>(`trip-${key}`).value = String(value)
  }
  el('trip-demo-preset').onclick = () => {
    el<HTMLTextAreaElement>('trip-route').value = exampleRoute(12)
    for (const [key, value] of Object.entries(demoSettings)) el<HTMLInputElement>(`trip-${key}`).value = String(value)
  }
  el('trip-arm').onclick = arm
  el('trip-stop').onclick = () => { tracker.stop(now()); render() }
  el('trip-depart').onclick = () => { tracker.manualDeparture(now()); render() }
  el('trip-veto').onclick = () => { tracker.veto(now()); render() }
  el('trip-correct').onclick = () => { tracker.correct(Number(el<HTMLSelectElement>('trip-correction').value), now()); render() }
  if (tracker.state === 'idle') {
    for (const [key, value] of Object.entries(demoSettings)) el<HTMLInputElement>(`trip-${key}`).value = String(value)
    tracker.load(parseRoute(exampleRoute(12)), demoSettings, now())
  }
  render()
  return {
    render,
    tap() {
      if (tracker.canArm) { arm(); return true }
      if (tracker.state === 'candidate') { tracker.veto(now()); render(); return true }
      return false
    },
    glassesText() {
      return tripStatus(tracker, now()).glassesText
    },
  }
}
