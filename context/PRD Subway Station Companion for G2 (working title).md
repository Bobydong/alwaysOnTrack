# PRD: Subway Station Companion for G2 (working title)

Draft v0.3 | October 17, 2026 | Updated after scope discussion

This is a living document. Agreed intent, proposed implementation, and assumptions to verify are distinguished below. The local application remains an ASR scaffold; these features are planned.

## 1. Product

An Even Hub app for G2 that keeps NYC subway riders oriented underground and tells them what to do at arrival. The rider provides an origin and destination to an agent. The agent uses a routing/transit API and supporting data to prepare the trip and short exit/transfer cards. The complete trip pack is loaded onto the phone before boarding. The phone runs tracking offline and feeds display updates to the glasses.

Station progress is inferred from train motion and the prepared ordered stops, not independently identified from the sensor. The rider normally intervenes only to correct an error.

**Pitch:** Never miss your stop, and know what to do when you arrive.

**Who and when:** NYC commuters/visitors during an underground ride and at arrival, especially on trips involving transfers.

**Why G2:** Quiet peripheral guidance without taking out a phone. Default to one unobtrusive line; escalate only near the alighting station. Show uncertainty rather than an apparently precise wrong position.

## 2. Scope decisions

- Agent-prepared trips are part of the intended MVP, rather than a backend bonus.
- The rider supplies both origin and destination. Voice and GPS are optional enhancements.
- Google Maps Routes API is the leading candidate; confirm suitability with a real response.
- The agent prepares structured cards with triggers and supporting sources, not executable scripts.
- All preparation happens online; no model or cloud calls are required during normal tracking.
- The app assumes the rider boards at the first station of the current subway leg, in the prepared direction. Show that assumption for review.
- The rider explicitly starts/arms tracking from the glasses. Proposed control: single tap on Ready. Departure acceleration then activates station detection.
- Single tap during a stop prompt vetoes that candidate. Start and veto are different actions in different states.
- Detect departure/movement/braking patterns while filtering train vibration, rather than using low variance alone.
- A hand-checked fixture is an early development tool and demo backup, not completion of the agent-prepared MVP.

## 3. MVP and boundaries

**MVP:** minimal origin/destination input and route review; agent-generated valid trip pack for a bounded NYC demo route/set; actual ordered subway stops; offline storage; glasses start; departure-armed detection; veto and late correction; one-stop-away and arrival/transfer cards; explicit start per subway leg; replay using the same core logic; physical G2 validation where available.

Detailed exits are included only where supported by reliable information. General station/line/direction guidance is the fallback. Hand-check the demo cards.

**Later:** voice, GPS, favorites, wider NYC service coverage, audio corroboration, pre-ride realtime warnings, trained detector if recordings justify it.

**Non-goals:** full indoor/street turn-by-turn navigation, other transit systems as product coverage, offline rerouting, automatic proof of correct boarding or alighting, bus stop detection, emergency routing.

If time forces a fixture-only submission, explicitly describe the reduced scope.

## 4. Online preparation

1. Rider supplies origin and destination; agent resolves ambiguous locations.
2. Backend routing tool requests transit directions, initially evaluating Google Routes TRANSIT mode.
3. Convert provider steps into app legs. One API leg may contain multiple train/walking steps; it is not necessarily one subway ride.
4. Match each subway segment to an MTA service pattern for the selected date/time, direction, board/alight stations, branches, and express/local service. Resolve ordered intermediate stops.
5. Agent assembles short transfer/exit/next-step cards from route facts and verified station information, with supporting sources.
6. Validate the pack; review boarding station, train line, direction/headsign, and destination with the rider.
7. Save the complete pack before going offline.

Google supplies transit endpoints, line, headsign and stop count. Its documented transit schema does not supply a full intermediate-stop list or dedicated internal station exit/path field. Use MTA GTFS for sequences. MTA entrance/exit data can help choose a street exit; coordinates alone do not establish a path from a particular platform.

Reject unresolved service patterns and invalid agent output. Do not let a model invent intermediate stops, stairs, or platforms. Unsupported enrichment falls back to general guidance.

## 5. Offline detection and interaction

