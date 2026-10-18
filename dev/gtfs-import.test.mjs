import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { zipSync, strToU8 } from 'fflate'

test('GTFS importer parses real CSV syntax, sorts stop sequences, preserves exceptions and times after 24:00', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'alwaysontrack-gtfs-'))
  const zip = path.join(dir, 'synthetic-feed.zip'), output = path.join(dir, 'catalog.json')
  t.after(async () => { await unlink(zip); await unlink(output); await rmdir(dir) })
  const files = {
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon,parent_station\nA,"Alpha, North",40.75,-73.99,\nB,Bravo,40.76,-73.98,\n',
    'routes.txt': 'route_id,route_short_name,route_type\nroute-one,1,1\nbus,B1,3\n',
    'calendar.txt': 'service_id,start_date,end_date,sunday,monday,tuesday,wednesday,thursday,friday,saturday\ndaily,20260101,20261231,1,1,1,1,1,1,1\n',
    'calendar_dates.txt': 'service_id,date,exception_type\ndaily,20261017,2\n',
    'trips.txt': 'route_id,service_id,trip_id,direction_id,trip_headsign\nroute-one,daily,subway-one,0,North\nbus,daily,bus-one,0,North\n',
    'stop_times.txt': 'trip_id,stop_id,stop_sequence,arrival_time,departure_time,pickup_type,drop_off_type\nsubway-one,B,2,24:17:00,24:17:00,0,0\nsubway-one,A,1,24:15:00,24:15:00,0,0\nbus-one,A,1,12:00:00,12:00:00,0,0\n',
  }
  await writeFile(zip, zipSync(Object.fromEntries(Object.entries(files).map(([name, csv]) => [`nested/${name}`, strToU8(csv)]))))
  await promisify(execFile)(process.execPath, ['scripts/import-mta-gtfs.mjs', zip, output])
  const catalog = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(catalog.stops.A.name, 'Alpha, North')
  assert.equal(catalog.trips.length, 1)
  assert.deepEqual(catalog.trips[0].stops.map(s => s.id), ['A', 'B'])
  assert.equal(catalog.trips[0].stops[0].departure, 87300)
  assert.equal(catalog.exceptions.daily['20261017'], 2)
  assert.match(catalog.sha256, /^[a-f0-9]{64}$/)
})
