import { parseTripPlan, type TripPlan } from './trip-plan'

export function mountPlannerControls(root: HTMLElement, load: (plan: TripPlan) => void) {
  root.innerHTML = `<details><summary>Plan a NYC subway journey</summary>
    <p>Enter an origin and destination before boarding. Results combine Google Maps transit directions with MTA station schedules.</p>
    <div class="controls"><label>Origin <input id="plan-origin" placeholder="Times Square, NYC" maxlength="300"></label>
    <label>Destination <input id="plan-destination" placeholder="Atlantic Avenue, Brooklyn" maxlength="300"></label>
    <button id="plan-search" type="button">Find subway routes</button></div>
    <p id="plan-status" role="status"></p><div id="plan-results"></div>
    <details><summary>Import prepared trip JSON</summary><textarea id="plan-json" aria-label="Prepared trip JSON" placeholder="Paste a version 1 trip plan"></textarea>
    <button id="plan-import" type="button">Load prepared trip</button></details></details>`
  const find = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  const status = find('plan-status'), results = find('plan-results'), search = find<HTMLButtonElement>('plan-search')
  fetch('/api/trips/status').then(r => r.ok ? r.json() : null).then(config => {
    if (!config) { status.textContent = 'Route service unavailable. Use the Vite server or the planner server; prepared trip JSON can still be imported.'; return }
    status.textContent = !config.configured ? 'Setup: add GOOGLE_MAPS_API_KEY to .env.local on the laptop and restart Vite.'
      : !config.catalogAvailable ? 'Setup: run npm run gtfs:import on the laptop to load MTA schedules.'
        : `Route service ready. MTA schedule imported ${config.scheduleFetchedAt}.`
  }).catch(() => { status.textContent = 'Route service unavailable. Prepared trip JSON can still be imported.' })
  find('plan-import').onclick = () => {
    try { load(parseTripPlan(JSON.parse(find<HTMLTextAreaElement>('plan-json').value))); status.textContent = 'Prepared trip loaded. Board the first train, then tap to start.' }
    catch (error) { status.textContent = String(error) }
  }
  search.onclick = async () => {
    const origin = find<HTMLInputElement>('plan-origin').value.trim(), destination = find<HTMLInputElement>('plan-destination').value.trim()
    if (!origin || !destination) { status.textContent = 'Enter both an origin and a destination.'; return }
    search.disabled = true; results.replaceChildren(); status.textContent = 'Finding routes and matching MTA stops…'
    try {
      const response = await fetch('/api/trips/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination }), signal: AbortSignal.timeout(45000) })
      const data = await response.json()
      if (!response.ok) throw new Error([data.error || `Route service returned ${response.status}`, ...(data.rejected || [])].join(' '))
      const plans = (data.plans as unknown[]).map(parseTripPlan)
      for (const plan of plans) {
        const card = document.createElement('fieldset'), title = document.createElement('legend')
        title.textContent = `${plan.origin} → ${plan.destination}`; card.append(title)
        const list = document.createElement('ol')
        for (const leg of plan.legs) {
          const li = document.createElement('li')
          li.textContent = leg.kind === 'walk' ? `Walk (${Math.ceil(leg.durationSeconds / 60)} min): ${leg.instruction}`
            : `${leg.line.name} toward ${leg.line.headsign}: ${leg.stops[0].name} → ${leg.stops.at(-1)!.name} (${leg.stops.length - 1} stops). ${leg.stops.map(s => s.name).join(' → ')}`
          list.append(li)
        }
        const attribution = document.createElement('p'); attribution.textContent = plan.source.attribution
        const notes = document.createElement('p'); notes.textContent = plan.warnings.join(' ')
        const use = document.createElement('button'); use.type = 'button'; use.textContent = 'Load this itinerary'
        use.onclick = () => {
          try { load(plan); status.textContent = 'Trip loaded. Board at the first subway station listed, then tap the glasses.' }
          catch (error) { status.textContent = String(error) }
        }
        const details = document.createElement('details'), summary = document.createElement('summary'), json = document.createElement('textarea')
        summary.textContent = 'Prepared trip JSON'; json.readOnly = true; json.value = JSON.stringify(plan, null, 2)
        json.setAttribute('aria-label', 'Prepared trip JSON'); details.append(summary, json)
        card.append(list, attribution, notes, use, details); results.append(card)
      }
      status.textContent = `${plans.length} resolved itinerary(s). Choose one to load.${data.rejected?.length ? ` ${data.rejected.length} other itinerary(s) could not be resolved.` : ''}`
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Route planning failed.' }
    finally { search.disabled = false }
  }
}
