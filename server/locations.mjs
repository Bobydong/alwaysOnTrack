import { ApiError } from './http.mjs'

// A numbered street alone spans multiple possible origins/stations. An NYC
// suffix or the word "station" does not identify its avenue or subway line.
const bareStreet = /^(?:(?:east|west|e|w)\s+)?\d+(?:st|nd|rd|th)?\s*(?:street|st)\.?(?:\s+station)?(?:\s*,?\s*(?:manhattan|nyc|new york(?: city)?|ny))*$/i
export function checkTripLocations({ origin, destination }) {
  if ([origin, destination].some(value => typeof value === 'string' && bareStreet.test(value.trim()))) {
    throw new ApiError(422, 'Which avenue or station? Tap to try again with specific stations or street intersections for both places.')
  }
}
