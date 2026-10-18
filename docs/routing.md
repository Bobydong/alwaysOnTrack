# Prepared trips and route planning

The current provider is **Google Routes TRANSIT + MTA supplemented subway GTFS**. Preparation runs online on the server. The resulting plan contains every counted station and its expected travel time, so the detector does not call a provider while riding.

## Local setup

1. Use Node 24 and run `npm install`.
2. Copy `.env.example` to `.env.local`. Set `GOOGLE_MAPS_API_KEY` to a key with **Routes API** enabled and a billing-enabled Google Cloud project. Never prefix this key with `VITE_`; it is server-only.
3. Run `npm run gtfs:import` to download and preprocess the official MTA supplemented feed. Refresh it before route planning; MTA updates the supplemented feed hourly and notes it does not include every service change.
4. If the download fails, download **Supplemented GTFS** from [MTA developer resources](https://www.mta.info/developers), then run `npm run gtfs:import -- "path/to/gtfs_supplemented.zip"`. The catalog is written to `data/mta-subway.json` and excluded from Git. A custom output path can be supplied as a second argument and configured through `MTA_GTFS_CATALOG`.
5. Restart `npm run dev`. In the station panel, open **Plan a NYC subway journey**, enter origin/destination, and press **Find subway routes**. Choose **Load this itinerary**, board the first subway at the station shown, and tap the glasses.

The API key is sent only from the backend to Google, never included in a browser response or the client bundle. No paid Google request is made merely by opening the page; it requires pressing Find subway routes. Live Google request validation requires a configured key; synthetic contract fixtures do not establish live route correctness.

## Portable trip format, version 1

`src/trip-plan.ts` defines the types and runtime validator. `parseTripPlan` validates imported/provider data before loading. Prepared trip JSON is available under each result, can be pasted into **Import prepared trip JSON**, and is included as `tripTracking.tripPlan` in recording exports.

Top-level fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `1` |
| `id`, `preparedAt` | Plan identity and ISO preparation time |
| `origin`, `destination` | Rider's requested locations |
| `departureTime`, `arrivalTime` | Requested journey departure and expected arrival, ISO timestamps. Arrival uses the final train's reported arrival plus trailing walking durations. |
| `source` | Provider (`google-routes-mta`), attribution, schedule import time and source URL |
| `legs` | Ordered walking and subway legs |
| `warnings` | Limits the rider should understand before boarding |

Each subway leg contains:

- `id`, `kind: "subway"`, `departureTime`, `arrivalTime`.
- `line: { id, name, headsign }` for the train and direction.
- `stops: [{ id, name, latitude, longitude, travelSeconds }]`, including boarding and alighting. Boarding uses 0; each subsequent value is scheduled arrival at that stop minus departure from the previous stop. Platform dwell is excluded. Times are schedule estimates, not measurements or a live prediction.
- `schedule: { tripId, directionId, serviceDate, feedSha256 }` identifying the GTFS schedule used.

Each walking leg contains `id`, `kind: "walk"`, `from`, `to`, `durationSeconds`, and `instruction`. Places contain `name`, `latitude`, and `longitude`. Walking instructions are provider text; they do not establish verified indoor station paths or exits.

Unknown schema versions, invalid coordinates/times, missing train legs, unusable inter-station timings, overlapping train legs, and plans beyond the tracker's 50-stop limit are rejected. Prepared plans and tracker sessions are separate. Plans are currently held in page memory: exporting JSON preserves the plan, but automatic restore/persistent journey storage remains future work.

## Provider and sequence matching

The backend requests Google alternative transit routes restricted to subway, plus walking steps. Google transit steps identify boarding/alighting stations, line/headsign and a stop count. They do **not** supply the complete ordered intermediate-station list needed by this tracker. See [Google transit routes](https://developers.google.com/maps/documentation/routes/transit-route).

The MTA adapter matches each train step using:

- Subway line, including GTFS express variants where endpoints and stop count agree.
- Boarding and alighting coordinates within 250 metres, in the correct order.
- Exact number of station-to-station transitions reported by Google.
- Active service calendars and date exceptions in `America/New_York`, including previous service days with GTFS times past 24:00.
- Scheduled departure and arrival within five minutes of the Google step.

All viable matches must agree on the complete station-ID sequence. Distinct valid sequences cause rejection rather than a guess. Among matches with the same sequence, the nearest schedule supplies per-station travel times. Missing schedules, unsupported modes, and ambiguous patterns are returned as rejected alternatives. There is no fake or equal-spacing fallback. This strict approach can reject a usable route when Google and MTA disagree; refresh the feed or choose another itinerary.

The feed checksum and import timestamp establish provenance, not assurance of live service accuracy. Google/MTA agreement is not proof that a rider boarded the correct train. No entrance/exit dataset, platform lookup, service-alert feed, or realtime train positions are integrated.

## Mapping to the current tracking loop

`toTrackerStops` turns train legs into the existing detector stops. Walking remains in the full plan. A train's final stop is marked as a transfer when another train follows; its instruction names the next line, direction and boarding station. If that boarding station differs from the alighting station, it is reached on foot and is **not** inserted as another train-arrival count. The rider completes that walk, boards, and taps to re-arm. The next counted stop is the next station on the new train's sequence.

The first instruction names the boarding train and direction. The final instruction is general alighting/exit-sign guidance. Specific exits and stairs are never invented. Loading the manual text route clears provider-plan provenance, because that route is no longer the provider's validated plan.

## API and deployment

- `GET /api/trips/status`: readiness only (key configured, catalog available, import time); no credentials.
- `POST /api/trips/plan`: JSON `{ origin, destination, departureTime? }`; optional departureTime is ISO, otherwise server current time. Returns `{ plans, rejected }`.
- Vite mounts this endpoint during development. `npm run build` followed by `npm start` serves the built UI and same-origin endpoint using Node 24. `PORT` defaults to 5173.
- A production deployment must retain the backend, credentials, and GTFS catalog. A static `dist`/`.ehpk` alone cannot call this server endpoint. Put the server behind trusted HTTPS for wireless phone motion access. An installed Even Hub build still needs a configured reachable planner backend; that deployment integration is not included here.
- `Save to laptop` recordings remains a Vite-only development endpoint. The standalone server does not expose it.

Tests: `node --test dev/routing.test.mjs dev/gtfs-import.test.mjs dev/station-tracker.test.mjs`. Routing tests use explicitly synthetic Google/GTFS fixtures; no credentials or billable calls are required. During implementation the importer also processed the official supplemented feed (80,875 subway trips, 1,488 stops), and the matcher resolved a schedule-derived line 1 segment against that catalog. This checks real feed compatibility; a real Google response is still required for end-to-end provider validation.
