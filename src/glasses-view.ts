import type { StationTracker } from './station-tracker.ts'
import { journeyView } from './journey-view.ts'

export type GlassesPanel = {
  containerID: number; containerName: string; xPosition: number; yPosition: number
  width: number; height: number; borderWidth: number; borderColor: number
  borderRadius: number; paddingLength: number; isEventCapture: number; content: string
}

// Native font metrics are not exposed by the SDK. Keep this line-height estimate
// shared with the preview; hardware checks may require adjusting it.
export const glassesSpacing = { padding: 10, lineHeight: 24, gap: 8, margin: 8 }
type PanelSpec = { id: number; name: string; content: string; framed?: boolean; x?: number; width?: number; columns?: number; maxLines: number }

function fitLines(text: string, columns: number, maxLines: number) {
  const lines = text.split('\n').flatMap(line => wrap(line, columns, 30).split('\n'))
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = kept[maxLines - 1].slice(0, columns - 3).trimEnd() + '...'
  return kept
}

// Pack boxes vertically using wrapped content plus equal padding on every side.
// Reserve space for station, status and count first; shorten supporting details
// when a long instruction would otherwise extend beyond the physical canvas.
function stack(specs: PanelSpec[]): GlassesPanel[] {
  const { padding, lineHeight, gap, margin } = glassesSpacing
  const lines = specs.map(s => fitLines(s.content, s.columns ?? 21, s.maxLines))
  const availableLines = Math.floor((288 - 2 * margin - (specs.length - 1) * gap - specs.length * padding * 2) / lineHeight)
  const detail = specs.findIndex(s => s.name === 'trip-detail')
  const excess = lines.reduce((total, value) => total + value.length, 0) - availableLines
  if (excess > 0 && detail >= 0) {
    lines[detail] = fitLines(specs[detail].content, specs[detail].columns ?? 21, Math.max(1, lines[detail].length - excess))
  }
  let y = margin
  return specs.map((s, i) => {
    const height = lines[i].length * lineHeight + padding * 2
    const p: GlassesPanel = { containerID: s.id, containerName: s.name, xPosition: s.x ?? 300, yPosition: y,
      width: s.width ?? 264, height, borderWidth: s.framed ? 1 : 0, borderColor: s.framed ? 15 : 0,
      borderRadius: s.framed ? 8 : 0, paddingLength: padding, isEventCapture: 0, content: lines[i].join('\n') }
    y += height + gap
    return p
  })
}
export const glassesLayoutKey = (panels: GlassesPanel[]) => JSON.stringify(panels.map(({ content: _content, ...geometry }) => geometry))
const seconds = (ms: number) => `${Math.max(0, Math.ceil(ms / 1000))}s`
function wrap(text: string, width: number, maxLines: number) {
  const lines: string[] = []
  let remaining = text.replace(/\s+/g, ' ').trim()
  while (remaining && lines.length < maxLines) {
    if (remaining.length <= width) { lines.push(remaining); break }
    const limit = lines.length === maxLines - 1 ? width - 3 : width
    const space = remaining.lastIndexOf(' ', limit), cut = space > 0 ? space : limit
    lines.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut).trimStart()
    if (lines.length === maxLines) lines[lines.length - 1] += '...'
  }
  return lines.join('\n')
}

export function glassesView(tracker: StationTracker, now: number, diagnostic = 'IMU explorer\nLoad a route on your phone'): GlassesPanel[] {
  // Firmware can scroll an overflowing event-capture text container. Capture
  // gestures in an empty layer instead, keeping every visible label static.
  const input: GlassesPanel = { containerID: 6, containerName: 'trip-input', xPosition: 300, yPosition: 0,
    width: 264, height: 288, borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: 0, isEventCapture: 1, content: ' ' }
  return [input, ...journeyPanels(tracker, now, diagnostic)]
}

