import type { StationTracker } from './station-tracker.ts'
import type { SubwayLeg } from './trip-plan.ts'

// Tracker indices omit transfer walks and the next train's boarding stop.
// Map ride boundaries by counted arrivals, rather than matching station names.
export function journeyView(tracker: Pick<StationTracker, 'route' | 'tripPlan' | 'stationIndex'>) {
  let start = 0
  for (let i = 1; i <= tracker.stationIndex; i++) if (tracker.route[i]?.transfer) start = i
  let end = tracker.route.length - 1
  for (let i = tracker.stationIndex + 1; i < tracker.route.length; i++) {
    if (tracker.route[i].transfer) { end = i; break }
  }
  const rides = tracker.tripPlan?.legs.filter((leg): leg is SubwayLeg => leg.kind === 'subway') ?? []
  let rideIndex = 0, boundary = 0
  while (rideIndex < rides.length - 1 && tracker.stationIndex >= boundary + rides[rideIndex].stops.length - 1) {
    boundary += rides[rideIndex].stops.length - 1; rideIndex++
  }
  const ride = rides[rideIndex], nextRide = rides[rideIndex + 1]
  const destination = tracker.route[end]
  const lineText = (leg: SubwayLeg) => `${leg.line.id.replace(/\s+Line$/i, '')} train toward ${leg.line.headsign}`
  const boarding = ride
    ? { station: ride.stops[0].name, train: `Board the ${ride.line.id.replace(/\s+Line$/i, '')}-line to ${ride.line.headsign}` }
    : { station: tracker.route[start]?.name ?? '', train: tracker.route[start]?.instruction ?? 'Check your train on the phone' }
  const transfer = destination?.transfer ?? false
  const instruction = transfer
    ? nextRide ? `Change to ${lineText(nextRide)}. Board at ${nextRide.stops[0].name}.`
      : destination?.instruction ?? 'Check the next train on your phone.'
    : 'Follow exit signs.'
  return {
    boarding, destination: destination?.name ?? '', transfer, instruction,
    approaching: tracker.stationIndex + 1 === end,
    // Count completed station-to-station segments, excluding the boarding stop.
    stopNumber: tracker.stationIndex - start, stopTotal: end - start,
  }
}

// Show the detected arrival immediately while the detector keeps its last
// confirmed position until the correction window ends. Never mutate the tracker
// here: a tap or sensor gap simply removes this preview and restores that view.
export function journeyPresentation(tracker: StationTracker) {
  const pending = tracker.state === 'candidate' && !!tracker.nextStop
  const stationIndex = tracker.stationIndex + (pending ? 1 : 0)
  const current = tracker.route[stationIndex]
  const state = !pending ? tracker.state : stationIndex === tracker.route.length - 1 ? 'complete'
    : current.transfer ? 'waiting-boarding' : 'waiting-departure'
  return {
    pending, state, stationIndex, current, nextStop: tracker.route[stationIndex + 1],
    canArm: state === 'ready' || state === 'waiting-boarding',
    journey: journeyView({ route: tracker.route, tripPlan: tracker.tripPlan, stationIndex }),
  }
}
