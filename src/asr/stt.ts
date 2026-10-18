export const speechLimitSeconds = 30
export function pcmToWav(chunks: Uint8Array[]) {
  const size = chunks.reduce((n, b) => n + b.length, 0)
  if (size % 2) throw new Error('Incomplete PCM sample. Please record again.')
  const wav = new Uint8Array(44 + size), view = new DataView(wav.buffer)
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + size, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, size, true)
  let offset = 44
  for (const chunk of chunks) { wav.set(chunk, offset); offset += chunk.length }
  return wav
}
export type SpeechPhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'transcribing' | 'error'
export type SpeechSnapshot = { phase: SpeechPhase; seconds: number; error: string; transcript: string; revision: number; micMayBeOn: boolean }

// Short, explicit recordings only. No API key or provider credentials reach G2.
export class GlassesSpeech {
  phase: SpeechPhase = 'idle'
  private chunks: Uint8Array[] = []
  private length = 0
  private epoch = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private abort: AbortController | undefined
  private listeners = new Set<(state: SpeechSnapshot) => void>()
  private error = ''
  private transcript = ''
  private revision = 0
  private micMayBeOn = false
  private opening: Promise<boolean> | undefined
  private closing: Promise<void> | undefined
  private microphone: (open: boolean) => Promise<boolean>
  private fetchImpl: typeof fetch
  constructor(microphone: (open: boolean) => Promise<boolean>, fetchImpl: typeof fetch = fetch) {
    this.microphone = microphone
    // WebView fetch requires Window as its receiver, not this speech controller.
    this.fetchImpl = fetchImpl.bind(globalThis)
  }
  get busy() { return this.phase !== 'idle' && this.phase !== 'error' }
  get capturing() { return this.phase === 'starting' || this.phase === 'recording' }
  snapshot(): SpeechSnapshot { return { phase: this.phase, seconds: this.length / 32000, error: this.error,
    transcript: this.transcript, revision: this.revision, micMayBeOn: this.micMayBeOn } }
  subscribe(callback: (state: SpeechSnapshot) => void) { this.listeners.add(callback); callback(this.snapshot()); return () => this.listeners.delete(callback) }
  private emit() { const s = this.snapshot(); this.listeners.forEach(f => f(s)) }
  async start() {
    if (this.busy || this.micMayBeOn) throw new Error('Finish or cancel the current recording first.')
    const epoch = ++this.epoch
    this.phase = 'starting'; this.error = ''; this.chunks = []; this.length = 0; this.micMayBeOn = true; this.emit()
    try {
      const opening = this.microphone(true); this.opening = opening
      const ok = await opening
      if (this.opening === opening) this.opening = undefined
      if (epoch !== this.epoch) return
      if (!ok) throw new Error('Glasses microphone was not enabled. Check the Even app microphone permission.')
      this.phase = 'recording'; this.emit()
      this.timer = setTimeout(() => { void this.stop() }, speechLimitSeconds * 1000)
      if (this.length >= speechLimitSeconds * 32000) void this.stop()
    } catch (e) {
      if (epoch !== this.epoch) return
      await this.closeMic().catch(() => {})
      this.fail(e)
    }
  }
  sendPcm(chunk: Uint8Array) {
    if (!this.capturing || !chunk.length) return
    const remaining = speechLimitSeconds * 32000 - this.length
    if (remaining > 0) { const bytes = chunk.slice(0, remaining); this.chunks.push(bytes); this.length += bytes.length; this.emit() }
    if (this.length >= speechLimitSeconds * 32000 && this.phase === 'recording') void this.stop()
  }
  private async closeMic() {
    if (this.closing) return this.closing
    if (!this.micMayBeOn) return
    const closing = (async () => {
      if (!await this.microphone(false)) throw new Error('Could not close the glasses microphone. Press Cancel again or close the app.')
      this.micMayBeOn = false
    })()
    this.closing = closing
    try { await closing } finally { if (this.closing === closing) this.closing = undefined }
  }
  private fail(e: unknown) {
    this.phase = 'error'; this.error = e instanceof Error ? e.message : 'Speech input failed.'
    this.chunks = []; this.emit()
  }
  async stop() {
    if (this.phase !== 'recording') return
    const epoch = this.epoch
    clearTimeout(this.timer); this.phase = 'stopping'; this.emit()
    try {
      await this.closeMic()
      if (epoch !== this.epoch) return
      if (this.length < 8000) throw new Error('No usable audio yet. Speak for at least a moment, or type your request.')
      const wav = pcmToWav(this.chunks); this.chunks = []
      this.phase = 'transcribing'; this.abort = new AbortController(); this.emit()
      const response = await this.fetchImpl('/api/speech/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' },
        body: new Blob([wav], { type: 'audio/wav' }), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(40000)]) })
      const data = await response.json()
      if (epoch !== this.epoch) return
      if (!response.ok) throw new Error(data.error || `Speech request returned ${response.status}.`)
      if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 2000) throw new Error('No usable transcript. Please retry or type.')
      this.transcript = data.text.trim(); this.revision++; this.phase = 'idle'; this.emit()
    } catch (e) { if (epoch === this.epoch) this.fail(e) }
  }
  async cancel() {
    ++this.epoch; clearTimeout(this.timer); this.abort?.abort(); this.chunks = []; this.length = 0
    this.phase = 'stopping'; this.emit()
    try { await this.opening?.catch(() => false); this.opening = undefined; await this.closeMic(); this.phase = 'idle'; this.error = ''; this.emit() }
    catch (e) { this.fail(e) }
  }
}
