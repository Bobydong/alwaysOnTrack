import type { PhoneMotionSample } from './imu-data'

export type Stop = { name: string; travelSeconds: number }
export type TrackerSettings = {
  departureWindowMs: number; departureThreshold: number; departureSeconds: number
  windowMs: number; motionThreshold: number; quietThreshold: number
  motionSeconds: number; dwellSeconds: number; vetoSeconds: number
  settlingSeconds: number
}
export const defaultSettings: TrackerSettings = {
  departureWindowMs: 500, departureThreshold: 0.35, departureSeconds: 0.7,
  windowMs: 500, motionThreshold: 0.35, quietThreshold: 0.18,
  motionSeconds: 0.8, dwellSeconds: 3, vetoSeconds: 8,
  settlingSeconds: 0.5,
}
export const demoSettings: TrackerSettings = {
  ...defaultSettings,
  windowMs: 250, motionThreshold: 0.35, quietThreshold: 0.25,
  motionSeconds: 0.4, dwellSeconds: 0.25, vetoSeconds: 6,
  settlingSeconds: 0.3,
}
export type TripState = 'idle' | 'ready' | 'waiting-departure' | 'travelling' | 'arrival-watch' | 'candidate' | 'cooldown' | 'complete'
export type TripEvent = { t: number; action: string; state: TripState; stationIndex: number; detail: Record<string, unknown> }

export function parseRoute(text: string): Stop[] {
  const stops = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map((line, i) => {
    const parts = line.split('|').map(s => s.trim())
    const travelSeconds = i === 0 ? 0 : Number(parts[1])
    if (!parts[0] || parts.length > 2 || (i > 0 && (!Number.isFinite(travelSeconds) || travelSeconds < 5 || travelSeconds > 7200))) {
      throw new Error('Use one station per line: station name | seconds from previous stop (5–7200 seconds).')
    }
    return { name: parts[0].slice(0, 100), travelSeconds }
  })
  if (stops.length < 2 || stops.length > 50) throw new Error('Enter 2–50 stations, starting with your current station.')
  return stops
}

// Experimental motion evidence: a jolt, a settling interval, then quiet.
// This is not a physical determination of braking or proof of a station stop.
export class StationTracker {
  route: Stop[] = []
  settings = { ...defaultSettings }
  state: TripState = 'idle'
  stationIndex = 0
  departureAt: number | null = null
  candidateUntil: number | null = null
  lastValidAt = -Infinity
  meanMagnitude: number | null = null
  coherence: number | null = null
  readonly events: TripEvent[] = []
  private window: { t: number; x: number; y: number; z: number; magnitude: number }[] = []
  private motionSince: number | null = null
  private quietSince: number | null = null
  private braking: { joltAt: number; settleUntil: number } | null = null
  retryAfter = -Infinity
  cooldownReason: string | null = null
  private stale = false
  private lastIgnoredAt = -Infinity

  get active() { return ['waiting-departure', 'travelling', 'arrival-watch', 'candidate', 'cooldown'].includes(this.state) }
  get nextStop() { return this.route[this.stationIndex + 1] }
  get motionWindowMs() { return this.state === 'waiting-departure' ? this.settings.departureWindowMs : this.settings.windowMs }
  get brakingPhase() {
    if (this.state !== 'arrival-watch') return 'arrival detection inactive'
    if (!this.braking) return 'waiting for jolt'
    return this.lastValidAt < this.braking.settleUntil ? 'allowing motion to settle' : 'waiting for quiet dwell'
  }
  get watchAt() {
    if (this.departureAt === null || !this.nextStop) return null
    return this.departureAt + Math.floor(this.nextStop.travelSeconds * 0.9) * 1000
  }
  get expectedAt() { return this.departureAt === null || !this.nextStop ? null : this.departureAt + this.nextStop.travelSeconds * 1000 }

  private log(t: number, action: string, detail: Record<string, unknown> = {}) {
    this.events.push({ t, action, state: this.state, stationIndex: this.stationIndex, detail })
    if (this.events.length > 5000) this.events.shift()
  }
  private resetEvidence() {
    this.window = []; this.motionSince = null; this.quietSince = null; this.braking = null
    this.meanMagnitude = null; this.coherence = null
  }
  private evidence() { return { meanMagnitude: this.meanMagnitude, directionCoherence: this.coherence } }

