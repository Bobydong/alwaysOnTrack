import { renderGlassesPreview, glassesLayoutKey, panelSignature, type GlassesPanel } from './glasses-view.ts'
import type { mobileJourney } from './mobile-view.ts'

export type MobileState = {
  journey: ReturnType<typeof mobileJourney>; desired: GlassesPanel[]; delivered: GlassesPanel[] | null;
  connected: boolean; previewOnly: boolean; sending: boolean; displayError: string; notice: string;
  motion: 'off' | 'waiting' | 'live' | 'stale'; blocked: boolean; canDepart: boolean; canLoad: boolean;
  canStop: boolean; demoTiming: boolean; selectedDemoTiming: boolean;
  route: { name: string }[]; stationIndex: number;
}
export type MobileActions = { tap: () => Promise<void>; scroll: (direction: number) => void; newTrip: () => Promise<void>;
  motion: () => Promise<void>; demo: () => void; depart: () => void; stop: () => void;
  correct: (index: number) => void; timing: (demo: boolean) => void }

export function mobileMirror(s: Pick<MobileState, 'connected' | 'previewOnly' | 'sending' | 'displayError' | 'desired' | 'delivered'>) {
  const same = s.delivered && glassesLayoutKey(s.delivered) === glassesLayoutKey(s.desired) &&
    s.delivered.every((p, i) => panelSignature(p) === panelSignature(s.desired[i]))
  const delivered = s.connected && s.delivered && !s.previewOnly
  return { panels: delivered ? s.delivered! : s.desired,
    label: !s.connected || s.previewOnly ? 'Preview only' : s.displayError ? 'Update failed' : same && !s.sending ? 'Sent to glasses' : 'Updating glasses',
    note: delivered ? 'Last fully sent display. Native font rendering may differ slightly.' : 'App preview. Open through Even with glasses connected to send it.',
  }
}

