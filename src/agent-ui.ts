import type { GlassesSpeech } from './asr/stt.ts'
import { parseTripPlan, type TripPlan } from './trip-plan.ts'

export function mountAgentControls(root: HTMLElement, showRoutes: (plans: TripPlan[], recommendedId: string | null) => void,
  busyChanged: (busy: boolean) => void, speech?: GlassesSpeech) {
  root.innerHTML = `<h3>Tell me your trip</h3>
    <p>Say or type where you are and where you want to go. For example: “I'm at Times Square and want to go to Union Square, with as few transfers as possible.”</p>
    <p id="agent-readiness" role="status"></p><ol id="agent-messages" aria-live="polite"></ol>
    <label for="agent-message">Trip request or reply</label><textarea id="agent-message" maxlength="2000" placeholder="I'm at Times Square. Take me to Union Square."></textarea>
    <div class="controls"><button id="agent-record" type="button">Speak on glasses</button><button id="agent-finish" type="button" disabled>Finish recording</button>
    <button id="agent-cancel-voice" type="button" disabled>Cancel voice</button><button id="agent-send" type="button">Plan my trip</button><button id="agent-reset" type="button">New conversation</button></div>
    <p id="agent-voice-status" role="status"></p><p id="agent-status" role="status"></p>
    <p class="hint">Voice uses a short glasses-microphone recording (up to 30 seconds). Tap the glasses or press Finish to transcribe. Review the text before sending it to the agent.</p>`
  const find = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  const input = find<HTMLTextAreaElement>('agent-message'), status = find('agent-status'), log = find('agent-messages')
  let messages: { role: 'user' | 'assistant'; text: string }[] = [], planning = false, voiceBusy = false, revision = 0
  function controls() {
    const s = speech?.snapshot()
    voiceBusy = !!speech?.busy || !!s?.micMayBeOn
    find<HTMLButtonElement>('agent-send').disabled = planning || voiceBusy
    find<HTMLButtonElement>('agent-reset').disabled = planning || voiceBusy
    find<HTMLButtonElement>('agent-record').disabled = planning || voiceBusy || !speech
    find<HTMLButtonElement>('agent-finish').disabled = s?.phase !== 'recording'
    find<HTMLButtonElement>('agent-cancel-voice').disabled = !voiceBusy
    input.disabled = planning || voiceBusy
    busyChanged(planning || voiceBusy)
  }
  function add(role: 'user' | 'assistant', text: string) {
    messages.push({ role, text })
    const item = document.createElement('li'); item.textContent = `${role === 'user' ? 'You' : 'Agent'}: ${text}`; log.append(item)
  }
  fetch('/api/agent/status').then(r => r.json()).then(data => {
    const provider = data.provider === 'groq' ? 'Groq' : 'Gemini'
    find('agent-readiness').textContent = data.configured ? `${provider} configured (${data.model}).` : `Add ${data.provider === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY'} to .env.local on the laptop, then restart the server. Manual route search below still works.`
  }).catch(() => { find('agent-readiness').textContent = 'Agent service unavailable. Use the companion backend or manual route search below.' })
  speech?.subscribe(s => {
    if (s.revision > revision) { revision = s.revision; input.value = s.transcript; status.textContent = 'Transcript ready. Edit if needed, then press Plan my trip.' }
    find('agent-voice-status').textContent = s.phase === 'recording' ? `Listening on glasses: ${s.seconds.toFixed(1)} seconds received. Tap glasses or Finish when done.`
      : s.phase === 'starting' ? 'Opening glasses microphone...'
        : s.phase === 'stopping' ? 'Closing microphone...'
          : s.phase === 'transcribing' ? 'Microphone off. Transcribing your request...'
            : s.phase === 'error' ? s.error : ''
    controls()
  })
  find('agent-record').onclick = () => { void speech?.start().catch(e => { status.textContent = String(e) }) }
  find('agent-finish').onclick = () => { void speech?.stop() }
  find('agent-cancel-voice').onclick = () => { void speech?.cancel() }
  find('agent-reset').onclick = () => { messages = []; log.replaceChildren(); input.value = ''; status.textContent = ''; showRoutes([], null) }
  find('agent-send').onclick = async () => {
    if (planning || voiceBusy || !input.value.trim()) { if (!input.value.trim()) status.textContent = 'Speak or type your trip first.'; return }
    const outgoing = [...messages.slice(-10), { role: 'user' as const, text: input.value.trim() }]
    planning = true; controls(); status.textContent = 'Resolving your request and checking subway routes...'; showRoutes([], null)
    try {
      const response = await fetch('/api/agent/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: outgoing }), signal: AbortSignal.timeout(90000) })
      const data = await response.json()
      if (!response.ok) throw new Error([data.error || 'Trip planning failed.', ...(data.rejected || [])].join(' '))
      if (typeof data.message !== 'string' || data.message.length > 2000 || !Array.isArray(data.plans)) throw new Error('Invalid agent response.')
      const plans = data.plans.map(parseTripPlan)
      add('user', input.value.trim()); add('assistant', data.message); input.value = ''
      showRoutes(plans, plans.some((p: TripPlan) => p.id === data.recommendedId) ? data.recommendedId : null)
      status.textContent = plans.length ? 'Review the itinerary below, then load it. Tracking begins only after your boarding tap.' : 'Reply to the question above, by voice or text.'
    } catch (e) { status.textContent = e instanceof Error ? e.message : 'Trip planning failed.' }
    finally { planning = false; controls() }
  }
  controls()
}
