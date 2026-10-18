type Counts = {
  durationMs: number; heartbeats: number; phoneEvents: number; validLinearEvents: number
  glassesImuEvents: number; taps: number; bridgeAccepted: number; bridgeFailed: number
  maxHeartbeatGapMs: number; maxLinearGapMs: number
}
const counts = (): Counts => ({ durationMs: 0, heartbeats: 0, phoneEvents: 0, validLinearEvents: 0,
  glassesImuEvents: 0, taps: 0, bridgeAccepted: 0, bridgeFailed: 0, maxHeartbeatGapMs: 0, maxLinearGapMs: 0 })
export type LockTestReport = {
  schemaVersion: 1; id: string; startedAt: number; endedAt: number | null
  visible: Counts; hidden: Counts
  events: { at: number; type: string }[]
}

// Receipt-time diagnostics only. Hidden is a WebView visibility state, not proof
// the physical screen is locked. Bridge acceptance is not proof pixels changed.
export class LockTest {
  report: LockTestReport | null = null
  private hidden = false
  private segmentStart = 0
  private lastHeartbeat = 0
  private lastLinear = 0
  get active() { return !!this.report && this.report.endedAt === null }
  start(at: number, hidden: boolean) {
    this.report = { schemaVersion: 1, id: `lock-${at}`, startedAt: at, endedAt: null,
      visible: counts(), hidden: counts(), events: [] }
    this.hidden = hidden; this.segmentStart = this.lastHeartbeat = this.lastLinear = at
    this.event('started', at)
  }
  private get bucket() { return this.report![this.hidden ? 'hidden' : 'visible'] }
  private gap(at: number, then: number) { return Math.max(0, at - then) }
  private closeSegment(at: number) {
    const b = this.bucket
    b.durationMs += this.gap(at, this.segmentStart)
    b.maxHeartbeatGapMs = Math.max(b.maxHeartbeatGapMs, this.gap(at, this.lastHeartbeat))
    b.maxLinearGapMs = Math.max(b.maxLinearGapMs, this.gap(at, this.lastLinear))
  }
  visibility(hidden: boolean, at: number) {
    if (!this.active || hidden === this.hidden) return
    this.closeSegment(at)
    this.hidden = hidden; this.segmentStart = this.lastHeartbeat = this.lastLinear = at
    this.event(hidden ? 'page-hidden' : 'page-visible', at)
  }
  event(type: string, at: number) {
    if (!this.active) return
    this.report!.events.push({ at, type })
    if (this.report!.events.length > 200) this.report!.events.shift()
  }
  heartbeat(at: number, hidden: boolean) {
    if (!this.active) return
    this.visibility(hidden, at)
    const b = this.bucket; b.heartbeats++
    b.maxHeartbeatGapMs = Math.max(b.maxHeartbeatGapMs, this.gap(at, this.lastHeartbeat))
    this.lastHeartbeat = at
  }
  phone(at: number, hidden: boolean, validLinear: boolean) {
    if (!this.active) return
    this.visibility(hidden, at); this.bucket.phoneEvents++
    if (!validLinear) return
    const b = this.bucket; b.validLinearEvents++
    b.maxLinearGapMs = Math.max(b.maxLinearGapMs, this.gap(at, this.lastLinear)); this.lastLinear = at
  }
  glassesImu(at: number, hidden: boolean) {
    if (!this.active) return
    this.visibility(hidden, at); this.bucket.glassesImuEvents++
  }
  tap(at: number, hidden: boolean) {
    if (!this.active) return
    this.visibility(hidden, at); this.bucket.taps++; this.event('glasses-tap', at)
  }
  bridgeResult(ok: boolean, at: number, hidden: boolean) {
    if (!this.active) return
    this.visibility(hidden, at); this.bucket[ok ? 'bridgeAccepted' : 'bridgeFailed']++
  }
  stop(at: number, hidden: boolean) {
    if (!this.active) return
    this.visibility(hidden, at); this.closeSegment(at); this.event('stopped', at)
    this.report!.endedAt = at
  }
  snapshot(at: number) {
    if (!this.report) return null
    const result = structuredClone(this.report)
    if (this.active) {
      const b = result[this.hidden ? 'hidden' : 'visible']
      b.durationMs += this.gap(at, this.segmentStart)
      b.maxHeartbeatGapMs = Math.max(b.maxHeartbeatGapMs, this.gap(at, this.lastHeartbeat))
      b.maxLinearGapMs = Math.max(b.maxLinearGapMs, this.gap(at, this.lastLinear))
    }
    return result
  }
}

export const lockTestStorageKey = 'alwaysontrack:lock-test:v1'
export function readLockTestReport(text: string | null): LockTestReport | null {
  try {
    if (!text || text.length > 100000) return null
    const report = JSON.parse(text)
    if (report.schemaVersion !== 1 || typeof report.id !== 'string' || !Number.isFinite(report.startedAt) ||
      (report.endedAt !== null && !Number.isFinite(report.endedAt)) || !Array.isArray(report.events)) return null
    for (const mode of ['visible', 'hidden']) {
      if (!report[mode] || Object.keys(counts()).some(k => !Number.isFinite(report[mode][k]) || report[mode][k] < 0)) return null
    }
    return report as LockTestReport
  } catch { return null }
}
