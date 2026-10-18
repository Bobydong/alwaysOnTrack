import type { StationTracker } from './station-tracker.ts'
import { journeyPresentation } from './journey-view.ts'

export type GlassesPanel = {
  containerID: number; containerName: string; xPosition: number; yPosition: number
  width: number; height: number; borderWidth: number; borderColor: number
  borderRadius: number; paddingLength: number; isEventCapture: number; content: string
}

// Native font metrics are not exposed by the SDK. Keep this line-height estimate
// shared with the preview; hardware checks may require adjusting it.
export const glassesSpacing = { padding: 10, lineHeight: 28, margin: 8, verticalClearance: 12, horizontalClearance: 8 }
type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

let measurementContext: CanvasRenderingContext2D | null | undefined
function textWidth(line: string) {
  if (measurementContext === undefined) {
    measurementContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
    if (measurementContext) measurementContext.font = '21px Arial'
  }
  // Normalize digits so a ticking countdown does not move as digit widths change.
  const stable = line.replace(/\d/g, '0')
  if (measurementContext) return measurementContext.measureText(stable).width
  // Deterministic approximation for non-browser previews/tests. Native G2 glyph
  // widths are unavailable; canvas measurements also need checking on hardware.
  return [...stable].reduce((sum, c) => sum + (/\s/.test(c) ? 6 : /[ilI.,:;!'|]/.test(c) ? 6 : /[mwMW@%]/.test(c) ? 20 : /[A-Z]/.test(c) ? 15 : 12), 0)
}

function fitLines(text: string, columns: number, maxLines: number) {
  const lines = text.split('\n').flatMap(line => wrap(line, columns, 30).split('\n'))
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = kept[maxLines - 1].slice(0, columns - 3).trimEnd() + '...'
  return kept
}

// Anchor the text block to an outer edge, rather than anchoring the top-left
// corner of a large fixed region. Keep extra space for native font differences.
function corner(id: number, name: string, anchor: Corner, content: string, maxLines?: number): GlassesPanel {
  const top = anchor.startsWith('top'), right = anchor.endsWith('right')
  const progress = name === 'trip-progress'
  const { padding, lineHeight, margin, verticalClearance, horizontalClearance } = glassesSpacing
  const lines = fitLines(content, progress ? 11 : 21, maxLines ?? (progress ? 1 : top ? 3 : 2))
  const height = lines.length * lineHeight + 2 * padding + verticalClearance
  const width = right ? Math.min(264, Math.ceil(Math.max(...lines.map(textWidth))) + 2 * padding + horizontalClearance) : 264
  return { containerID: id, containerName: name,
    xPosition: right ? 576 - margin - width : margin, yPosition: top ? margin : 288 - margin - height,
    width, height,
    borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: glassesSpacing.padding, isEventCapture: 0,
    content: lines.join('\n') }
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
  const input: GlassesPanel = { containerID: 6, containerName: 'trip-input', xPosition: 0, yPosition: 0,
    width: 576, height: 288, borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: 0, isEventCapture: 1, content: ' ' }
  return [input, ...journeyPanels(tracker, now, diagnostic)]
}

function journeyPanels(tracker: StationTracker, now: number, diagnostic: string): GlassesPanel[] {
  const display = journeyPresentation(tracker), journey = display.journey
  const correction = `${fitLines(`TAP IF NOT AT ${display.current?.name ?? 'this station'}`, 21, 2).join('\n')}\n${seconds((tracker.candidateUntil ?? now) - now)} left`
  if (tracker.state === 'idle') return [
    corner(1, 'trip-station', 'top-left', `GLASSES IMU\n${diagnostic}`),
    corner(3, 'trip-detail', 'top-right', 'Plan a journey on your phone.'),
    corner(4, 'trip-action', 'bottom-right', 'TAP: MARK RECORDING'),
  ]
  if (display.canArm) return [
    corner(1, 'trip-station', 'top-left', `BOARD AT\n${journey.boarding.station}`),
    corner(3, 'trip-detail', 'top-right', journey.boarding.train),
    corner(4, 'trip-action', display.pending ? 'bottom-left' : 'bottom-right', display.pending ? correction : 'TAP ONCE ABOARD', display.pending ? 3 : 2),
  ]
  if (display.state === 'complete') return [
    corner(1, 'trip-station', 'top-left', `YOU HAVE ARRIVED\n${display.current?.name ?? ''}`),
    corner(3, 'trip-detail', 'top-right', 'Follow exit signs.'),
    ...(display.pending ? [corner(4, 'trip-action', 'bottom-left', correction, 3)] : []),
  ]
  let action = ''
  switch (tracker.state) {
    case 'waiting-departure': action = 'WAITING FOR DEPARTURE'; break
    case 'travelling': action = `DETECTION OPENS IN ${seconds((tracker.watchAt ?? now) - now)}`; break
    case 'arrival-watch':
      action = tracker.brakingPhase === 'waiting for jolt' ? 'WAITING FOR JOLT'
        : tracker.brakingPhase === 'allowing motion to settle' ? 'MOTION SETTLING' : 'WAITING TO STOP'; break
    case 'candidate': action = correction; break
    case 'cooldown': action = `${tracker.cooldownReason === 'Arrival vetoed' ? 'RESET / ' : ''}RETRY IN ${seconds(tracker.retryAfter - now)}`; break
  }
  if (!display.pending && tracker.sensing && now - tracker.lastValidAt > 1500) action = 'WAITING FOR PHONE MOTION'
  const station = display.nextStop?.name ?? journey.destination
  return [
    corner(1, 'trip-station', 'top-left', `NEXT STATION\n${station}`),
    corner(3, 'trip-detail', 'top-right', `GET OFF AT\n${journey.destination}`),
    corner(4, 'trip-action', 'bottom-left', action, display.pending ? 3 : 2),
    corner(5, 'trip-progress', 'bottom-right', `STOP ${journey.stopNumber}/${journey.stopTotal}`),
  ]
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
