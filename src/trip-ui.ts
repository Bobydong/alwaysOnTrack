import { defaultSettings, demoSettings, parseRoute, StationTracker, type TrackerSettings } from './station-tracker'
import { el } from './imu-ui'
import { tripStatus } from './trip-status'

const exampleRoute = (seconds: number) => `Start station | 0 | Board the Blue Line\nSecond station | ${seconds} | Stay on this train\nTransfer station | ${seconds} | Change to the Green Line | transfer\nDestination | ${seconds} | Use the north exit`

export function mountTripControls(tracker: StationTracker, now: () => number, onArm: () => void) {
  const style = document.createElement('style')
  style.textContent = '#trip-panel fieldset{border:1px solid #52687b;border-radius:7px;padding:12px}#trip-panel input{font:inherit;padding:8px;width:90px}#trip-panel details{margin:12px 0}#trip-events{max-height:280px;overflow:auto;overflow-wrap:anywhere}#trip-error{color:#ff8c92}#trip-route{height:110px}'
  document.head.append(style)
  el('trip-panel').innerHTML = `<h2>Experimental station counter</h2>
    <p><strong>Board a train, then single-tap the glasses to start tracking.</strong> Enable phone motion and load a route first. At a transfer, tracking pauses until you board the next train and tap again. Ordinary stops continue automatically. You can also use Start tracking on the phone.</p>
    <fieldset id="trip-config"><legend>Route and detector settings</legend>
    <div class="controls"><button id="trip-real-preset">Example itinerary (3-minute segments)</button><button id="trip-demo-preset">Short demo with transfer (12-second segments)</button></div>
    <label for="trip-route">One station per line: name | seconds | optional instruction | transfer</label>
    <textarea id="trip-route" aria-label="Trip route">${exampleRoute(180)}</textarea>
    <p class="hint">Use 0 seconds for the starting station. Add “transfer” only to intermediate stops where you change trains. Instructions are optional (160 characters max); old name | seconds routes still work. These example directions are fictional.</p>
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
    <label>Veto period (seconds) <input id="trip-vetoSeconds" type="number" min="1" max="30" step="1" value="${defaultSettings.vetoSeconds}"></label>
    </div></details><button id="trip-load">Load route, then tap glasses to start</button></fieldset>
    <p class="hint">Arrival inputs stay blocked until 90% of the expected segment duration has elapsed. Then a jolt, settling, and quiet dwell can propose an arrival. Short demo: 0.35 m/s² for 0.4 seconds, 0.3 seconds to settle, then acceleration at or below 0.25 m/s² for 0.25 seconds. No recoil is required. During the veto countdown, shifting or other phone motion does not cancel the proposal; tap to veto. Quiet readings do not measure train speed.</p>
    <div class="controls"><button id="trip-arm" disabled>Start tracking (or tap glasses)</button><button id="trip-stop" disabled>Stop tracking</button>
    <button id="trip-depart" disabled>Mark departure now</button><button id="trip-veto" disabled>Veto arrival</button></div>
    <p id="trip-error" role="alert"></p><p id="trip-start-hint" role="status"></p><p id="trip-status" role="status"></p><p id="trip-instruction" role="status"></p><p id="trip-timing"></p><p id="trip-evidence" class="hint"></p>
    <div class="controls"><label>Correct current station <select id="trip-correction" disabled></select></label><button id="trip-correct" disabled>Set current station</button></div>
    <p class="hint">After a correction to a transfer station, board the next train and tap. At ordinary stops, wait for departure or use Mark departure now if already moving. Veto pauses detection for 10 seconds. Arrival instructions remain visible until the next departure. At the destination, the exit instruction stays on screen.</p>
    <details><summary>Detection log (also included in JSON export)</summary><ol id="trip-events"></ol></details>`

  let lastEvent: unknown
  let lastRoute: unknown
  function render() {
    const t = now(), active = tracker.active
    const view = tripStatus(tracker, t)
    el('trip-start-hint').textContent = tracker.state === 'waiting-boarding' ? 'TRANSFER: board the next train, then SINGLE-TAP THE GLASSES to resume tracking. Walking between trains is ignored.' : tracker.state === 'ready' ? 'Board your train, then SINGLE-TAP THE GLASSES to begin tracking.' : tracker.state === 'idle' ? 'First load your route. Then board your train and single-tap the glasses.' : ''
    el<HTMLFieldSetElement>('trip-config').disabled = active
    el<HTMLButtonElement>('trip-arm').disabled = !tracker.canArm
    el('trip-arm').textContent = tracker.state === 'waiting-boarding' ? 'Boarded next train: start tracking (or tap glasses)' : 'Start tracking (or tap glasses)'
    el<HTMLButtonElement>('trip-stop').disabled = !active
    el<HTMLButtonElement>('trip-depart').disabled = tracker.state !== 'waiting-departure'
    el<HTMLButtonElement>('trip-veto').disabled = tracker.state !== 'candidate'
    el<HTMLButtonElement>('trip-correct').disabled = !tracker.route.length
    const select = el<HTMLSelectElement>('trip-correction')
    select.disabled = !tracker.route.length
    if (lastRoute !== tracker.route) {
      select.replaceChildren(...tracker.route.map((s, i) => new Option(`${i + 1}. ${s.name}`, String(i))))
      lastRoute = tracker.route
    }
    const current = tracker.route[tracker.stationIndex]?.name
    el('trip-status').textContent = `${view.status}${current ? ` | Current: ${current} (${tracker.stationIndex + 1}/${tracker.route.length})` : ''}${tracker.nextStop ? ` | Next: ${tracker.nextStop.name}` : ''}`
    el('trip-timing').textContent = view.timing
    el('trip-instruction').textContent = view.instruction ? `Instruction: ${view.instruction}` : ''
    el('trip-instruction').hidden = !view.instruction
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
  function arm() { tracker.arm(now()); if (tracker.active) onArm(); render() }
  el('trip-load').onclick = () => {
    try {
      const settings = Object.fromEntries(Object.keys(defaultSettings).map(k => [k, Number(el<HTMLInputElement>(`trip-${k}`).value)])) as TrackerSettings
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
