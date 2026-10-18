import { waitForEvenAppBridge, TextContainerProperty, CreateStartUpPageContainer,
  TextContainerUpgrade, RebuildPageContainer, OsEventTypeList, ImuReportPace, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { axes, combinedCsv, phoneMotionFromEvent, readVector, summarize, type PhoneMotionSample, type Sample, type Mark, type Vector } from './imu-data'
import { mountDiagnostic, el, renderMotionComparison, renderPlot } from './imu-ui'
import { StationTracker } from './station-tracker'
import { mountTripControls } from './trip-ui'
import { glassesView, glassesLayoutKey } from './glasses-view'
import { LockTest, lockTestStorageKey, readLockTestReport, type LockTestReport } from './lock-test'
import { lockTestGlasses, mountLockTestControls, renderLockTest } from './lock-test-ui'
import { GlassesSpeech } from './asr/stt'
import { speechGlasses } from './asr/speech-view'
import { GlassesPlanner } from './glasses-planner'
import { planningView } from './planning-view'

mountDiagnostic()
const demo = new URLSearchParams(location.search).get('demo') === '1'
el('mode').textContent = demo ? 'SYNTHETIC PREVIEW: these values are generated, not G2 sensor data.' : 'LIVE G2 MODE: no synthetic sensor data. Voice planning uses the glasses microphone and the configured AI backend; sensor tests work without an AI key.'
const origin = performance.now()
const stamp = () => performance.now() - origin
const tracker = new StationTracker()
const lockTest = new LockTest()
let savedLockTest: LockTestReport | null = null
try { savedLockTest = readLockTestReport(localStorage.getItem(lockTestStorageKey)) } catch { /* Some WebViews disable storage. */ }
let lastLockSave = 0
let bridge: EvenAppBridge | undefined
let ready = false, running = false, busy = false, recording = false, phoneMotionOn = false, closed = false
let previewTimer: number | undefined
let history: Sample[] = [], phoneHistory: PhoneMotionSample[] = [], recorded: Sample[] = [], phoneRecorded: PhoneMotionSample[] = [], marks: Mark[] = []
let baseline: Vector = { x: null, y: null, z: null }
let lastReceipt = -Infinity, lastPhoneReceipt = -Infinity, startedAt = -Infinity, invalid = 0, phoneInvalid = 0, renderBusy = false
const glassContents = new Map<number, string>()
let glassLayout = ''
let downloadUrl = ''
let preparedExport: { filename: string; content: string; mime: string } | undefined
const sessions: { t: number; action: string; pace: number }[] = []
const pace = () => Number(el<HTMLSelectElement>('pace').value) as ImuReportPace
const label = () => el<HTMLSelectElement>('label').value
const status = (message: string) => { el('status').textContent = message }
const controls = () => {
  el<HTMLButtonElement>('start').disabled = !ready || busy || running || closed
  el<HTMLButtonElement>('stop').disabled = !ready || busy || closed
  el<HTMLSelectElement>('pace').disabled = busy || running
}
const recordInfo = () => { el('record-info').textContent = `${recording ? 'RECORDING' : 'Not recording'} | G2 ${recorded.length} samples | phone ${phoneRecorded.length} events | ${marks.length} markers | G2 ${invalid} empty / phone ${phoneInvalid} empty. In memory only: export before reload.`; el('record').textContent = recording ? 'Stop recording' : 'Start recording' }
const speech = new GlassesSpeech(async open => {
  if (!bridge || !ready || (open && closed)) throw new Error('Connect the glasses through the Even app before using voice input.')
  if (open && (tracker.active || lockTest.active)) throw new Error('Stop tracking or the screen-lock test before recording a trip request.')
  if (open) el<HTMLButtonElement>('trip-arm').disabled = true
  return bridge.audioControl(open)
})
const glassesPlanner = new GlassesPlanner(speech, async plan => {
  tripUI.loadPrepared(plan)
  await enablePhoneMotion()
})
const preparation = {
  panels: () => glassesPlanner.visible && !lockTest.active ? planningView(glassesPlanner.snapshot(), speech.snapshot()) : null,
  busy: () => glassesPlanner.busy,
  visible: () => glassesPlanner.visible,
  loaded: () => glassesPlanner.dismiss(),
}
const tripUI = mountTripControls(tracker, stamp, () => {
  if (!recording) { recording = true; mark('trip-tracking-start') }
}, speech, preparation)
// Phone equivalents make the glasses-only flow inspectable and recoverable.
const setup = document.createElement('div')
setup.innerHTML = '<h3>Glasses trip setup</h3><p id="glasses-setup-status" role="status"></p><div class="controls"><button id="glasses-setup-tap">Tap / select</button><button id="glasses-setup-scroll">Scroll Yes / No</button><button id="glasses-setup-reset">New spoken trip</button></div>'
el('trip-panel').prepend(setup)
el('glasses-setup-tap').onclick = () => { void glassesPlanner.tap() }
el('glasses-setup-scroll').onclick = () => glassesPlanner.scroll()
el('agent-record').onclick = () => {
  void (async () => { if (!glassesPlanner.visible) await glassesPlanner.reset(); await glassesPlanner.tap() })()
}
el('glasses-setup-reset').onclick = () => {
  if (tracker.active || lockTest.active) { status('Stop tracking or the lock test before planning a new trip.'); return }
  void glassesPlanner.reset()
}
function renderSetup() {
  const s = glassesPlanner.snapshot()
  const from = s.originCandidates?.[s.originIndex ?? 0], to = s.destinationCandidates?.[s.destinationIndex ?? 0]
  el('glasses-setup-status').textContent = `${s.phase}${from && to ? `: ${from.name}, ${from.address} → ${to.name}, ${to.address}` : ''}${s.phase === 'confirm' ? `. Selected: ${s.yes ? 'Yes' : 'No'}` : ''}${s.error ? `: ${s.error}` : ''}`
  el<HTMLButtonElement>('glasses-setup-scroll').disabled = !['confirm', 'choose-origin', 'choose-destination'].includes(s.phase)
  el<HTMLButtonElement>('glasses-setup-tap').disabled = ['loaded', 'understanding', 'planning'].includes(s.phase) || lockTest.active
  tripUI.render(); refreshGlasses()
}
glassesPlanner.subscribe(renderSetup)
renderSetup()
let lastSpeechPhase = speech.phase
speech.subscribe(s => { if (s.phase !== lastSpeechPhase) { lastSpeechPhase = s.phase; refreshGlasses() } })
function saveLockTest(force = false) {
  const at = Date.now()
  if (!force && !lockTest.active) return
  if (!force && at - lastLockSave < 1000) return
  const report = lockTest.snapshot(at)
  if (!report) return
  savedLockTest = report; lastLockSave = at
  try { localStorage.setItem(lockTestStorageKey, JSON.stringify(report)) }
  catch { el('lock-test-message').textContent = 'Diagnostic persistence unavailable; export before closing the app.' }
}
mountLockTestControls(async () => {
  if (!ready || !bridge) throw new Error('Open this page in the Even app with glasses connected before starting the test.')
  if (tracker.active) throw new Error('Stop trip tracking before running the screen-lock diagnostic.')
  if (speech.busy || speech.snapshot().micMayBeOn) throw new Error('Finish or cancel voice input before running the screen-lock test.')
  await enablePhoneMotion()
  if (!phoneMotionOn) throw new Error('Enable phone motion successfully before starting the test.')
  lockTest.start(Date.now(), document.hidden); saveLockTest(true)
  el<HTMLButtonElement>('trip-arm').disabled = true
  el('lock-test-message').textContent = 'Test started. Lock for 30 seconds, watch the glasses counter, and single-tap once while locked. Then unlock and stop the test.'
  renderLockTest(savedLockTest, true); refreshGlasses()
}, () => {
  lockTest.stop(Date.now(), document.hidden); saveLockTest(true)
  el('lock-test-message').textContent = 'Test stopped. Prepare diagnostic JSON and use Save to laptop. Include whether the glasses counter advanced while locked.'
  renderLockTest(savedLockTest, false); refreshGlasses()
}, () => exportData('json'))
renderLockTest(savedLockTest, false)
function mark(text = label()) {
  if (!recording) { status('Start recording first to save a marker.'); return }
  marks.push({ t: stamp(), wallTime: new Date().toISOString(), label: text }); recordInfo()
}
function receive(raw: { x?: number; y?: number; z?: number }) {
  if (!running || closed) return
  const vector = readVector(raw)
  lockTest.glassesImu(Date.now(), document.hidden)
  if (axes.every(a => vector[a] === null)) { invalid++; return }
  const sample: Sample = { ...vector, t: stamp(), wallTime: new Date().toISOString(), label: label() }
  if (sample.t - lastReceipt > 3000) {
    if (Number.isFinite(lastReceipt)) sessions.push({ t: sample.t, action: 'receipt-gap-ms:' + Math.round(sample.t - lastReceipt), pace: pace() })
    status(demo ? 'Receiving SYNTHETIC preview data.' : 'Receiving live G2 IMU samples. Units and axis meaning remain unverified.')
  }
  lastReceipt = sample.t
  history.push(sample)
  if (history.length > 5000) history = history.slice(-4000)
  if (recording) {
    recorded.push(sample)
    if (recorded.length + phoneRecorded.length >= 100000) { recording = false; status('Recording reached 100,000 total samples and stopped. Export before starting another recording.'); recordInfo() }
  }
}
function receivePhone(event: DeviceMotionEvent) {
  if (!phoneMotionOn || closed) return
  const sample = phoneMotionFromEvent(event, stamp(), new Date().toISOString(), label())
  lockTest.phone(Date.now(), document.hidden, axes.every(a => sample.acceleration[a] !== null))
  const previousPhase = displayPhase()
  if (!document.hidden) tracker.ingest(sample)
  if (previousPhase !== displayPhase()) { tripUI.render(); refreshGlasses() }
  if (axes.every(a => sample.acceleration[a] === null) && axes.every(a => sample.accelerationIncludingGravity[a] === null) &&
      sample.rotationRate.alpha === null && sample.rotationRate.beta === null && sample.rotationRate.gamma === null) {
    phoneInvalid++
    return
  }
  if (sample.t - lastPhoneReceipt > 3000) {
    if (Number.isFinite(lastPhoneReceipt)) sessions.push({ t: sample.t, action: `phone-receipt-gap-ms:${Math.round(sample.t-lastPhoneReceipt)}`, pace: pace() })
    el('phone-status').textContent = window.isSecureContext
      ? 'Receiving Android phone motion events. Check channel availability below.'
      : 'Motion events arrived from an insecure context; confirm values are available and stable.'
  }
  lastPhoneReceipt = sample.t
  phoneHistory.push(sample)
  if (phoneHistory.length > 5000) phoneHistory = phoneHistory.slice(-4000)
  if (recording) {
    phoneRecorded.push(sample)
    if (recorded.length + phoneRecorded.length >= 100000) { recording = false; status('Recording reached 100,000 total samples and stopped. Export before starting another recording.'); recordInfo() }
  }
}
let phoneListener: ((event: DeviceMotionEvent) => void) | undefined
async function enablePhoneMotion() {
  if (phoneMotionOn || closed) return
  const button = el<HTMLButtonElement>('phone-motion')
  button.disabled = true
  const secureNote = window.isSecureContext ? 'Secure context.' : 'This page is not a secure context; Android/WebView may withhold motion values.'
  try {
    const MotionEvent = DeviceMotionEvent as typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> }
    if (typeof MotionEvent === 'undefined') throw new Error('DeviceMotionEvent is unavailable in this WebView.')
    if (typeof MotionEvent.requestPermission === 'function') {
      const permission = await MotionEvent.requestPermission()
      if (permission !== 'granted') throw new Error(`Motion permission ${permission}.`)
    }
    phoneListener = receivePhone
    window.addEventListener('devicemotion', phoneListener)
    phoneMotionOn = true
    button.textContent = 'Disable phone motion'
    button.disabled = false
    el('phone-status').textContent = `${secureNote} Listener active; waiting for Android sensor fields.`
    sessions.push({ t: stamp(), action: `phone-motion-enabled;secure-context:${window.isSecureContext}`, pace: pace() })
  } catch (error) {
    button.disabled = false
    el('phone-status').textContent = `${secureNote} ${String(error)}`
  }
}
function disablePhoneMotion() {
  tracker.suspend(stamp(), 'Phone motion disabled by user.')
  if (phoneListener) window.removeEventListener('devicemotion', phoneListener)
  phoneListener = undefined
  phoneMotionOn = false
  const button = el<HTMLButtonElement>('phone-motion')
  button.textContent = 'Enable phone motion'
  button.disabled = closed
  el('phone-status').textContent = 'Phone motion listener stopped. Captured data is retained for export.'
  sessions.push({ t: stamp(), action: 'phone-motion-disabled', pace: pace() })
}
async function command(open: boolean) {
  if (!ready || busy || closed) return
  busy = true; controls()
  sessions.push({ t: stamp(), action: open ? 'start-request' : 'stop-request', pace: pace() })
  try {
    if (demo) {
      running = open
      window.clearInterval(previewTimer)
      if (open) previewTimer = window.setInterval(() => {
        const t=stamp()/1000; receive({ x:Math.sin(t)*12, y:Math.cos(t*.7)*6, z:1+Math.sin(t*2)*.2 })
      },100)
    } else {
      if (open) { running = true; startedAt = stamp() }
      const result = await Promise.race([
        bridge!.imuControl(open, pace()),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('IMU command timed out; host state is unknown. Try Stop IMU, then Start.')),8000)),
      ])
      if (!result) throw new Error('Host rejected IMU command. Confirm G2 connection and startup page support.')
      running = open
    }
    if (open) startedAt = stamp()
    status(open ? `IMU enabled (${demo ? 'synthetic' : 'live G2'}). Waiting for samples...` : 'IMU stopped. Recording data is still available for export.')
  } catch (error) { running = false; status(String(error)) }
  finally { busy = false; controls() }
}
el('start').onclick = () => { void command(true) }
el('stop').onclick = () => { void command(false) }
el('phone-motion').onclick = () => phoneMotionOn ? disablePhoneMotion() : void enablePhoneMotion()
el('record').onclick = () => { recording = !recording; if(recording) mark('recording-start'); recordInfo() }
el('mark').onclick = () => mark()
el('label').onchange = () => { if(recording) mark(label()) }
el('clear').onclick = () => {
  if (!window.confirm('Clear saved samples and markers? Export them first if needed.')) return
  recorded=[]; phoneRecorded=[]; marks=[]; sessions.length=0; recording=false; recordInfo()
}
el('baseline').onclick = () => {
  const recent=history.filter(s=>s.t>=stamp()-2000)
  if(recent.length<3){ status('Need at least three recent samples to capture a baseline.'); return }
  baseline={ x:summarize(recent,'x')?.mean??null, y:summarize(recent,'y')?.mean??null, z:summarize(recent,'z')?.mean??null }
  el('baseline-info').textContent='Captured two-second mean: '+JSON.stringify(baseline)+'. This changes the plot only; raw readings and exports stay unchanged.'
}
function exportData(format: 'json' | 'csv') {
  if(!recorded.length && !phoneRecorded.length && !(format === 'json' && (tracker.events.length || savedLockTest))){status('No recorded samples. Start one or both motion sources, then Start recording.');return}
  const content = format==='csv' ? combinedCsv(recorded,phoneRecorded) : JSON.stringify({ schemaVersion:2,
    sources:{ glasses:demo?'synthetic':'G2 SDK IMU', phone:'Android DeviceMotionEvent exposed by Even app WebView' },
    sdkVersion:'0.0.10', glassesUnits:'unknown', phoneUnits:'browser API: acceleration in m/s² when supplied; verify device/WebView implementation',
    glassesAxes:'SDK x/y/z; physical meaning unverified', phoneAxes:'DeviceMotionEvent device-relative x/y/z; orientation may differ from G2',
    timestamp:'Both t fields are monotonic milliseconds at WebView event receipt on one clock; wallTime is ISO UTC. They are receipt times, not sensor acquisition times.',
    secureContext:window.isSecureContext, baselineDisplayOnly:baseline, sessions, markers:marks, tripTracking:tracker.snapshot(),
    screenLockTest:lockTest.snapshot(Date.now()) ?? savedLockTest,
    glassesSamples:recorded, phoneMotionSamples:phoneRecorded },null,2)
  if(downloadUrl)URL.revokeObjectURL(downloadUrl)
  downloadUrl=URL.createObjectURL(new Blob([content],{type:format==='json'?'application/json':'text/csv'}))
  const filename=`motion-compare-${new Date().toISOString().replaceAll(':','-')}.${format}`
  preparedExport={ filename, content, mime:format==='json'?'application/json':'text/csv' }
  const link=el<HTMLAnchorElement>('download'); link.href=downloadUrl; link.download=filename
  el<HTMLTextAreaElement>('export-text').value=content
  el('export-actions').hidden=false
  exportStatus(`Prepared ${format.toUpperCase()} with ${recorded.length} G2 samples and ${phoneRecorded.length} phone events. Choose a save option below; nothing has been saved yet.`)
  el('export-actions').scrollIntoView({behavior:'smooth',block:'center'})
}
el('json').onclick=()=>exportData('json'); el('csv').onclick=()=>exportData('csv')

