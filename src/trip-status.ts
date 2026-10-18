import type { StationTracker } from './station-tracker.ts'
import { journeyPresentation } from './journey-view.ts'

const seconds = (ms: number) => `${Math.max(0, Math.ceil(ms / 1000))} s`

function instructionLines(instruction: string | null) {
  const lines: string[] = []
  let remaining = instruction ?? ''
  while (remaining && lines.length < 3) {
    if (remaining.length <= 32) { lines.push(remaining); break }
    const limit = lines.length === 2 ? 29 : 32
    const space = remaining.lastIndexOf(' ', limit)
    const cut = space > 0 ? space : limit
    lines.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut).trimStart()
    if (lines.length === 3) lines[2] += '...'
  }
  return lines
}

// Both screens use the same phase and deadline. ETA is never the input-block timer.
export function tripStatus(tracker: StationTracker, now: number) {
  const presentation = journeyPresentation(tracker)
  let status: string
  let timing: string
  switch (tracker.state) {
    case 'idle':
      status = 'Load a route to begin'; timing = 'Load route on phone'; break
    case 'ready':
      status = 'Ready'; timing = 'Single-tap glasses to START'; break
    case 'waiting-boarding':
      status = 'Transfer: tracking paused'; timing = 'Board next train, then tap to START'; break
    case 'waiting-departure':
      status = 'Waiting for departure'; timing = 'Travel timer waits for departure'; break
    case 'travelling':
      status = 'Arrival inputs blocked'
      timing = `Detection opens in ${seconds((tracker.watchAt ?? now) - now)}`; break
    case 'arrival-watch':
      status = tracker.brakingPhase === 'waiting for quiet dwell' ? 'waiting to stop' : tracker.brakingPhase
      timing = 'Arrival detection OPEN'; break
    case 'candidate':
      status = 'Arrival detected'
      timing = `Tap if not at ${presentation.current?.name ?? 'this station'}; ${seconds((tracker.candidateUntil ?? now) - now)} left`; break
    case 'cooldown':
      status = tracker.cooldownReason === 'Arrival vetoed' ? 'Station correction applied' : tracker.cooldownReason ?? 'Arrival detection paused'
      timing = `Detection paused: ${seconds(tracker.retryAfter - now)}`; break
    case 'complete':
      status = 'Destination reached'; timing = `Station ${tracker.stationIndex + 1}/${tracker.route.length}`; break
  }
  const current = presentation.current?.name ?? ''
  const heading = `${current.slice(0, 20)}${presentation.nextStop ? ` -> ${presentation.nextStop.name.slice(0, 20)}` : ''}`
  const sensor = tracker.sensing && now - tracker.lastValidAt > 1500 ? 'Phone motion unavailable. ' : ''
  const instruction = presentation.state === 'complete' ? 'Follow exit signs.'
    : presentation.canArm ? presentation.journey.boarding.train : tracker.currentInstruction
  // Keep the full instruction on the phone; limit the glasses to three short lines.
  return {
    presentation,
    status,
    instruction,
    timing: `${sensor}${timing}`,
    glassesText: tracker.state === 'idle' ? null : [heading, status, ...instructionLines(instruction), `${sensor}${timing}`].join('\n'),
  }
}
