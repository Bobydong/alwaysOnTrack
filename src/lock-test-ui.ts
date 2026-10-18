import { renderGlassesPreview, type GlassesPanel } from './glasses-view.ts'
import type { LockTestReport } from './lock-test.ts'
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T

export function mountLockTestControls(start: () => Promise<void>, stop: () => void, exportReport: () => void) {
  el('lock-test-panel').innerHTML = `<h2>Screen-lock diagnostic</h2>
    <p>Run this while no trip is active. Start the test, then lock the phone for 30 seconds.
    Watch whether the counter advances on the glasses. Single-tap the glasses while locked to test input.
    Unlock, stop the test, and export JSON. Repeat for five minutes after the short test.</p>
    <p class="hint">This temporarily replaces the glasses display with test counters. It does not keep the screen on or enable background sensor access.</p>
    <div class="controls"><button id="lock-test-start">Start screen-lock test</button>
    <button id="lock-test-stop" disabled>Stop test</button><button id="lock-test-export">Prepare diagnostic JSON</button></div>
    <p id="lock-test-message" role="status"></p><pre id="lock-test-summary" style="white-space:pre-wrap"></pre>`
  el('lock-test-start').onclick = () => { void start().catch(e => { el('lock-test-message').textContent = String(e) }) }
  el('lock-test-stop').onclick = stop
  el('lock-test-export').onclick = exportReport
}

export function renderLockTest(report: LockTestReport | null, active: boolean) {
  el<HTMLButtonElement>('lock-test-start').disabled = active
  el<HTMLButtonElement>('lock-test-stop').disabled = !active
  el<HTMLButtonElement>('lock-test-export').disabled = !report
  if (!report) return
  if (active) {
    const preview = document.getElementById('glasses-preview') as unknown as SVGSVGElement | null
    if (preview) renderGlassesPreview(preview, lockTestGlasses(report, Date.now()))
  }
  const h = report.hidden, v = report.visible
  el('lock-test-summary').textContent = [
    active ? 'TEST RUNNING' : report.endedAt === null ? 'Previous test was interrupted/reloaded; counters below were saved before interruption.' : 'TEST STOPPED',
    `Hidden time: ${(h.durationMs / 1000).toFixed(1)} s`,
    `Phone events: ${v.phoneEvents} visible / ${h.phoneEvents} hidden`,
    `Valid linear acceleration: ${v.validLinearEvents} visible / ${h.validLinearEvents} hidden`,
    `Hidden maximum linear-acceleration gap: ${(h.maxLinearGapMs / 1000).toFixed(2)} s`,
    `Hidden JS heartbeats: ${h.heartbeats}; maximum gap ${(h.maxHeartbeatGapMs / 1000).toFixed(2)} s`,
    `Hidden bridge accepts/failures: ${h.bridgeAccepted}/${h.bridgeFailed}; hidden taps: ${h.taps}`,
    'Hidden means page visibility, not verified screen lock. A bridge acceptance does not prove the display updated: report what you saw on the glasses.',
  ].join('\n')
}

export function lockTestGlasses(report: LockTestReport, at: number): GlassesPanel[] {
  const make = (id: number, name: string, x: number, y: number, content: string): GlassesPanel => ({
    containerID: id, containerName: name, xPosition: x, yPosition: y, width: 264, height: 116,
    borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: 10, isEventCapture: 0, content,
  })
  return [
    { ...make(6, 'trip-input', 0, 0, ' '), width: 576, height: 288, paddingLength: 0, isEventCapture: 1 },
    make(1, 'trip-station', 8, 8, `LOCK TEST\n${Math.floor((at - report.startedAt) / 1000)}s`),
    make(3, 'trip-detail', 304, 8, `PHONE EVENTS\n${report.visible.phoneEvents + report.hidden.phoneEvents}`),
    make(4, 'trip-action', 8, 164, `VALID LINEAR\n${report.visible.validLinearEvents + report.hidden.validLinearEvents}`),
    make(5, 'trip-progress', 304, 164, `GLASSES TAPS\n${report.visible.taps + report.hidden.taps}`),
  ]
}
