import type { GlassesSpeech } from './asr/stt.ts'
import { companionFetch } from './companion.ts'
import { parseTripPlan, type TripPlan } from './trip-plan.ts'

export type PlanningPhase = 'prompt' | 'listening' | 'understanding' | 'choose-origin' | 'choose-destination' | 'confirm' | 'planning' | 'loaded' | 'error'
export type ResolvedPlace = { placeId: string; name: string; address: string }
export type PlanningSnapshot = { phase: PlanningPhase; origin: string; destination: string; yes: boolean; error: string;
  originCandidates?: ResolvedPlace[]; destinationCandidates?: ResolvedPlace[]; originIndex?: number; destinationIndex?: number }
const compactPlace = (place: ResolvedPlace) => `${place.name}, ${place.address.split(',')[0]}`
export function confirmationLabel(place: ResolvedPlace) {
  const full = compactPlace(place)
  if (full.length <= 70) return full
  const shorten = (s: string, n: number) => s.length > n ? s.slice(0, n - 3) + '...' : s
  return `${shorten(place.name, 28)}, ${shorten(place.address.split(',')[0], 38)}`
}

export class GlassesPlanner {
  private state: PlanningSnapshot = { phase: 'prompt', origin: '', destination: '', yes: true, error: '' }
  private speech: GlassesSpeech
  private load: (plan: TripPlan) => void | Promise<void>
  private fetchImpl: typeof fetch
  private listeners = new Set<() => void>()
  private epoch = 0
  private revision = 0
  private abort: AbortController | undefined
  private resolutionId = ''
  constructor(speech: GlassesSpeech, load: (plan: TripPlan) => void | Promise<void>, fetchImpl: typeof fetch = companionFetch) {
    this.speech = speech; this.load = load; this.fetchImpl = fetchImpl.bind(globalThis)
    speech.subscribe(s => {
      if (this.state.phase !== 'listening') return
      if (s.phase === 'error') { this.fail(s.error); return }
      if (s.revision > this.revision) { this.revision = s.revision; void this.understand(s.transcript); return }
      if (s.phase === 'transcribing' || s.phase === 'stopping') this.emit()
    })
  }
  snapshot(): PlanningSnapshot { return { ...this.state } }
  get visible() { return this.state.phase !== 'loaded' }
  get busy() { return ['listening', 'understanding', 'planning'].includes(this.state.phase) }
  subscribe(callback: () => void) { this.listeners.add(callback); return () => this.listeners.delete(callback) }
  private emit() { this.listeners.forEach(f => f()) }
  private fail(error: unknown) { this.state.phase = 'error'; this.state.error = error instanceof Error ? error.message : String(error); this.emit() }
  scroll(direction = 1) {
    if (this.state.phase === 'confirm') this.state.yes = !this.state.yes
    else if (this.state.phase === 'choose-origin' || this.state.phase === 'choose-destination') {
      const origin = this.state.phase === 'choose-origin', candidates = origin ? this.state.originCandidates! : this.state.destinationCandidates!
      const index = ((origin ? this.state.originIndex! : this.state.destinationIndex!) + direction + candidates.length) % candidates.length
      if (origin) { this.state.originIndex = index; this.state.origin = confirmationLabel(candidates[index]) }
      else { this.state.destinationIndex = index; this.state.destination = confirmationLabel(candidates[index]) }
    } else return
    this.emit()
  }
  dismiss() { ++this.epoch; this.abort?.abort(); this.state.phase = 'loaded'; this.emit() }
  async reset() {
    ++this.epoch; this.abort?.abort()
    this.resolutionId = ''
    this.state = { phase: 'prompt', origin: '', destination: '', yes: true, error: '' }; this.emit()
    await this.speech.cancel()
  }
  private async post(url: string, body: unknown) {
    this.abort = new AbortController()
    const response = await this.fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(90000)]) })
    const data = await response.json()
    if (!response.ok) throw new Error([data.error || 'Could not prepare your trip.', ...(data.rejected || [])].join(' '))
    return data
  }
  private async understand(text: string) {
    const epoch = this.epoch
    this.state.phase = 'understanding'; this.emit()
    try {
      const intent = await this.post('/api/agent/intent', { text })
      if (epoch !== this.epoch) return
      const parseCandidates = (list: unknown): ResolvedPlace[] => {
        if (!Array.isArray(list) || !list.length || list.length > 5) throw new Error('Place lookup returned no usable locations. Please try again.')
        return list.map(p => {
          if (!p || [p.placeId, p.name, p.address].some(v => typeof v !== 'string' || !v.trim() || v.length > 300)) throw new Error('Invalid place lookup result. Please try again.')
          return { placeId: p.placeId, name: p.name, address: p.address }
        })
      }
      if (typeof intent.resolutionId !== 'string' || !intent.resolutionId || intent.resolutionId.length > 100) throw new Error('Place lookup is unavailable. Restart the server and try again.')
      const originCandidates = parseCandidates(intent.originCandidates), destinationCandidates = parseCandidates(intent.destinationCandidates)
      this.resolutionId = intent.resolutionId
      this.state = { phase: originCandidates.length > 1 || compactPlace(originCandidates[0]).length > 70 ? 'choose-origin'
        : destinationCandidates.length > 1 || compactPlace(destinationCandidates[0]).length > 70 ? 'choose-destination' : 'confirm',
        origin: confirmationLabel(originCandidates[0]), destination: confirmationLabel(destinationCandidates[0]), yes: true, error: '',
        originCandidates, destinationCandidates, originIndex: 0, destinationIndex: 0 }; this.emit()
    } catch (e) { if (epoch === this.epoch) this.fail(e) }
  }
  async tap() {
    if (!this.visible) return false
    if (this.state.phase === 'prompt' || this.state.phase === 'error') {
      if (this.speech.busy || this.speech.snapshot().micMayBeOn) await this.speech.cancel()
      this.revision = this.speech.snapshot().revision
      const epoch = this.epoch
      this.state.phase = 'listening'; this.state.error = ''; this.emit()
      await this.speech.start().catch(e => { if (epoch === this.epoch) this.fail(e) })
    } else if (this.state.phase === 'listening') {
      await this.speech.stop()
    } else if (this.state.phase === 'choose-origin' || this.state.phase === 'choose-destination') {
      this.state.phase = this.state.phase === 'choose-origin' && (this.state.destinationCandidates!.length > 1 || compactPlace(this.state.destinationCandidates![0]).length > 70)
        ? 'choose-destination' : 'confirm'
      this.emit()
    } else if (this.state.phase === 'confirm') {
      if (!this.state.yes) { await this.reset(); return true }
      const epoch = this.epoch, { origin, destination } = this.state
      this.state.phase = 'planning'; this.emit()
      try {
        const result = await this.post('/api/agent/plan-confirmed', { origin, destination, resolutionId: this.resolutionId,
          originPlaceId: this.state.originCandidates![this.state.originIndex!].placeId,
          destinationPlaceId: this.state.destinationCandidates![this.state.destinationIndex!].placeId })
        if (epoch !== this.epoch) return true
        if (!Array.isArray(result.plans) || !result.plans.length) throw new Error('No matched subway route was found. Tap to try again.')
        const plans = result.plans.map(parseTripPlan)
        const selected = plans.find((p: TripPlan) => p.id === result.recommendedId) || plans[0]
        await this.load(selected)
        if (epoch === this.epoch) { this.state.phase = 'loaded'; this.emit() }
      } catch (e) { if (epoch === this.epoch) this.fail(e) }
    }
    return true
  }
}
