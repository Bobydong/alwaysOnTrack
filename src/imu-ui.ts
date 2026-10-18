import { axes, summarize, timing, vectorMagnitude, type PhoneMotionSample, type Sample, type Vector } from './imu-data'

export function mountDiagnostic() {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <main><header><small>ALWAYSONTRACK / HARDWARE LAB</small><h1>G2 IMU explorer</h1>
    <p>Raw sensor values. Axis meaning and units are unverified.</p></header>
    <p id="status" role="status">Waiting for Even App bridge. Open through the Even app QR flow.</p>
    <section id="trip-panel"></section>
    <section class="controls"><button id="start" disabled>Start IMU</button><button id="stop" disabled>Stop IMU</button>
    <label>Protocol pace <select id="pace">${Array.from({length:10}, (_, i) => `<option value="${(i+1)*100}">P${(i+1)*100}</option>`).join('')}</select></label></section>
    <p class="hint">P100-P1000 are SDK pacing codes; measured receipt rate appears below. They are not labeled as Hz.</p>
    <section class="readouts" id="readouts"></section>
    <section><div class="controls"><label><input type="checkbox" id="center"> Subtract captured baseline (display only)</label>
    <button id="baseline">Capture baseline</button></div>
    <p class="hint" id="baseline-info">Baseline not captured. Hold still for a few seconds, then capture.</p>
    <canvas id="plot" aria-label="Last 15 seconds of X, Y and Z raw sensor values"></canvas>
    <p class="hint" id="scale">Shared vertical scale; automatic range. X red / Y green / Z blue.</p>
    <p id="timing">No samples yet.</p><p class="hint">Receipt timestamps measure delivery to the WebView, not the physical sensor clock. Gaps can mean delayed delivery or suspension.</p></section>
    <section><h2>Android phone motion</h2>
    <p class="hint">The phone's browser motion API may expose gravity-removed acceleration, acceleration including gravity, and rotation rate. Blank fields mean the WebView did not provide that channel.</p>
    <div class="controls"><button id="phone-motion">Enable phone motion</button><span id="phone-status">Not enabled.</span></div>
    <div class="readouts" id="phone-readouts"></div>
    <canvas id="compare-plot" aria-label="Phone and glasses motion magnitudes on a shared receipt-time axis"></canvas>
    <p class="hint" id="compare-scale">Phone acceleration magnitude (violet), phone acceleration including gravity (yellow), G2 vector magnitude (white). This chart compares sizes, not aligned directions.</p>
    <p class="hint">Motion events require a secure context in many WebViews. If enabled but every channel is blank, check HTTPS/localhost support. Phone samples stop when the WebView stops receiving events; foreground tests do not prove lock-screen continuity.</p></section>
    <section id="lock-test-panel"></section>
    <section><h2>Record a movement</h2><div class="controls">
    <label>Label <select id="label"><option>still</option><option>phone only: handle/bag movement</option><option>glasses only: turn head</option><option>shared: seated jolt and lean</option><option>shared: departure lean</option><option>shared: braking lean</option><option>turn head left/right</option><option>nod up/down</option><option>tilt ear to shoulder</option><option>translate forward/back</option><option>translate left/right</option><option>translate up/down</option><option>train departure</option><option>train cruising</option><option>train braking</option><option>station dwell</option><option>tunnel stop</option></select></label>
    <button id="mark">Add marker</button><button id="record">Start recording</button></div>
    <p id="record-info">Not recording. Samples are held in memory; export before closing or reloading.</p>
    <div class="controls"><button id="json">Export JSON</button><button id="csv">Export CSV</button><button id="clear">Clear recording</button></div>
    <div id="export-actions" hidden><p id="export-status" role="status"></p>
    <div class="controls"><button id="save-laptop">Save to laptop</button><button id="share-export">Share / Save to Files</button><button id="copy-export">Copy export text</button><a id="download">Try download</a></div>
    <p class="hint">Save to laptop works through the Vite development server. Sharing depends on phone/WebView support. If neither works, select and copy the text below. Creating an export does not confirm a file was saved.</p>
    <textarea id="export-text" readonly aria-label="Export text: select all and copy"></textarea></div></section>
    <section><h2>Identify the signal</h2><ol>
    <li>Record 10 seconds still, facing forward.</li><li>Turn left, hold, return; repeat right. Mark each change.</li>
    <li>Nod and hold, then tilt one ear toward a shoulder. Compare which axes change and whether values stay changed.</li>
    <li>Keep the glasses level and translate them forward/back, sideways and vertically; stop between motions. Moving them by hand can help separate translation from head rotation.</li>
    <li>Repeat facing sideways. Do not assign a permanent train-forward axis from one pose.</li></ol>
    <p>Held changes during rotation may indicate orientation or gravity-sensitive acceleration. Brief translation spikes may support an acceleration hypothesis. Neither proves units or semantics; record evidence before naming axes or converting to g / m/s².</p>
    <p>Tap glasses to add a marker. Double-tap opens system exit. The microphone is used only when you start a spoken trip request.</p>
    <ol><li>Enable phone motion; start G2 IMU; start one recording.</li><li>Record phone-only movement, then glasses/head-only movement.</li><li>Secure the phone in a pocket or bag and record several shared simulated departure/braking leans, with a few seconds still between each.</li><li>Export JSON. Compare phone linear acceleration, phone rotation, and G2 changes at the same receipt times.</li></ol>
    <p id="mode"></p></section></main>`
  const style = document.createElement('style')
  style.textContent = `:root{color-scheme:dark;font:15px/1.5 system-ui;background:#111820;color:#e3edf5}*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:auto;padding:22px}h1{font-size:30px;margin:6px 0}h2{font-size:18px}small,.hint{color:#9eafbe}.hint{font-size:13px}section{background:#19232e;border:1px solid #304252;border-radius:12px;padding:16px;margin:16px 0}.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap}button,select{font:inherit;background:#283a4b;color:#fff;border:1px solid #52687b;border-radius:7px;padding:10px}button{cursor:pointer}button:disabled{opacity:.4;cursor:default}label{display:flex;gap:8px;align-items:center}#status{padding:12px;border-left:4px solid #78dcba;background:#1d3035;white-space:pre-wrap}.readouts{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.axis{min-width:0}.value{font-size:24px;font-variant-numeric:tabular-nums}.axis p{margin:4px 0;font-size:12px}canvas{width:100%;height:290px;display:block;margin-top:16px}textarea{width:100%;height:150px;margin-top:12px}a{color:#80c7ff}button:focus-visible,select:focus-visible{outline:3px solid #80c7ff}@media(max-width:520px){main{padding:12px}.readouts{gap:5px;padding:10px}.value{font-size:19px}}`
  document.head.append(style)
}

export const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T
export const colors = ['#ff8c92', '#78e0a8', '#80baff']
const fmt = (n: number | null | undefined) => n == null ? '--' : n.toFixed(4)

export function renderPlot(samples: Sample[], baseline: Vector, centered: boolean, now: number) {
  const recent = samples.filter(s => s.t >= now - 15000)
  el('readouts').innerHTML = axes.map((axis, i) => {
    const stats = summarize(recent, axis)
    return `<div class="axis" style="color:${colors[i]}"><b>${axis.toUpperCase()} raw</b><div class="value">${fmt(recent.at(-1)?.[axis])}</div><p>min ${fmt(stats?.min)}<br>max ${fmt(stats?.max)}<br>mean ${fmt(stats?.mean)}<br>SD ${fmt(stats?.sd)}<br>present ${stats?.n ?? 0}</p></div>`
  }).join('')
  const rate = timing(recent)
  el('timing').textContent = rate ? `Last 15 s: ${rate.hz.toFixed(1)} received samples/s | largest interval ${rate.largestGap.toFixed(0)} ms` : 'Waiting for enough samples to measure rate.'
  const canvas = el<HTMLCanvasElement>('plot')
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = 290 * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  const w = canvas.clientWidth, h = 290, top = 22, bottom = h - 24
  const value = (s: Sample, a: typeof axes[number]) => s[a] === null ? null : s[a]! - (centered ? baseline[a] ?? 0 : 0)
  const values = recent.flatMap(s => axes.map(a => value(s,a))).filter((v): v is number => v !== null)
  let low = Math.min(0, ...values), high = Math.max(0, ...values)
  const pad = Math.max((high-low)*.1, .001); low -= pad; high += pad
  const y = (v: number) => bottom - (v-low)/(high-low)*(bottom-top)
  ctx.font = '11px system-ui'; ctx.fillStyle = '#a8b8c6'
  for (let i=0; i<=4; i++) { const v = low+(high-low)*i/4; ctx.strokeStyle = '#304252'; ctx.beginPath(); ctx.moveTo(60,y(v)); ctx.lineTo(w,y(v)); ctx.stroke(); ctx.fillText(v.toFixed(3),0,y(v)+4) }
  axes.forEach((a,i) => { ctx.strokeStyle=colors[i]; ctx.lineWidth=2; ctx.beginPath(); let pen=false
    recent.forEach((s,index) => { const v=value(s,a); if(v===null){pen=false;return}
      const x=60+(s.t-(now-15000))/15000*(w-65)
      if(!pen || (index>0 && s.t-recent[index-1].t>1000))ctx.moveTo(x,y(v)); else ctx.lineTo(x,y(v)); pen=true
    }); ctx.stroke() })
  ctx.fillStyle='#a8b8c6'; ctx.fillText('-15 seconds',60,h-3); ctx.fillText('now',w-30,h-3)
  el('scale').textContent = `${centered ? 'Baseline-subtracted display' : 'Raw display'} | shared auto range ${low.toFixed(3)} to ${high.toFixed(3)} | X red / Y green / Z blue. Raw exports never change.`
}

export function renderMotionComparison(glasses: Sample[], phone: PhoneMotionSample[], now: number) {
  const recentG2 = glasses.filter(s => s.t >= now - 15000)
  const recentPhone = phone.filter(s => s.t >= now - 15000)
  const magnitudeStats = (values: Array<number | null>) => {
    const valid = values.filter((v): v is number => v !== null)
    if (!valid.length) return null
    return { n: valid.length, max: Math.max(...valid), mean: valid.reduce((a,b) => a+b,0) / valid.length }
  }
  const g2 = magnitudeStats(recentG2.map(s => vectorMagnitude(s)))
  const linear = magnitudeStats(recentPhone.map(s => vectorMagnitude(s.acceleration)))
  const incl = magnitudeStats(recentPhone.map(s => vectorMagnitude(s.accelerationIncludingGravity)))
  const rotations = recentPhone.flatMap(s => [s.rotationRate.alpha, s.rotationRate.beta, s.rotationRate.gamma]).filter((v): v is number => v !== null)
  const elReadout = el('phone-readouts')
  const stat = (name: string, latest: number | null, data: { n: number; max: number; mean: number } | null, unit: string) =>
    `<div class="axis"><b>${name}</b><p>current ${latest === null ? '--' : `${latest.toFixed(3)} ${unit}`}<br>15 s mean ${data ? `${data.mean.toFixed(3)} ${unit}` : '--'}<br>max ${data ? `${data.max.toFixed(3)} ${unit}` : '--'}<br>samples ${data?.n ?? 0}</p></div>`
  elReadout.innerHTML = stat('G2 vector magnitude',vectorMagnitude(recentG2.at(-1) ?? {x:null,y:null,z:null}),g2,'SDK units') +
    stat('Phone acceleration (gravity removed)',vectorMagnitude(recentPhone.at(-1)?.acceleration ?? {x:null,y:null,z:null}),linear,'m/s²*') +
    stat('Phone acceleration (includes gravity)',vectorMagnitude(recentPhone.at(-1)?.accelerationIncludingGravity ?? {x:null,y:null,z:null}),incl,'m/s²*')
  const canvas=el<HTMLCanvasElement>('compare-plot'), dpr=window.devicePixelRatio||1
  canvas.width=Math.round(canvas.clientWidth*dpr); canvas.height=250*dpr
  const ctx=canvas.getContext('2d')!;ctx.scale(dpr,dpr)
  const w=canvas.clientWidth,h=250,left=58,right=w-8,top=16,bottom=h-28
  const tracks=[
    {name:'G2 |x,y,z|',color:'#f2f3f5',points:recentG2.map(s=>({t:s.t,v:vectorMagnitude(s)}))},
    {name:'Phone linear',color:'#cf8bff',points:recentPhone.map(s=>({t:s.t,v:vectorMagnitude(s.acceleration)}))},
    {name:'Phone incl. gravity',color:'#ffdb70',points:recentPhone.map(s=>({t:s.t,v:vectorMagnitude(s.accelerationIncludingGravity)}))},
  ]
  const all=tracks.flatMap(t=>t.points.map(p=>p.v)).filter((v):v is number=>v!==null)
  let low=all.length?Math.min(0,...all):0,high=all.length?Math.max(...all):1
  const pad=Math.max((high-low)*.12,.1);low-=pad;high+=pad
  const px=(t:number)=>left+(t-(now-15000))/15000*(right-left)
  const py=(v:number)=>bottom-(v-low)/(high-low)*(bottom-top)
  ctx.font='11px system-ui';ctx.fillStyle='#a8b8c6'
  for(let i=0;i<=4;i++){const v=low+(high-low)*i/4;ctx.strokeStyle='#304252';ctx.beginPath();ctx.moveTo(left,py(v));ctx.lineTo(right,py(v));ctx.stroke();ctx.fillText(v.toFixed(2),0,py(v)+4)}
  for(const track of tracks){ctx.strokeStyle=track.color;ctx.lineWidth=2;ctx.beginPath();let pen=false,lastT=0
    for(const p of track.points){if(p.v===null){pen=false;continue}if(!pen||p.t-lastT>1000)ctx.moveTo(px(p.t),py(p.v));else ctx.lineTo(px(p.t),py(p.v));pen=true;lastT=p.t}ctx.stroke()
    ctx.fillStyle=track.color;ctx.fillText(track.name,Math.max(left,Math.min(right-100,px(track.points.at(-1)?.t??now)+4)),top+12*tracks.indexOf(track))
  }
  ctx.fillStyle='#a8b8c6';ctx.fillText('-15 seconds',left,h-4);ctx.fillText('now',right-24,h-4)
  el('compare-scale').textContent=`Shared magnitude scale ${low.toFixed(2)} to ${high.toFixed(2)}. Receipt times share one WebView clock; sensor acquisition time/latency is not available. *Phone units are specified by the browser API when supplied. Rotation samples present: ${rotations.length}.`
}
