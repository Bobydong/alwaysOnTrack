import type { StationTracker } from './station-tracker.ts'
import type { PlanningSnapshot } from './glasses-planner.ts'
import type { SpeechSnapshot } from './asr/stt.ts'
import { tripStatus } from './trip-status.ts'

export function mobileJourney(tracker: StationTracker, planning: PlanningSnapshot, speech: SpeechSnapshot, now: number) {
  const trip = tripStatus(tracker, now), p = trip.presentation
  let title = '', detail = '', action = '', canAct = false
  if (planning.phase !== 'loaded') {
    switch (planning.phase) {
      case 'prompt': title = 'Where are we going?'; detail = 'Ask the rider to tap and say where they are and where they want to go.'; action = 'Start recording'; canAct = true; break
      case 'listening':
        title = speech.phase === 'recording' ? 'Listening' : speech.phase === 'starting' ? 'Opening microphone' : 'Understanding your trip'
        detail = speech.phase === 'recording' ? 'Tap the glasses when the rider has finished speaking.' : 'Keep this page open. The next screen appears automatically.'
        action = 'Submit recording'; canAct = speech.phase === 'recording'; break
      case 'understanding': title = 'Understanding your trip'; detail = 'Transcribing the request and finding the right places.'; break
      case 'choose-origin': case 'choose-destination': {
        const from = planning.phase === 'choose-origin', candidates = from ? planning.originCandidates : planning.destinationCandidates
        const index = (from ? planning.originIndex : planning.destinationIndex) ?? 0, selected = candidates?.[index]
        title = from ? 'Choose the starting place' : 'Choose the destination'
        detail = selected ? `${selected.name}\n${selected.address}\n${index + 1} of ${candidates!.length} matches` : 'Scroll through the matches on the glasses.'
        action = 'Select this place'; canAct = true; break
      }
      case 'confirm': title = 'Is this trip right?'; detail = `From ${planning.origin}\nTo ${planning.destination}`
        action = planning.yes ? 'Yes, plan route' : 'No, record again'; canAct = true; break
      case 'planning': title = 'Planning the route'; detail = 'Checking trains and intermediate stations. Boarding directions appear next.'; break
      case 'error': title = 'Let’s try again'; detail = planning.error; action = 'Record again'; canAct = true; break
    }
  } else if (p.pending) {
    title = `Detected ${p.current?.name ?? 'a station'}`; detail = trip.timing
    action = `Not at ${p.current?.name ?? 'this station'}`; canAct = true
  } else if (p.state === 'complete') {
    title = 'You’ve arrived'; detail = `${p.current?.name ?? ''}\nFollow exit signs.`
  } else if (p.canArm) {
    title = p.state === 'waiting-boarding' ? 'Board the next train' : 'Ready to board'
    detail = `${p.journey.boarding.station}\n${p.journey.boarding.train}`; action = 'I’m aboard'; canAct = true
  } else {
    title = p.nextStop ? `Next: ${p.nextStop.name}` : trip.status
    detail = `${trip.status}\n${trip.timing}`
  }
  return { title, detail, action, canAct,
    showReset: planning.phase !== 'prompt', resetLabel: planning.phase === 'loaded' ? 'New trip' : 'Start over',
    canChoose: ['confirm', 'choose-origin', 'choose-destination'].includes(planning.phase),
    choiceLabel: planning.phase === 'confirm' ? `Selected: ${planning.yes ? 'Yes' : 'No'}` : 'Scroll through places',
    hasTrip: planning.phase === 'loaded' && tracker.route.length > 0,
    stopsLeft: Math.max(0, p.journey.stopTotal - p.journey.stopNumber),
    endpoint: p.journey.destination, transfer: p.journey.transfer,
  }
}