function exportStatus(message: string) { el('export-status').textContent=message }
el('save-laptop').onclick=async()=>{
  if(!preparedExport)return
  const button=el<HTMLButtonElement>('save-laptop'); button.disabled=true
  exportStatus('Saving to the laptop development server...')
  try {
    const response=await fetch('/__imu/recordings', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(preparedExport),signal:AbortSignal.timeout(20000)})
    if(!response.ok){
      const detail=await response.json().catch(()=>null) as { error?: string } | null
      throw new Error(`Server returned ${response.status}${detail?.error ? `: ${detail.error}` : ''}`)
    }
    const result=await response.json() as { saved?: string }
    if(!result.saved)throw new Error('No save confirmation returned')
    exportStatus(`Saved on laptop: ${result.saved}. The recording remains on this page too.`)
  }catch(error){exportStatus(`Laptop save was not confirmed (${String(error)}). Use the Vite dev-server URL, or try Share / Copy. A timed-out request may have saved; check the laptop recordings folder.`)}
  finally{button.disabled=false}
}
el('share-export').onclick=async()=>{
  if(!preparedExport)return
  try{
    const file=new File([preparedExport.content],preparedExport.filename,{type:preparedExport.mime})
    if(!navigator.canShare?.({files:[file]}) || !navigator.share){exportStatus('File sharing is unavailable in this WebView. Use Save to laptop or Copy export text.');return}
    await navigator.share({files:[file],title:'G2 IMU recording'})
    exportStatus('Share sheet completed. Check the destination you selected for the saved file.')
  }catch(error){exportStatus(error instanceof DOMException && error.name==='AbortError' ? 'Sharing cancelled. Export text is still available.' : `Sharing failed (${String(error)}). Use Save to laptop or Copy.`)}
}
el('copy-export').onclick=async()=>{
  if(!preparedExport)return
  const text=el<HTMLTextAreaElement>('export-text')
  text.focus(); text.select(); text.setSelectionRange(0,text.value.length)
  try{
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(preparedExport.content);exportStatus('Export copied. Paste it into a text file or Notes.');return}
    if(document.execCommand('copy')){exportStatus('Export copied. Paste it into a text file or Notes.');return}
  }catch{ /* Selection remains available when clipboard access is blocked. */ }
  exportStatus('Automatic copying is unavailable. Long-press the selected text, choose Copy, and paste it into a text file or Notes.')
}

