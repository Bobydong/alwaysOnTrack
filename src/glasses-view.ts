import type { StationTracker } from './station-tracker.ts'
import { journeyPresentation } from './journey-view.ts'
import { pixelIcon, type PixelArt, type PixelIcon } from './glasses-art.ts'

export type GlassesPanel = {
  containerID: number; containerName: string; xPosition: number; yPosition: number
  width: number; height: number; borderWidth: number; borderColor: number
  borderRadius: number; paddingLength: number; isEventCapture: number; content: string
  graphic?: PixelArt
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
export const glassesLayoutKey = (panels: GlassesPanel[]) => JSON.stringify(panels.map(({ content: _content, graphic, ...geometry }) => ({ ...geometry, image: !!graphic })))
export const panelSignature = (panel: GlassesPanel) => panel.graphic ? JSON.stringify(panel.graphic) : panel.content
export function withPixelIcon(panels: GlassesPanel[], kind: PixelIcon): GlassesPanel[] {
  const title = panels.find(p => p.containerID === 1)
  if (!title) return panels
  const graphic = pixelIcon(kind)
  const icon: GlassesPanel = { containerID: 9, containerName: 'state-icon', xPosition: 16,
    yPosition: title.yPosition + title.paddingLength + 2, width: 24, height: 24,
    borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: 0, isEventCapture: 0, content: `${kind} icon`, graphic }
  return [...panels.map(p => {
    if (p !== title) return p
    const lines = p.width <= 264 ? fitLines(p.content, 17, 3) : p.content.split('\n')
    return { ...p, content: lines.join('\n'), xPosition: 44, width: p.width - 36,
      height: p.width <= 264 ? lines.length * glassesSpacing.lineHeight + p.paddingLength * 2 + glassesSpacing.verticalClearance : p.height }
  }), icon]
}
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
  const panels = [input, ...journeyPanels(tracker, now, diagnostic)]
  const display = journeyPresentation(tracker)
  return display.canArm ? withPixelIcon(panels, display.state === 'waiting-boarding' ? 'transfer' : 'train')
    : display.state === 'complete' ? withPixelIcon(panels, 'exit') : panels
}

export function stopRail(tracker: StationTracker) {
  const display = journeyPresentation(tracker), journey = display.journey
  const remaining = Math.max(0, journey.stopTotal - journey.stopNumber), end = display.stationIndex + remaining
  return { remaining, hidden: remaining > 2, endIndex: end, currentIndex: display.stationIndex,
    last: journey.stopNumber === 0 ? journey.boarding.station : display.current?.name ?? '',
    next: display.nextStop?.name ?? journey.destination,
    destination: journey.destination, transfer: journey.transfer }
}

function railText(id: number, name: string, y: number, content: string, height = 36): GlassesPanel {
  const maxWidth = 244, padding = 4, safety = 2
  const fitted = content.split('\n').map(line => {
    if (textWidth(line) <= maxWidth - padding * 2 - safety) return line
    let cut = line
    while (cut && textWidth(cut + '...') > maxWidth - padding * 2 - safety) cut = cut.slice(0, -1)
    return cut.trimEnd() + '...'
  }).join('\n')
  const width = Math.max(20, Math.min(maxWidth, Math.ceil(Math.max(...fitted.split('\n').map(textWidth))) + padding * 2 + safety))
  return { containerID: id, containerName: name, xPosition: 548 - width, yPosition: y, width, height,
    borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: padding, isEventCapture: 0, content: fitted }
}

function railPanels(tracker: StationTracker, action: string, pending: boolean): GlassesPanel[] {
  const rail = stopRail(tracker)
  const nextIsEnd = rail.remaining <= 1
  const panels = [
    railText(2, 'trip-last', 8, `LAST: ${rail.last}`),
    railText(1, 'trip-station', nextIsEnd ? 156 : 48,
      nextIsEnd ? rail.transfer ? 'NEXT / TRANSFER' : 'NEXT / GET OFF' : 'NEXT STATION'),
    railText(7, 'trip-next-name', nextIsEnd ? 192 : 84, rail.next),
    ...(!nextIsEnd ? [railText(3, 'trip-detail', 156, rail.transfer ? 'TRANSFER AT' : 'GET OFF AT'),
      railText(8, 'trip-end-name', 192, rail.destination)] : []),
    railText(5, 'trip-progress', 244, `${rail.remaining} ${rail.remaining === 1 ? 'STOP' : 'STOPS'} LEFT`),
    corner(4, 'trip-action', 'bottom-left', action, pending ? 3 : 2),
  ]
  // Two small image tiles obey the SDK's 144-pixel maximum image height.
  const rects: PixelArt['rects'] = [], positions = [18, ...(!nextIsEnd ? [72] : []), 188]
  for (let y = positions[0]; y < 188; y++) {
    if (rail.hidden && y > 80 && y < 180 && y % 10 >= 3) continue
    rects.push([9, y, 2, 1, 136])
  }
  for (const [i, y] of positions.entries()) {
    rects.push([3, y - 6, 14, 13, 0])
    rects.push([6, y - 5, 8, 2, 255], [4, y - 3, 2, 6, 255], [14, y - 3, 2, 6, 255], [6, y + 3, 8, 2, 255])
    if (i === 0) rects.push([6, y - 3, 8, 6, 255])
  }
  for (let tile = 0; tile < 2; tile++) panels.push({ containerID: 10 + tile, containerName: `stop-rail-${tile}`,
    xPosition: 548, yPosition: 8 + tile * 112, width: 20, height: 112,
    borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: 0, isEventCapture: 0,
    content: tile === 0 ? 'Last stop and next stop rail' : rail.hidden ? 'Additional stops before ride endpoint' : 'Ride endpoint rail',
    graphic: { width: 20, height: 112, rects: rects.map(([x, y, w, h, shade]) => [x, y - tile * 112, w, h, shade]) },
  })
  return panels
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
  return railPanels(tracker, action, display.pending)
}

export function renderGlassesPreview(svg: SVGSVGElement, panels: GlassesPanel[]) {
  const ns = 'http://www.w3.org/2000/svg'
  svg.replaceChildren()
  const background = document.createElementNS(ns, 'rect')
  background.setAttribute('width', '576'); background.setAttribute('height', '288'); background.setAttribute('fill', '#030b06'); svg.append(background)
  for (const p of panels) {
    if (p.graphic) {
      const group = document.createElementNS(ns, 'g'); group.setAttribute('shape-rendering', 'crispEdges')
      for (const [x, y, w, h, shade] of p.graphic.rects) {
        const top = Math.max(0, y), bottom = Math.min(p.height, y + h)
        if (top >= bottom) continue
        const rect = document.createElementNS(ns, 'rect')
        for (const [key, value] of Object.entries({ x: p.xPosition + x, y: p.yPosition + top, width: w, height: bottom - top,
          fill: shade ? '#8fffb1' : '#030b06', 'fill-opacity': shade ? shade / 255 : 1 })) rect.setAttribute(key, String(value))
        group.append(rect)
      }
      svg.append(group); continue
    }
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