export function mountMobile(getState: () => MobileState, actions: MobileActions) {
  const lab = document.querySelector<HTMLElement>('#app > main')!
  lab.id = 'lab-view'
  const root = document.createElement('main'); root.id = 'mobile-view'
  root.innerHTML = `<header class="mobile-header"><div><span class="mobile-wordmark">ALWAYSONTRACK</span><p>A quieter way to get there.</p></div><button id="mobile-open-lab" class="mobile-subtle" type="button">Lab</button></header>
    <section class="mobile-mirror" aria-label="Glasses display monitor"><div class="mobile-section-head"><h1>Glasses view</h1><span id="mobile-sync" class="mobile-chip" role="status">Preview</span></div>
      <div class="mobile-display"><svg id="mobile-glasses" viewBox="0 0 576 288" role="img" aria-label="Glasses display preview"></svg></div>
      <p id="mobile-mirror-note" class="mobile-fine">App display preview. Native font rendering may differ slightly.</p></section>
    <section id="mobile-detector" class="mobile-detector" aria-label="Station detector status" hidden>
      <span class="mobile-eyebrow">STATION DETECTOR</span><h2 id="mobile-detector-status"></h2><p id="mobile-detector-timing" role="status"></p></section>
    <section class="mobile-trip" aria-label="Current instruction"><div class="mobile-section-head"><span class="mobile-eyebrow">RIGHT NOW</span><span id="mobile-timing" class="mobile-chip" hidden>Demo timing</span></div>
      <h2 id="mobile-title"></h2><p id="mobile-detail" role="status"></p>
      <div id="mobile-choice" class="mobile-choice" hidden><button id="mobile-choice-prev" type="button" class="mobile-secondary">Previous</button><span id="mobile-choice-label"></span><button id="mobile-choice-next" type="button" class="mobile-secondary">Next</button></div>
      <button id="mobile-primary" class="mobile-primary" type="button">Start recording</button>
      <div id="mobile-remaining" class="mobile-remaining" hidden><strong id="mobile-count"></strong><span id="mobile-endpoint"></span></div>
      <p id="mobile-feedback" class="mobile-feedback" role="alert" hidden></p></section>
    <div class="mobile-health"><span><span id="mobile-health-dot" class="mobile-dot"></span><span id="mobile-motion-status">Motion off</span></span><button id="mobile-enable-motion" type="button" class="mobile-subtle">Enable motion</button></div>
    <div class="mobile-footer"><button id="mobile-new-trip" class="mobile-secondary" type="button">New trip</button><span>Keep the phone screen on during the demo.</span></div>
    <details class="mobile-tools"><summary>Demo controls</summary><div class="mobile-tool-content"><label class="mobile-toggle"><input id="mobile-demo-timing" type="checkbox"> Use 12-second station segments</label>
      <button id="mobile-demo-route" type="button" class="mobile-secondary">Load the NYC demo</button><button id="mobile-depart" type="button" class="mobile-secondary">Mark departure now</button>
      <div class="mobile-correct"><label for="mobile-station">Correct current station</label><select id="mobile-station"></select><button id="mobile-correct" type="button" class="mobile-secondary">Set station</button></div>
      <button id="mobile-stop" type="button" class="mobile-secondary">Stop tracking</button><p class="mobile-fine">For manual routing, sensor settings, recordings and exports, open Lab.</p></div></details>`
  lab.before(root)
  const back = document.createElement('button'); back.type = 'button'; back.textContent = 'Back to mobile view'; back.id = 'lab-open-mobile'
  lab.prepend(back)
  const style = document.createElement('style')
  style.textContent = `body[data-phone-view="mobile"]{background:#f3f6f3;color:#182c23}#mobile-view{max-width:640px;margin:0 auto;padding:24px 18px max(24px,env(safe-area-inset-bottom));font:15px/1.5 system-ui,-apple-system,sans-serif;min-height:100dvh}#mobile-view [hidden],#lab-view[hidden],#mobile-view[hidden]{display:none!important}#mobile-view button,#mobile-view select{font:inherit;min-height:44px;cursor:pointer;border-radius:12px;padding:11px 15px}#mobile-view button:disabled{opacity:.45;cursor:default}#mobile-view button:focus-visible,#mobile-view select:focus-visible,#mobile-view summary:focus-visible{outline:3px solid #42795c;outline-offset:3px}.mobile-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:4px 0 24px}.mobile-wordmark{font-size:13px;font-weight:750;letter-spacing:.14em}.mobile-header p{margin:5px 0 0;color:#65776c;font-size:13px}#mobile-view section{margin:0 0 16px;border:1px solid #dfe6df;border-radius:20px;background:#fff;padding:20px;box-shadow:0 3px 16px #1b342005}.mobile-section-head{display:flex;gap:12px;justify-content:space-between;align-items:center;margin-bottom:14px}.mobile-section-head h1{font-size:15px;line-height:1.4;margin:0;font-weight:650}.mobile-eyebrow{font-size:11px;letter-spacing:.12em;color:#63786b;font-weight:700}#mobile-view .mobile-chip{font-size:11px;line-height:1.4;padding:5px 9px;border-radius:20px;background:#edf3ed;color:#405e4c;white-space:nowrap}#mobile-view .mobile-chip[data-state="error"]{background:#fff0e9;color:#8b3b23}.mobile-display{background:#030b06;border-radius:12px;overflow:hidden}.mobile-display svg{display:block;width:100%;height:auto;aspect-ratio:2/1}.mobile-fine{font-size:11px;color:#68786d;margin:10px 0 0}#mobile-view .mobile-trip h2{margin:0 0 10px;font-size:24px;line-height:1.25;font-weight:650;letter-spacing:-.025em}#mobile-detail{white-space:pre-line;margin:0;color:#5a7061;overflow-wrap:anywhere}.mobile-primary{display:block;width:100%;margin-top:20px;background:#235a42;color:#fff;border:1px solid #235a42;font-weight:650!important}.mobile-secondary{background:#fff;color:#31513e;border:1px solid #ccd9ce}.mobile-subtle{background:transparent;color:#31513e;border:0!important}#mobile-view .mobile-subtle{padding:8px 10px}.mobile-choice{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:16px}.mobile-choice span{font-size:12px;color:#5a7061;text-align:center}.mobile-remaining{display:flex;flex-direction:column;border-top:1px solid #edf1ec;padding-top:16px;margin-top:18px}.mobile-remaining strong{font-size:17px;font-weight:650}.mobile-remaining span{color:#667c6d;font-size:13px;overflow-wrap:anywhere}.mobile-health{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 4px;color:#596f60;font-size:12px}.mobile-health>span{display:flex;align-items:center;gap:8px}.mobile-dot{width:7px;height:7px;border-radius:50%;display:inline-block;background:#96a69a}.mobile-dot[data-state="live"]{background:#2c8051}.mobile-dot[data-state="stale"]{background:#a46336}.mobile-footer{display:flex;gap:14px;align-items:center;padding:14px 0 20px}.mobile-footer span{font-size:11px;color:#728174;max-width:210px}.mobile-tools{border-top:1px solid #dce5dc;padding:16px 0;color:#617969}.mobile-tools summary{font-size:13px;cursor:pointer;min-height:32px}.mobile-tool-content{display:grid;gap:12px;padding-top:12px}.mobile-toggle{display:flex;gap:10px;align-items:center;font-size:13px}.mobile-toggle input{width:18px;height:18px;accent-color:#235a42}.mobile-correct{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px}.mobile-correct label{grid-column:1/-1;font-size:12px}#mobile-view select{background:#fff;color:#244831;border:1px solid #ccd9ce;min-width:0;width:100%}.mobile-feedback{color:#943f27;background:#fff3ed;border-radius:10px;padding:12px;font-size:13px;overflow-wrap:anywhere}#lab-open-mobile{margin-bottom:20px}@media(max-width:360px){#mobile-view{padding:18px 12px}#mobile-view section{padding:15px}.mobile-choice{gap:5px}#mobile-view .mobile-choice button{padding:9px 10px}}`
  style.textContent += '#mobile-view .mobile-detector{background:#e8f2e9;border:2px solid #91ad97;padding:20px}#mobile-view .mobile-detector .mobile-eyebrow{color:#3b6046;font-size:12px}#mobile-detector-status{margin:10px 0 12px;font-size:clamp(26px,7vw,34px);line-height:1.2;font-weight:750;color:#153b26;overflow-wrap:anywhere}#mobile-detector-timing{margin:0;font-size:clamp(22px,6vw,28px);line-height:1.35;font-weight:650;color:#224b32;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}'
  document.head.append(style)
  const find = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!
  let feedback = '', signature = '', routeKey = '', lastStationIndex = -1
  let view = new URLSearchParams(location.search).get('view') === 'lab' ? 'lab' : 'mobile'
  function switchView(next: string) {
    view = next; root.hidden = view !== 'mobile'; lab.hidden = view !== 'lab'; document.body.dataset.phoneView = view
    const url = new URL(location.href); if (view === 'lab') url.searchParams.set('view', 'lab'); else url.searchParams.delete('view')
    history.replaceState(null, '', url); render(); window.scrollTo(0, 0)
  }
  async function run(action: () => void | Promise<void>) {
    feedback = ''
    try { await action() } catch (e) { feedback = e instanceof Error ? e.message : 'Action failed. Try again.' }
    render()
  }
  find('mobile-open-lab').onclick = () => switchView('lab'); back.onclick = () => switchView('mobile')
  find('mobile-primary').onclick = () => { void run(actions.tap) }
  find('mobile-choice-prev').onclick = () => { void run(() => actions.scroll(-1)) }
  find('mobile-choice-next').onclick = () => { void run(() => actions.scroll(1)) }
  find('mobile-new-trip').onclick = () => { void run(actions.newTrip) }
  find('mobile-enable-motion').onclick = () => { void run(actions.motion) }
  find('mobile-demo-route').onclick = () => { void run(actions.demo) }
  find('mobile-depart').onclick = () => { void run(actions.depart) }
  find('mobile-stop').onclick = () => { void run(actions.stop) }
  find('mobile-correct').onclick = () => { void run(() => actions.correct(Number(find<HTMLSelectElement>('mobile-station').value))) }
  find<HTMLInputElement>('mobile-demo-timing').onchange = event => { actions.timing((event.target as HTMLInputElement).checked); render() }
  function render() {
    if (view !== 'mobile') return
    const s = getState(), j = s.journey
    const mirror = mobileMirror(s), preview = mirror.panels
    const nextSignature = glassesLayoutKey(preview) + preview.map(panelSignature).join('|')
    if (signature !== nextSignature) { signature = nextSignature; renderGlassesPreview(find('mobile-glasses') as unknown as SVGSVGElement, preview) }
    const sync = find('mobile-sync')
    sync.textContent = mirror.label
    sync.dataset.state = s.displayError ? 'error' : 'normal'
    find('mobile-mirror-note').textContent = mirror.note
    find('mobile-title').textContent = j.title; find('mobile-detail').textContent = j.detail
    find('mobile-detector').hidden = !j.detector
    find('mobile-detector-status').textContent = j.detector?.status ?? ''
    find('mobile-detector-timing').textContent = j.detector?.timing ?? ''
    // The dedicated detector card replaces the small duplicate tracking detail.
    find('mobile-detail').hidden = !!j.detector
    const primary = find<HTMLButtonElement>('mobile-primary'); primary.textContent = j.action; primary.hidden = !j.action; primary.disabled = !j.canAct || !s.connected || s.blocked
    find('mobile-choice').hidden = !j.canChoose; find('mobile-choice-label').textContent = j.choiceLabel
    find<HTMLButtonElement>('mobile-choice-prev').disabled = s.blocked; find<HTMLButtonElement>('mobile-choice-next').disabled = s.blocked
    find('mobile-remaining').hidden = !j.hasTrip
    find('mobile-count').textContent = j.stopsLeft ? `${j.stopsLeft} ${j.stopsLeft === 1 ? 'stop' : 'stops'} to ${j.transfer ? 'transfer' : 'get off'}` : 'Ride complete'
    find('mobile-endpoint').textContent = j.endpoint
    find('mobile-timing').hidden = !j.hasTrip || !s.demoTiming
    find('mobile-health-dot').dataset.state = s.motion
    find('mobile-motion-status').textContent = { off: 'Phone motion off', waiting: 'Waiting for phone motion', live: 'Phone motion live', stale: 'Phone motion paused' }[s.motion]
    find('mobile-enable-motion').hidden = s.motion === 'live'; find('mobile-enable-motion').textContent = s.motion === 'off' ? 'Enable motion' : 'Restart motion'
    find<HTMLButtonElement>('mobile-new-trip').disabled = s.blocked
    find('mobile-new-trip').hidden = !j.showReset; find('mobile-new-trip').textContent = j.resetLabel
    find<HTMLButtonElement>('mobile-demo-route').disabled = !s.canLoad || s.blocked
    find<HTMLButtonElement>('mobile-depart').disabled = !s.canDepart || s.blocked
    find<HTMLButtonElement>('mobile-stop').disabled = !s.canStop || s.blocked
    find<HTMLInputElement>('mobile-demo-timing').checked = s.selectedDemoTiming
    find<HTMLInputElement>('mobile-demo-timing').disabled = !s.canLoad
    const select = find<HTMLSelectElement>('mobile-station'), nextRoute = JSON.stringify(s.route)
    if (routeKey !== nextRoute) { routeKey = nextRoute; lastStationIndex = -1; select.replaceChildren(...s.route.map((stop, index) => new Option(stop.name, String(index)))) }
    if (lastStationIndex !== s.stationIndex) { select.value = String(s.stationIndex); lastStationIndex = s.stationIndex }
    select.disabled = !s.route.length || s.blocked
    find<HTMLButtonElement>('mobile-correct').disabled = !s.route.length || s.blocked
    const problem = feedback || s.displayError || (!s.connected ? s.notice : '')
    find('mobile-feedback').textContent = problem; find('mobile-feedback').hidden = !problem
  }
  switchView(view)
  return { render, isLab: () => view === 'lab' }
}