let unsubscribe = () => {}, unsubscribeDevice = () => {}
function cleanup() {
  if(closed)return
  lockTest.event('app-exit', Date.now()); saveLockTest(true)
  closed=true; running=false; recording=false; window.clearInterval(previewTimer)
  glassesPlanner.dismiss()
  void speech.cancel()
  tracker.stop(stamp())
  if(phoneListener)window.removeEventListener('devicemotion',phoneListener)
  phoneListener=undefined;phoneMotionOn=false
  if(bridge)void bridge.imuControl(false,pace()).catch(console.error)
  unsubscribe(); unsubscribeDevice(); controls()
}
async function initialize() {
  if(demo){ready=true; controls(); status('Synthetic preview ready. Start IMU to exercise the dashboard.');return}
  const waiting=window.setTimeout(()=>status('Still waiting for the Even App bridge. Open this URL via the Even app QR flow. A normal browser has no G2 bridge. Use ?demo=1 only for synthetic preview.'),7000)
  bridge=await waitForEvenAppBridge(); window.clearTimeout(waiting)
  const panels = preparation.panels() ?? glassesView(tracker, stamp())
  const result=await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
    containerTotalNum:panels.length,textObject:panels.map(panel => new TextContainerProperty(panel)),
  }))
  if(result!==0)throw new Error(`Startup page failed (${result}); IMU was not enabled.`)
  glassLayout = glassesLayoutKey(panels)
  for (const panel of panels) glassContents.set(panel.containerID, panel.content)
  unsubscribe=bridge.onEvenHubEvent(event=>{
    if (event.audioEvent) { speech.sendPcm(event.audioEvent.audioPcm); return }
    const sys=event.sysEvent
    // Handle IMU before zero-value click normalization. An IMU envelope is never a tap.
    if(sys?.imuData){receive(sys.imuData);return}
    const sysType=sys ? sys.eventType??OsEventTypeList.CLICK_EVENT : null
    const textType=event.textEvent ? event.textEvent.eventType??OsEventTypeList.CLICK_EVENT : null
    if(sysType===OsEventTypeList.DOUBLE_CLICK_EVENT || textType===OsEventTypeList.DOUBLE_CLICK_EVENT){void bridge!.shutDownPageContainer(1).catch(console.error);return}
    if(sysType===OsEventTypeList.SYSTEM_EXIT_EVENT || sysType===OsEventTypeList.ABNORMAL_EXIT_EVENT){cleanup();return}
    if(sysType===OsEventTypeList.FOREGROUND_ENTER_EVENT){lockTest.event('host-foreground-enter', Date.now()); tracker.suspend(stamp(), 'App returned to foreground; rebuilding sensor evidence.');status('Returned to foreground. Check stream continuity; if stale, Stop IMU then Start.');return}
    if(sysType===OsEventTypeList.FOREGROUND_EXIT_EVENT){lockTest.event('host-foreground-exit', Date.now());saveLockTest(true);return}
    if (sysType === OsEventTypeList.SCROLL_TOP_EVENT || textType === OsEventTypeList.SCROLL_TOP_EVENT ||
      sysType === OsEventTypeList.SCROLL_BOTTOM_EVENT || textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      if (!lockTest.active && glassesPlanner.visible) glassesPlanner.scroll(sysType === OsEventTypeList.SCROLL_TOP_EVENT || textType === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1)
      return
    }
    if(sysType===OsEventTypeList.CLICK_EVENT || textType===OsEventTypeList.CLICK_EVENT){
      if (lockTest.active) { lockTest.tap(Date.now(), document.hidden); saveLockTest(true); refreshGlasses(); return }
      if (glassesPlanner.visible) { void glassesPlanner.tap(); return }
      if (speech.busy || speech.snapshot().micMayBeOn) {
        if (speech.phase === 'recording') void speech.stop()
        else if (speech.phase === 'error') void speech.cancel()
        return
      }
      if (!tripUI.tap()) mark('glasses tap: '+label())
      refreshGlasses()
    }
  })
  unsubscribeDevice=bridge.onDeviceStatusChanged(device=>{
    sessions.push({t:stamp(),action:`device:${device.connectType}`,pace:pace()})
    status(`Device status: ${device.connectType}. If samples stop, reconnect and use Stop/Start IMU.`)
  })
  ready=true; controls(); status('G2 page ready. Press Start IMU on the phone, then Start recording.')
}
function displayPhase() {
  if (lockTest.active) return `lock-test:${lockTest.report!.id}`
  if (glassesPlanner.visible) return `planning:${JSON.stringify(glassesPlanner.snapshot())}:${speech.phase}`
  if (speech.busy || speech.snapshot().micMayBeOn) return `speech:${speech.phase}`
  return `${tracker.state}:${tracker.stationIndex}:${tracker.brakingPhase}:${tracker.cooldownReason}`
}
function glassesDiagnostic() {
  const latest = history.at(-1)
  return `IMU ${running?'ON':'OFF'} ${recording?'REC':''}\n${axes.map(a=>`${a.toUpperCase()}: ${latest?.[a]?.toFixed(3)??'--'}`).join('  ')}`
}
function refreshGlasses() {
  if(!bridge || !ready || closed || renderBusy)return
  const now = stamp()
  const panels = lockTest.active ? lockTestGlasses(lockTest.report!, Date.now()) : preparation.panels() ??
    (speech.busy || speech.snapshot().micMayBeOn ? speechGlasses(speech.snapshot()) : glassesView(tracker, now, glassesDiagnostic()))
  const layout = glassesLayoutKey(panels)
  if(layout === glassLayout && panels.every(panel => glassContents.get(panel.containerID) === panel.content))return
  const phaseAtSend = displayPhase()
  renderBusy=true
  const update = async () => {
    if (layout !== glassLayout) {
      const ok = await bridge!.rebuildPageContainer(new RebuildPageContainer({
        containerTotalNum: panels.length, textObject: panels.map(p => new TextContainerProperty(p)),
      }))
      if (displayPhase() === phaseAtSend) lockTest.bridgeResult(ok, Date.now(), document.hidden)
      if (!ok) throw new Error('Glasses layout update failed; retrying on the next refresh.')
      glassLayout = layout
      glassContents.clear()
      for (const p of panels) glassContents.set(p.containerID, p.content)
      return
    }
    // Send the tap action/deadline first; extra framing updates must not delay it.
    const priority = ['trip-action', 'trip-station', 'trip-detail', 'trip-header', 'trip-progress']
    for (const panel of [...panels].sort((a, b) => priority.indexOf(a.containerName) - priority.indexOf(b.containerName))) {
      if (closed) return
      // Discard unsent content as soon as the tracker changes phase.
      if (displayPhase() !== phaseAtSend) return
      if (glassContents.get(panel.containerID) === panel.content) continue
      const ok = await bridge!.textContainerUpgrade(new TextContainerUpgrade({containerID:panel.containerID,containerName:panel.containerName,content:panel.content}))
      if (displayPhase() === phaseAtSend) lockTest.bridgeResult(ok, Date.now(), document.hidden)
      if (ok) glassContents.set(panel.containerID, panel.content)
    }
  }
  void update().catch(error => { if (displayPhase() === phaseAtSend) lockTest.bridgeResult(false, Date.now(), document.hidden); console.error(error) }).finally(()=>{
      renderBusy=false
      // A bridge write may finish after a phase transition. Send the current
      // phase immediately, rather than leaving the previous countdown visible.
      if (displayPhase() !== phaseAtSend) refreshGlasses()
    })
}
window.setInterval(()=>{
  const now=stamp()
  lockTest.heartbeat(Date.now(), document.hidden); saveLockTest()
  tracker.tick(now)
  if (!document.hidden) {
    tripUI.render(glassesDiagnostic())
    if (lockTest.active) el<HTMLButtonElement>('trip-arm').disabled = true
    renderPlot(history,baseline,el<HTMLInputElement>('center').checked,now)
    renderMotionComparison(history,phoneHistory,now)
    recordInfo(); renderLockTest(lockTest.snapshot(Date.now()) ?? savedLockTest, lockTest.active)
  }
  if(running && now-Math.max(lastReceipt,startedAt)>3000)status('No IMU samples for over 3 seconds. Check glasses connection/host support, then Stop IMU and Start again. No synthetic values are substituted.')
  if(phoneMotionOn && now-Math.max(lastPhoneReceipt,0)>3000 && lastPhoneReceipt===-Infinity)
    el('phone-status').textContent=`Listener active but no phone samples yet. Secure context: ${window.isSecureContext}. Check Android/WebView motion permission and non-null fields.`
  else if(phoneMotionOn && Number.isFinite(lastPhoneReceipt) && now-lastPhoneReceipt>3000)
    el('phone-status').textContent='Phone motion events paused for over 3 seconds. Check WebView foreground/permission; continuity is not assumed.'
  refreshGlasses()
},500)
window.addEventListener('beforeunload',cleanup)
document.addEventListener('visibilitychange', () => {
  lockTest.visibility(document.hidden, Date.now()); saveLockTest(true)
  if (document.hidden) tracker.suspend(stamp(), 'Page hidden; motion continuity is unknown.')
  if (document.hidden && speech.busy) void speech.cancel()
  if (document.hidden && glassesPlanner.visible && glassesPlanner.busy) void glassesPlanner.reset()
})
window.addEventListener('pagehide', () => { lockTest.event('pagehide', Date.now()); saveLockTest(true) })
void initialize().catch(error=>{status(String(error));controls()})