### Motion hypothesis to test

Ready -> explicit start -> armed/waiting for departure -> moving/cruising -> braking -> candidate stopped -> accepted or vetoed -> waiting for a new departure.

The intended detector filters vibration/jitter and catches coherent horizontal acceleration/deceleration. First verify whether IMU x/y/z are acceleration, orientation, or another quantity, their units, and actual sample intervals. Glasses axes move with head orientation, so identifying a forward axis once is insufficient. Test head turns, looking down, seated/standing positions, and facing sideways. Low variance may help confirm the stopped phase; it is not the sole detector.

At a candidate, show the expected station for a configurable veto window. Silence advances one station; single tap leaves progress unchanged. After either outcome, require a new departure before another candidate. Long dwell must not count repeatedly.

Tunnel stops can resemble station stops. Veto remains necessary; schedules can be a plausibility check, not proof of location. Missed/accepted false stops require correction after the prompt closes.

### Screens and controls

- Ready: boarding station, line, direction, start action.
- Armed: waiting for departure.
- Riding: next expected station and stops remaining to this leg's alighting station.
- Candidate: expected station and veto opportunity.
- One stop away: distinct text/layout emphasis; brightness depends on SDK support.
- Arrival: two or three lines for transfer/exit/next step.
- Transfer waiting: hold guidance and pause train detection until the next leg is explicitly started.
- Doubt/recovery: position confirmation, late undo/back-one, and missed-stop/forward correction.
- Finished: stop normal tracking and streams.

Single-tap veto is agreed. Single-tap start is proposed. Preserve template double-tap exit initially; evaluate swipe/menu corrections on hardware. Do not assume long press exists. Prompt duration and final recovery controls remain open.

Arrival does not prove the rider got off. Explicitly start each subsequent subway leg so platform walking does not count. Define recovery for early exit, staying aboard, wrong boarding, and starting after departure; offline rerouting remains outside scope.

## 6. Data and architecture

Use versioned, validated JSON. Separate prepared trip data from mutable session state.

**Pack:** schemaVersion, trip ID, origin/destination, preparation/service time, schedule version, provider provenance, app legs, station/complex/platform IDs where available, board/alight, line/headsign, selected service pattern, ordered stations, cards with triggers/sources, fallback text, freshness metadata.

**Session:** pack ID/version, active leg, last confirmed station/index, armed/detector state, pending candidate/deadline, last sample time, observation-gap flag, corrections, started/finished state.

Board station is index zero; the first accepted stop after departure advances to the next station. Cards trigger before alighting, at arrival, while awaiting transfer, and at final destination. Validate trigger values, station references, text length, and supporting facts. Model-asserted confidence alone is not evidence.

**Phone WebView:** TypeScript detector, progression, persistence, rendering controller. **G2:** SDK containers and touch; sensors relayed through the Even app. **Backend:** routing tools, preprocessed GTFS, agent, validation, hidden keys, CORS and network whitelist. **Replay:** recorded samples/controlled clock using the same detector/session logic.

Gemini is a model candidate. Verify an available model's tools/structured-output support; keep configuration centralized. Prior draft example model IDs are not confirmed dependencies.

**Local baseline reviewed October 17:** Vite/strict TypeScript; SDK 0.0.10, CLI 0.1.14, simulator 0.7.3. STT stub throws and currently gates mic startup. No subway features/backend/persistence/tests. No Git metadata/ignore file; shell reports no active Node version.

Installed SDK types expose IMU and foreground events, but not typed location, phone-mic source selection, long press, or text color. Evaluate and pin a tested SDK version before adopting newer features. Preserve envelope-aware click normalization and system exit confirmation.

Measure lock/background/disconnect behavior on the actual demo phone and installed Beta; neither OS is assumed guaranteed. Compare WebView and SDK storage. Persisting an index cannot recover stops missed during suspension: restore streams, assess continuity, and request position confirmation after gaps.

## 7. Obstacles and resolution gates

IDs map to build-list tasks; none are implied solved.