function journeyPanels(tracker: StationTracker, now: number, diagnostic: string): GlassesPanel[] {
  const journey = journeyView(tracker)
  if (tracker.state === 'idle') return stack([
    { id: 1, name: 'trip-station', content: `GLASSES IMU\n${diagnostic}`, maxLines: 3, framed: true },
    { id: 3, name: 'trip-detail', content: 'Plan a journey on your phone.', maxLines: 4 },
    { id: 4, name: 'trip-action', content: 'TAP: MARK RECORDING', maxLines: 1 },
  ])
  if (tracker.canArm) return stack([
    { id: 1, name: 'trip-station', content: `BOARD AT\n${journey.boarding.station}`, maxLines: 3, framed: true },
    { id: 3, name: 'trip-detail', content: journey.boarding.train, maxLines: 5, framed: true },
    { id: 4, name: 'trip-action', content: 'TAP ONCE ABOARD', maxLines: 1, framed: true },
  ])
  if (tracker.state === 'complete') return stack([
    { id: 1, name: 'trip-station', content: `YOU HAVE ARRIVED\n${tracker.route[tracker.stationIndex]?.name ?? ''}`, maxLines: 4, framed: true },
    { id: 3, name: 'trip-detail', content: 'Follow exit signs.', maxLines: 1 },
  ])
  let action = ''
  switch (tracker.state) {
    case 'waiting-departure': action = 'WAITING FOR DEPARTURE'; break
    case 'travelling': action = `DETECTION OPENS IN ${seconds((tracker.watchAt ?? now) - now)}`; break
    case 'arrival-watch':
      action = tracker.brakingPhase === 'waiting for jolt' ? 'WAITING FOR JOLT'
        : tracker.brakingPhase === 'allowing motion to settle' ? 'MOTION SETTLING' : 'WAITING FOR QUIET'; break
    case 'candidate': action = `TAP TO VETO / ${seconds((tracker.candidateUntil ?? now) - now)}`; break
    case 'cooldown': action = `${tracker.cooldownReason === 'Arrival vetoed' ? 'VETOED / ' : ''}RETRY IN ${seconds(tracker.retryAfter - now)}`; break
  }
  if (tracker.sensing && now - tracker.lastValidAt > 1500) action = 'WAITING FOR PHONE MOTION'
  const station = tracker.nextStop?.name ?? journey.destination
  const title = journey.approaching ? 'GET OFF AT' : tracker.state === 'candidate' ? 'CONFIRM ARRIVAL' : 'NEXT STATION'
  const detail = journey.approaching ? journey.instruction
    : `${journey.transfer ? 'TRANSFER AT' : 'GET OFF AT'}\n${journey.destination}`
  return stack([
    { id: 1, name: 'trip-station', content: `${title}\n${station}`, maxLines: 3, framed: true },
    { id: 3, name: 'trip-detail', content: detail, maxLines: journey.approaching ? 5 : 3 },
    { id: 4, name: 'trip-action', content: action, maxLines: 2, x: 324, width: 240, columns: 20 },
    { id: 5, name: 'trip-progress', content: `STOP ${journey.stopNumber}/${journey.stopTotal}`, maxLines: 1, x: 428, width: 136, columns: 10 },
  ])
}

export function renderGlassesPreview(svg: SVGSVGElement, panels: GlassesPanel[]) {
  const ns = 'http://www.w3.org/2000/svg'
  svg.replaceChildren()
  const background = document.createElementNS(ns, 'rect')
  background.setAttribute('width', '576'); background.setAttribute('height', '288'); background.setAttribute('fill', '#030b06'); svg.append(background)
  for (const p of panels) {
    if (p.borderWidth) {
      const frame = document.createElementNS(ns, 'rect')
      for (const [key, value] of Object.entries({ x: p.xPosition, y: p.yPosition, width: p.width, height: p.height,
        rx: p.borderRadius, fill: 'none', stroke: '#8fffb1', 'stroke-width': p.borderWidth })) frame.setAttribute(key, String(value))
      svg.append(frame)
    }
    p.content.split('\n').forEach((line, i) => {
      const text = document.createElementNS(ns, 'text')
      text.setAttribute('x', String(p.xPosition + p.paddingLength))
      text.setAttribute('y', String(p.yPosition + p.paddingLength + 20 + i * glassesSpacing.lineHeight))
      text.setAttribute('fill', '#8fffb1'); text.setAttribute('font-size', '21'); text.setAttribute('font-family', 'Arial, sans-serif')
      text.textContent = line; svg.append(text)
    })
  }
}
