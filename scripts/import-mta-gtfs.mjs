import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { parse } from 'csv-parse/sync'
import { parse as streamCsv } from 'csv-parse'
import { Readable } from 'node:stream'

const sourceUrl = 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_supplemented.zip'
const input = process.argv[2]
const output = process.argv[3] || 'data/mta-subway.json'
console.log(input ? 'Reading local MTA GTFS archive…' : 'Downloading the MTA supplemented GTFS feed…')
async function archive() {
  if (input) return readFile(input)
  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(600000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  } catch (error) {
    throw new Error('MTA download failed. Download the supplemented GTFS ZIP from https://www.mta.info/developers, then run npm run gtfs:import -- path/to/feed.zip.', { cause: error })
  }
}
const bytes = await archive()
console.log(`Parsing ${(bytes.length / 1024 / 1024).toFixed(1)} MiB archive…`)
const files = unzipSync(bytes)
const entryFor = name => Object.entries(files).find(([filename]) => filename.split('/').at(-1) === name)?.[1]
const rows = name => {
  const entry = entryFor(name)
  if (!entry) return []
  return parse(Buffer.from(entry), { columns: true, bom: true, skip_empty_lines: true })
}
function seconds(value) {
  const match = /^(\d+):(\d\d):(\d\d)$/.exec(value)
  if (!match || +match[2] > 59 || +match[3] > 59) throw new Error(`Invalid GTFS time: ${value}`)
  return +match[1] * 3600 + +match[2] * 60 + +match[3]
}
const stops = Object.fromEntries(rows('stops.txt').map(s => [s.stop_id, {
  name: s.stop_name, latitude: +s.stop_lat, longitude: +s.stop_lon, parent: s.parent_station || '',
}]))
const routes = Object.fromEntries(rows('routes.txt').map(r => [r.route_id, { name: r.route_short_name, type: r.route_type }]))
const calendars = Object.fromEntries(rows('calendar.txt').map(c => [c.service_id, {
  start: c.start_date, end: c.end_date, days: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map(day => +c[day]),
}]))
const exceptions = {}
for (const c of rows('calendar_dates.txt')) (exceptions[c.service_id] ??= {})[c.date] = +c.exception_type
const trips = new Map(rows('trips.txt').filter(t => routes[t.route_id]?.type === '1').map(t => [t.trip_id, {
  id: t.trip_id, routeId: t.route_id, serviceId: t.service_id, directionId: t.direction_id || 'unknown', headsign: t.trip_headsign || '', stops: [],
}]))
// Stop times dominate the supplemented feed. Parse in bounded chunks so the
// entire CSV is not also retained as millions of temporary row objects.
function* chunks(bytes) { for (let i = 0; i < bytes.length; i += 65536) yield bytes.subarray(i, i + 65536) }
const stopTimes = entryFor('stop_times.txt')
if (!stopTimes) throw new Error('GTFS archive has no stop_times.txt.')
for await (const s of Readable.from(chunks(stopTimes)).pipe(streamCsv({ columns: true, bom: true, skip_empty_lines: true }))) {
  const trip = trips.get(s.trip_id)
  if (!trip || (s.pickup_type === '1' && s.drop_off_type === '1')) continue
  if (!stops[s.stop_id]) throw new Error(`Unknown GTFS stop ${s.stop_id}.`)
  trip.stops.push({ id: s.stop_id, arrival: seconds(s.arrival_time || s.departure_time), departure: seconds(s.departure_time || s.arrival_time), sequence: +s.stop_sequence })
}
const catalog = { schemaVersion: 1, fetchedAt: new Date().toISOString(), sourceUrl,
  sha256: createHash('sha256').update(bytes).digest('hex'), stops, routes, calendars, exceptions,
  trips: [...trips.values()].filter(t => t.stops.length > 1).map(t => ({ ...t,
    stops: t.stops.sort((a, b) => a.sequence - b.sequence).map(({ sequence, ...s }) => s),
  })) }
if (!catalog.trips.length || !Object.keys(stops).length) throw new Error('No usable subway schedules in this feed.')
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(catalog))
console.log(`Imported ${catalog.trips.length} subway trips and ${Object.keys(stops).length} stops into ${output}.`)
console.log('Source: MTA supplemented GTFS. Refresh before planning trips; service changes may still be incomplete.')
