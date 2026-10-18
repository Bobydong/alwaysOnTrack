import { parseTripPlan, type TripPlan } from './trip-plan.ts'
import { mountAgentControls } from './agent-ui.ts'
import type { GlassesSpeech } from './asr/stt.ts'

export function mountPlannerControls(root: HTMLElement, load: (plan: TripPlan, options: { demoTiming: boolean }) => void, speech?: GlassesSpeech) {
  root.innerHTML = `<details open><summary>Plan a NYC subway journey</summary>
    <fieldset id="trip-agent-shell"><div id="trip-agent"></div></fieldset>
    <label><input id="plan-demo" type="checkbox" checked> Demo timing: 12 seconds per stop (simulated)</label>
    <p class="hint">Uncheck for scheduled travel times. Demo timing changes the tracker only; the prepared itinerary keeps the original MTA schedule.</p>
    <details><summary>Manual origin/destination search</summary>
    <div class="controls"><label>Origin <input id="plan-origin" placeholder="Times Square, NYC" maxlength="300"></label>
    <label>Destination <input id="plan-destination" placeholder="14 St-Union Square, NYC" maxlength="300"></label>
    <button id="plan-search" type="button">Find subway routes</button></div></details>
    <p id="plan-status" role="status"></p><div id="plan-results"></div>
    <details><summary>Import prepared trip JSON</summary><textarea id="plan-json" aria-label="Prepared trip JSON" placeholder="Paste a version 1 trip plan"></textarea>
    <button id="plan-import" type="button">Load prepared trip</button></details></details>`
  const find = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  const status = find('plan-status'), results = find('plan-results'), search = find<HTMLButtonElement>('plan-search')
  const busy = new Set<string>()
  function setBusy(source: string, value: boolean) {
    if (value) busy.add(source); else busy.delete(source)
    search.disabled = !!busy.size
    find<HTMLButtonElement>('plan-import').disabled = !!busy.size
    find<HTMLFieldSetElement>('trip-agent-shell').disabled = busy.has('manual')
    results.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = !!busy.size })
  }
  function use(plan: TripPlan) {
    if (busy.size) return
    const demoTiming = find<HTMLInputElement>('plan-demo').checked
    load(plan, { demoTiming })
    status.textContent = `Trip loaded${demoTiming ? ' with simulated 12-second travel times' : ' with MTA scheduled travel times'}. Board at the first subway station, then tap the glasses.`
  }
  function showRoutes(plans: TripPlan[], recommendedId: string | null) {
    results.replaceChildren()
    const ordered = [...plans].sort((a, b) => Number(b.id === recommendedId) - Number(a.id === recommendedId))
    for (const plan of ordered) {
      const card = document.createElement('fieldset'), title = document.createElement('legend')
      title.textContent = `${plan.id === recommendedId ? 'Recommended: ' : ''}${plan.origin} → ${plan.destination}`; card.append(title)
      const list = document.createElement('ol')
      for (const leg of plan.legs) {
        const li = document.createElement('li')
        li.textContent = leg.kind === 'walk' ? `Walk (${Math.ceil(leg.durationSeconds / 60)} min): ${leg.instruction}`
          : `${leg.line.name} toward ${leg.line.headsign}: ${leg.stops[0].name} → ${leg.stops.at(-1)!.name} (${leg.stops.length - 1} stops). ${leg.stops.map(s => s.name).join(' → ')}`
        list.append(li)
      }
      const attribution = document.createElement('p'); attribution.textContent = plan.source.attribution
      const notes = document.createElement('p'); notes.textContent = plan.warnings.join(' ')
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Load this itinerary'; button.disabled = !!busy.size
      button.onclick = () => { try { use(plan) } catch (e) { status.textContent = String(e) } }
      const details = document.createElement('details'), summary = document.createElement('summary'), json = document.createElement('textarea')
      summary.textContent = 'Prepared trip JSON'; json.readOnly = true; json.value = JSON.stringify(plan, null, 2)
      json.setAttribute('aria-label', 'Prepared trip JSON'); details.append(summary, json)
      card.append(list, attribution, notes, button, details); results.append(card)
    }
  }
  mountAgentControls(find('trip-agent'), showRoutes, value => setBusy('agent', value), speech)
  fetch('/api/trips/status').then(r => r.ok ? r.json() : null).then(config => {
    status.textContent = !config ? 'Route service unavailable. Start the companion backend.'
      : !config.configured ? 'Add GOOGLE_MAPS_API_KEY to .env.local on the laptop and restart the server.'
        : !config.catalogAvailable ? 'Run npm run gtfs:import to load MTA schedules.' : `Route service ready. MTA schedule imported ${config.scheduleFetchedAt}.`
  }).catch(() => { status.textContent = 'Route service unavailable. Prepared trip JSON can still be imported.' })
  find('plan-import').onclick = () => {
    try { use(parseTripPlan(JSON.parse(find<HTMLTextAreaElement>('plan-json').value))) }
    catch (e) { status.textContent = String(e) }
  }
  search.onclick = async () => {
    if (busy.size) return
    const origin = find<HTMLInputElement>('plan-origin').value.trim(), destination = find<HTMLInputElement>('plan-destination').value.trim()
    if (!origin || !destination) { status.textContent = 'Enter both an origin and a destination.'; return }
    setBusy('manual', true); results.replaceChildren(); status.textContent = 'Finding routes and matching MTA stops...'
    try {
      const response = await fetch('/api/trips/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination }), signal: AbortSignal.timeout(45000) })
      const data = await response.json()
      if (!response.ok) throw new Error([data.error || `Route service returned ${response.status}`, ...(data.rejected || [])].join(' '))
      const plans = data.plans.map(parseTripPlan)
      showRoutes(plans, null)
      status.textContent = `${plans.length} resolved itinerary(s). Choose one to load.${data.rejected?.length ? ` ${data.rejected.length} other itinerary(s) could not be resolved.` : ''}`
    } catch (e) { status.textContent = e instanceof Error ? e.message : 'Route planning failed.' }
    finally { setBusy('manual', false) }
  }
  return { busy: () => !!busy.size }
}
