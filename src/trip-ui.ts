import { defaultSettings, demoSettings, parseRoute, StationTracker, type TrackerSettings } from './station-tracker'
import { el } from './imu-ui'
import { tripStatus } from './trip-status'

export function mountTripControls(tracker: StationTracker, now: () => number, onArm: () => void) {
  const style = document.createElement('style')
  style.textContent = '#trip-panel fieldset{border:1px solid #52687b;border-radius:7px;padding:12px}#trip-panel input{font:inherit;padding:8px;width:90px}#trip-panel details{margin:12px 0}#trip-events{max-height:280px;overflow:auto;overflow-wrap:anywhere}#trip-error{color:#ff8c92}#trip-route{height:110px}'
  document.head.append(style)
  el('trip-panel').innerHTML = `<h2>Experimental station counter</h2>
    <p><strong>To start: enable phone motion, load a route, then single-tap the glasses.</strong> You can also use Start tracking on the phone. Recording starts then; the travel timer waits for departure.</p>
    <fieldset id="trip-config"><legend>Route and detector settings</legend>
    <div class="controls"><button id="trip-real-preset">Example route (3-minute segments)</button><button id="trip-demo-preset">Short demo (12-second segments, responsive sensing)</button></div>
    <label for="trip-route">One station per line; seconds from the previous station after |</label>
    <textarea id="trip-route" aria-label="Trip route">Start station\nSecond station | 180\nDestination | 180</textarea>
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
    <p id="trip-error" role="alert"></p><p id="trip-start-hint" role="status"></p><p id="trip-status" role="status"></p><p id="trip-timing"></p><p id="trip-evidence" class="hint"></p>
    <div class="controls"><label>Correct current station <select id="trip-correction" disabled></select></label><button id="trip-correct" disabled>Set current station</button></div>
    <p class="hint">After a correction, wait for departure or use Mark departure now if already moving. Veto cancels the pending count and pauses detection for 10 seconds. Accepted arrivals wait for a new departure. Timers alone never advance a station.</p>
    <details><summary>Detection log (also included in JSON export)</summary><ol id="trip-events"></ol></details>`

  let lastEvent: unknown
  let lastRoute: unknown
  function render() {
    const t = now(), active = tracker.active
    const view = tripStatus(tracker, t)
    el('trip-start-hint').textContent = tracker.state === 'ready' ? 'Ready: SINGLE-TAP THE GLASSES to begin tracking. Departure detection starts after your tap.' : tracker.state === 'idle' ? 'First load your route. Then single-tap the glasses to begin tracking.' : ''
    el<HTMLFieldSetElement>('trip-config').disabled = active
    el<HTMLButtonElement>('trip-arm').disabled = tracker.state !== 'ready'
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
    el('trip-evidence').textContent = `${active && t - tracker.lastValidAt > 1500 ? 'Waiting for fresh phone linear acceleration. ' : ''}${tracker.motionWindowMs} ms mean acceleration: ${tracker.meanMagnitude?.toFixed(3) ?? '--'} m/s²; direction consistency: ${tracker.coherence?.toFixed(2) ?? '--'} (motion needs ≥ 0.50). Glasses IMU is recorded as context; it does not drive the count.`
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
    el<HTMLTextAreaElement>('trip-route').value = 'Start station\nSecond station | 180\nDestination | 180'
    for (const [key, value] of Object.entries(defaultSettings)) el<HTMLInputElement>(`trip-${key}`).value = String(value)
  }
  el('trip-demo-preset').onclick = () => {
    el<HTMLTextAreaElement>('trip-route').value = 'Demo start\nDemo stop 2 | 12\nDemo destination | 12'
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
      if (tracker.state === 'ready') { arm(); return true }
      if (tracker.state === 'candidate') { tracker.veto(now()); render(); return true }
      return false
    },
    glassesText() {
      return tripStatus(tracker, now()).glassesText
    },
  }
}