| ID | Obstacle | Evidence needed |
| --- | --- | --- |
| R1 | Unknown G2 access, demo phone, deadline, recording location | Confirm logistics and choose initial NYC route/transfer scope. |
| R2 | IMU semantics, head motion, vibration, sampling | Timestamp known motions and labeled rides; test filtered departure/braking features; decide signal feasibility. |
| R3 | Duplicate, false, missed stops and unnoticed prompts | Departure re-arming, measured false/missed detections/latency, veto and late correction tests. |
| R4 | Phone lock/suspension or disconnect loses observations | Installed-build continuity tests, persistence, stream restart, explicit position check after gaps. |
| R5 | Route/GTFS sequence mismatch | Match IDs, service date/time, direction, branch and express/local; reject ambiguous sequences. |
| R6 | Unsupported exit/internal path instructions | Verified station sources and hand-checked demo cards; omit unsupported stairs/platform paths. |
| R7 | Boarding assumption and transfer boundaries | Review first station/direction, explicit start per leg, early-exit/staying-aboard/mid-ride recovery. |
| R8 | SDK and gesture conflicts | Validate start/veto/swipe/exit on G2; test capabilities before upgrading; no assumed long press. |
| R9 | Agent/backend errors | Strict schema/provenance, rejection of invented facts, timeout handling, valid saved-pack fallback, server-held keys. |
| R10 | Provider storage/attribution integration | Check applicable offline storage and attribution conditions; document supported approach or alternative provider. Track separately from hardware experiments; hackathon status is not an assumed exemption. |
| R11 | Demo versus actual NYC validation | Obtain NYC ride evidence where feasible; distinguish local motion testing, synthetic demo, and NYC replay. |
| R12 | Toolchain/reproducibility | Active compatible Node, Git/ignore setup, type-check/build and documented pinned tooling. |

## 8. Acceptance criteria

- Origin/destination -> agent-prepared valid pack -> phone storage -> glasses start -> departure -> station progression -> arrival/transfer guidance works for the supported trip.
- One departure/stop cycle yields at most one advancement, including long dwell and duplicate events.
- Veto leaves count unchanged; late undo and missed-stop correction preserve consistent next station, remaining count, and cards.
- Normal tracking after preparation requires no cloud/network access; test with data disabled and Bluetooth retained.
- Lock/resume either preserves verified continuity or explicitly requests position; it never silently claims unseen stops were recovered.
- Each new subway leg requires deliberate start; walking at a transfer cannot advance train progress.
- Cards fit the real display and contain checked facts; unsupported internal paths are omitted.
- Measure false positives, missed stops, latency, and corrections on labeled rides. Set numerical targets after initial recordings rather than claim unmeasured reliability.
- Clearly label synthetic replay, recorded-data replay, physical sensor testing, and real NYC validation.

## 9. Demo and submission

Show preparation, route review, start/arming, departure, quiet tracking, veto/correction, and arrival/transfer cards. Use reproducible replay plus physical ride footage where feasible. Keep a saved fixture and backup video.

Carry forward the original challenge/submission checklist, verifying current requirements: app naming/category, .ehpk Beta/group installation, physical G2 judging, public repo and installation README, Even Hub app name, Devpost challenge selection, two-to-three-minute video, denied permissions, system exit and lock/resume tests. App name remains undecided.

## 10. Open decisions

Hardware/phone/deadline/location; first NYC route and transfer; initial input surface; model choice; prompt duration and recovery controls; acceptable correction frequency; early-exit/staying-aboard/mid-ride behavior; signal alternatives if G2 IMU is insufficient; final app name. Voice/GPS are optional. Phone motion sensors or additional audio are alternatives to evaluate, not agreed requirements.

## 11. References from scope discussion

- Google transit routing: https://developers.google.com/maps/documentation/routes/transit-route
- Response schema: https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes
- Storage/attribution: https://developers.google.com/maps/documentation/routes/policies
- MTA entrance/exit data: https://data.ny.gov/Transportation/MTA-Subway-Entrances-and-Exits-2024-Map/68hr-j2j7
- Official templates: https://github.com/even-realities/evenhub-templates
- SDK lifecycle/version-dependent features: https://hub.evenrealities.com/docs/build/page-lifecycle

Verify selected APIs, terms, models, and challenge requirements when implementing; they can change.