  load(route: Stop[], settings: TrackerSettings, now: number) {
    if (this.active) throw new Error('Stop tracking before replacing the route or detector settings.')
    // Validate both UI input and programmatic callers.
    const checked = parseRoute(route.map((s, i) => `${s.name}${i ? ` | ${s.travelSeconds}` : ''}`).join('\n'))
    if (Object.values(settings).some(v => !Number.isFinite(v)) ||
        settings.departureWindowMs < 100 || settings.departureWindowMs > 1000 ||
        settings.departureThreshold <= 0 || settings.departureThreshold > 20 || settings.departureSeconds < 0.1 || settings.departureSeconds > 10 ||
        settings.windowMs < 100 || settings.windowMs > 1000 || settings.quietThreshold < 0 || settings.motionThreshold < settings.quietThreshold || settings.motionThreshold > 20 ||
        settings.motionSeconds < 0.1 || settings.motionSeconds > 10 || settings.dwellSeconds < 0.2 || settings.dwellSeconds > 30 ||
        settings.settlingSeconds < 0 || settings.settlingSeconds > 3 ||
        settings.vetoSeconds < 1 || settings.vetoSeconds > 30) throw new Error('Check detector settings: motion threshold must be at least the quiet threshold; durations must be within the shown ranges.')
    this.route = checked; this.settings = { ...settings }; this.stationIndex = 0; this.departureAt = null
    this.candidateUntil = null; this.retryAfter = -Infinity; this.cooldownReason = null; this.resetEvidence(); this.state = 'ready'
    this.log(now, 'route-loaded', { route: this.route, settings: this.settings })
  }
  arm(now: number) {
    if (this.state !== 'ready') return
    this.state = 'waiting-departure'; this.resetEvidence(); this.lastValidAt = -Infinity; this.stale = false
    this.log(now, 'armed', { reason: 'Waiting for sustained departure motion; timer has not started.' })
  }
  stop(now: number) {
    if (!this.route.length) return
    this.state = 'ready'; this.departureAt = null; this.candidateUntil = null; this.cooldownReason = null; this.resetEvidence()
    this.log(now, 'tracking-stopped')
  }
  manualDeparture(now: number) {
    if (this.state === 'waiting-departure') this.depart(now, 'manual-departure')
  }
  private depart(now: number, action: string) {
    const evidence = this.evidence()
    this.departureAt = now; this.state = 'travelling'; this.retryAfter = -Infinity; this.cooldownReason = null; this.resetEvidence()
    this.log(now, action, { ...evidence, expectedAt: this.expectedAt, watchAt: this.watchAt })
  }
  correct(index: number, now: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.route.length) return
    this.stationIndex = index; this.departureAt = null; this.candidateUntil = null; this.retryAfter = -Infinity; this.cooldownReason = null; this.resetEvidence()
    this.state = index === this.route.length - 1 ? 'complete' : 'waiting-departure'
    this.log(now, 'manual-station-correction', { reason: 'Current station set by user; waiting for a new departure.' })
  }
  veto(now: number) {
    if (this.state !== 'candidate') return
    this.cooldown(now, 'Arrival vetoed', 10000)
    this.log(now, 'arrival-vetoed', { retryAfter: this.retryAfter })
  }
  private cooldown(now: number, reason: string, durationMs = 2000) {
    this.state = 'cooldown'; this.candidateUntil = null; this.retryAfter = now + durationMs
    this.cooldownReason = reason; this.resetEvidence()
  }
  private accept(now: number) {
    this.stationIndex++; this.departureAt = null; this.candidateUntil = null; this.resetEvidence()
    this.state = this.stationIndex === this.route.length - 1 ? 'complete' : 'waiting-departure'
    this.log(now, 'arrival-counted', { station: this.route[this.stationIndex].name, reason: 'Jolt, settling, quiet dwell, and veto period completed.' })
  }
  suspend(now: number, reason: string) {
    if (!this.active) return
    if (this.state === 'candidate') {
      this.cooldown(now, 'Arrival cancelled: phone motion unavailable')
      this.log(now, 'candidate-cancelled', { reason })
    }
    this.resetEvidence()
    if (!this.stale) this.log(now, 'sensor-evidence-reset', { reason })
    this.stale = true
  }
  tick(now: number) {
    if (!this.active) return
    if (now - this.lastValidAt > 1500) this.suspend(now, 'Phone linear acceleration missing or paused; no dwell inferred from silence.')
    const watchAt = this.watchAt
    if (this.state === 'travelling' && watchAt !== null && now >= watchAt) {
      this.state = 'arrival-watch'; this.resetEvidence()
      this.log(now, 'arrival-window-open', { expectedAt: this.expectedAt })
    }
    if (this.state === 'cooldown' && now >= this.retryAfter) {
      this.state = 'arrival-watch'; this.cooldownReason = null; this.resetEvidence()
      this.log(now, 'arrival-cooldown-ended', { reason: 'Waiting for a new jolt; cooldown motion was discarded.' })
    }
    // Timers alone never count a station. Acceptance requires a fresh quiet sample.
  }
  ingest(sample: PhoneMotionSample) {
    if (!this.active || sample.t <= this.lastValidAt) return
    this.tick(sample.t)
    if (sample.t - this.lastValidAt > 500) this.suspend(sample.t, 'Sample gap exceeded 500 ms; rebuilding continuous motion/dwell evidence.')
    const { x, y, z } = sample.acceleration
    if (x === null || y === null || z === null || ![x, y, z].every(Number.isFinite)) {
      this.suspend(sample.t, 'Gravity-removed acceleration unavailable; gravity-inclusive data is not a substitute.')
      return
    }
    if (this.stale) { this.log(sample.t, 'sensor-resumed'); this.stale = false }
    this.lastValidAt = sample.t
    // Cooldown samples maintain sensor health but cannot build arrival evidence.
    if (this.state === 'cooldown') return
    this.window.push({ t: sample.t, x, y, z, magnitude: Math.hypot(x, y, z) })
    this.window = this.window.filter(s => s.t >= sample.t - this.motionWindowMs)
    if (this.window.length < 4 || sample.t - this.window[0].t < this.motionWindowMs * 0.8) return
    const n = this.window.length
    this.meanMagnitude = this.window.reduce((sum, s) => sum + s.magnitude, 0) / n
    const meanVector = (['x', 'y', 'z'] as const).map(k => this.window.reduce((sum, s) => sum + s[k], 0) / n)
    const vectorLength = Math.hypot(...meanVector)
    this.coherence = vectorLength / Math.max(this.meanMagnitude, 0.0001)
    const departing = this.state === 'waiting-departure'
    // Tiny tolerance preserves the inclusive quiet boundary after floating-point averaging.
    const quietCeiling = this.settings.quietThreshold + 1e-9
    const motion = this.meanMagnitude >= (departing ? this.settings.departureThreshold : this.settings.motionThreshold) &&
      (departing || this.meanMagnitude > quietCeiling) && this.coherence >= 0.5
    const quiet = this.meanMagnitude <= quietCeiling
    this.motionSince = motion ? this.motionSince ?? sample.t : null
    this.quietSince = quiet ? this.quietSince ?? sample.t : null
    const sustained = this.motionSince !== null && sample.t - this.motionSince >= (departing ? this.settings.departureSeconds : this.settings.motionSeconds) * 1000
    if (this.state === 'waiting-departure' && sustained) { this.depart(sample.t, 'departure-detected'); return }
    if (this.state === 'travelling') {
      if (sustained && sample.t - this.lastIgnoredAt > 5000) {
        this.log(sample.t, 'early-motion-ignored', { ...this.evidence(), watchAt: this.watchAt }); this.lastIgnoredAt = sample.t
      }
      return
    }
    if (this.state === 'candidate') {
      // Motion during the veto countdown may be the user shifting position.
      // Only an explicit tap veto or loss of the sensor stream cancels it.
      if (this.candidateUntil !== null && sample.t >= this.candidateUntil) this.accept(sample.t)
      return
    }
    if (this.state !== 'arrival-watch') return
    if (!this.braking) {
      if (sustained && vectorLength > 0) {
        this.braking = { joltAt: sample.t, settleUntil: sample.t + this.settings.settlingSeconds * 1000 }
        this.quietSince = null
        this.log(sample.t, 'braking-jolt', { ...this.evidence(), settleUntil: this.braking.settleUntil })
      }
      return
    }
    if (sample.t - this.braking.joltAt > Math.max(12000, (this.settings.dwellSeconds + this.settings.settlingSeconds + 4) * 1000)) {
      this.resetEvidence(); this.log(sample.t, 'braking-evidence-expired', { reason: 'Jolt did not settle into a quiet dwell.' }); return
    }
    if (sample.t < this.braking.settleUntil) { this.quietSince = null; return }
    if (this.quietSince !== null && sample.t - this.quietSince >= this.settings.dwellSeconds * 1000) {
      this.state = 'candidate'; this.candidateUntil = sample.t + this.settings.vetoSeconds * 1000
      this.log(sample.t, 'arrival-candidate', { ...this.evidence(), station: this.nextStop?.name, candidateUntil: this.candidateUntil })
    }
  }
  snapshot() {
    return { route: this.route, settings: this.settings, state: this.state, stationIndex: this.stationIndex,
      departureAt: this.departureAt, watchAt: this.watchAt, expectedAt: this.expectedAt, candidateUntil: this.candidateUntil,
      retryAfter: Number.isFinite(this.retryAfter) ? this.retryAfter : null, cooldownReason: this.cooldownReason,
      brakingPhase: this.brakingPhase,
      detector: 'Experimental mean linear acceleration with separate departure and braking settings. Braking requires a coherent jolt, settling, then quiet dwell. Recoil is not required. Quiet is not proof of zero train speed. No calibrated confidence or physical braking classification.',
      events: this.events }
  }
}
