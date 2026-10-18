# Build task list: G2 subway companion

Updated October 17, 2026 | Aligned with PRD v0.3

The intended MVP includes agent-prepared trips and the offline ride loop. Prove the hardware hypothesis and build a hand-checked fixture first, then connect live preparation. A fixture-only demo is an explicit scope reduction, not the full MVP. All unchecked items are future work. Risk IDs refer to the PRD obstacle register.

## Phase 0: Logistics and template baseline

**Done when:** tooling runs, device/testing constraints are documented, and the demo route is selected.

- [ ] R1: Confirm physical G2/loaner access, demo phone/OS, deadline, and where train recordings can be made.
- [ ] R1/R11: Choose the first NYC origin/destination and whether it includes a transfer. Distinguish non-NYC sensor testing from NYC validation.
- [ ] R12: Configure compatible active Node; run no-emit TypeScript checking and a normal build.
- [ ] R12: Initialize Git if intended, retain applicable template licensing, and add ignore rules for dependencies, builds, local secrets, packages and recordings.
- [ ] Review main.ts bridge/container setup, envelope-aware click normalization, display scheduling, cleanup and system exit confirmation.
- [ ] Run scaffold in simulator/G2; document expected STT-stub error. Raw sensor experiments must not require implementing a speech provider.
- [ ] R8: Compare SDK 0.0.10 with required capabilities; choose/pin a tested upgrade only if needed. Do not assume location, phone mic, text color or long press.
- [ ] Choose app name/package identity and update manifest/UI branding when implementation begins; verify naming rules.
- [ ] Change one glasses display line and handle one touch event end to end.

## Phase 1: Hardware feasibility and lifecycle

**Done when:** recordings support or reject departure/braking detection, and lock/resume behavior is measured on the demo phone.

- [ ] R2: Build IMU logger independent of STT; timestamp sample receipt and export recordings.
- [ ] R2: Determine x/y/z semantics, units/range, actual sample intervals and dropped samples. Do not assume pacing codes are literal Hz.
- [ ] R2: Record head turns, looking down, walking, vibration, departure, cruising, braking, station dwell and any tunnel stop.
- [ ] R2: Test facing forward/sideways, seated/standing; evaluate orientation handling and horizontal-motion extraction as the head moves.
- [ ] R2: Test filtering jitter while preserving sudden and sustained acceleration/deceleration; low variance is possible corroboration only.
- [ ] R3/R11: Independently label station arrivals/departures using timestamps or phone/laptop controls that do not conflict with glasses exit; record another ride if feasible.
- [ ] R8: Verify tap, double-tap exit and swipes on G2; choose usable correction controls without assuming long press.
- [ ] R4: Log sensor continuity through five-minute lock/background, Bluetooth disconnect/reconnect and relaunch, including an installed build.
- [ ] R4: Compare WebView localStorage and SDK storage persistence; document the selected approach.
- [ ] R2: Make a feasibility decision from recordings. If IMU is insufficient, document results and evaluate extra signals before promising automatic tracking.
- [ ] Optional: Decouple raw audio capture from STT, play back PCM, and test whether brake/chime cues improve detection. Audio is not otherwise required for MVP.

## Phase 2: Data model, fixture and replay

**Done when:** a valid hand-checked route and recorded input can exercise the shared core offline.

- [ ] Define versioned pack schema: origin/destination, provider provenance, service time, IDs, app legs, service pattern, ordered stops, sourced cards and fallbacks.
- [ ] Define separate session: pack/version, active leg, last confirmed index, detector/armed state, pending candidate/deadline, last sample time, observation gap and corrections.
- [ ] Specify index/count semantics: board station is zero; first accepted post-departure stop advances once to the next station.
- [ ] Hand-check a NYC fixture and cards; keep it as development data and demo backup.
- [ ] R9: Define/validate card triggers, text limits, references, sources and safe fallback text.
- [ ] Build recorded-input replay with a controlled clock and the same detector/progression interfaces as live input.
- [ ] R3: Score false/missed stops, duplicate advancements and prompt latency against independent labels.

## Phase 3: Departure-armed detector and corrections

**Done when:** labeled replay gives explainable results and progression invariants hold.

- [ ] Implement Ready -> explicit start -> armed waiting for departure; do not count the initial station dwell.
- [ ] R2: Implement the tested departure -> moving -> braking -> candidate stopped sequence, tuned from recordings.
- [ ] R3: After accepted or vetoed candidate, require a fresh departure before the next candidate. Long dwell cannot count repeatedly.
- [ ] R3: Single tap vetoes within the window; silence commits exactly one advancement.
- [ ] R3/R8: Add late undo/back-one and missed-stop/forward correction with validated controls; recompute counts/cards consistently.
- [ ] R4: Detect stale/missing input; enter uncertainty on observation gaps rather than restoring unwarranted confidence.
- [ ] R7: Define explicit recovery for starting after departure without inventing an observed departure.
- [ ] R3: Test head motion, long dwell, tunnel stop/veto, missed stop, late undo, duplicate events, bounds, and gesture/timeout ordering.
- [ ] R3: Set numerical targets after initial data and evaluate another ride where feasible; record false/missed stops, latency and correction frequency.
- [ ] Optional: Add audio/schedule corroboration only if measurements justify it; neither is independent proof of station identity.

## Phase 4: Glasses UI, offline storage and transfers

**Done when:** stored fixture runs through start, tracking, correction and arrival/transfer without network.

- [ ] Ready screen: board station, line, headsign/direction and start action. Proposed single tap starts here and vetoes only during a prompt.
- [ ] Implement armed, riding, candidate, one-stop-away, arrival, transfer waiting, doubt/recovery and finished views.
- [ ] R8: Test one-line and two/three-line readability on G2; use text/layout emphasis unless selected SDK supports dimming/color.
- [ ] R8: Preserve double-tap system exit and envelope-aware event routing; validate recovery controls.
- [ ] R4: Persist transitions/candidate deadline/continuity data; verify reload and crash recovery.
- [ ] R4: Restart streams on resume/reconnect, inspect command results, and request actual position after uncertain gaps.
- [ ] R7: At alighting, show card and pause train tracking; require explicit start for next subway leg. Platform walking cannot count.
- [ ] R7: Define early exit, staying aboard, wrong train/direction and mid-ride recovery; offline rerouting is outside MVP.
- [ ] Disable Wi-Fi/mobile data while retaining Bluetooth; confirm normal tracking has no cloud dependency.
- [ ] Run replay on simulator/G2; distinguish synthetic input from recorded data in demo controls.

## Phase 5: Routing and exact station sequences

**Done when:** supplied origin/destination yields correct subway segments and ordered stops for the supported demo route.

- [ ] R5: Inspect a real Google Routes TRANSIT response, including a transfer if planned; confirm requested fields, coverage, quota/billing and response shape.
- [ ] Map provider steps into app legs; do not assume one API leg equals one subway ride.
- [ ] R5: Preprocess MTA GTFS into service patterns, accounting for service date/time, branches, direction and express/local rather than one list per line.
- [ ] R5: Resolve provider stops to MTA station/complex/platform IDs with names/coordinates and explicit checks.
- [ ] R5: Match board/alight, headsign/direction, time, pattern and expected count. Reject unresolved cases; never have the model invent intermediate stops.
- [ ] R9: Implement backend/tool with server-held credentials, CORS, network whitelist and useful error responses.
- [ ] R10: Check applicable saved-trip/offline storage and attribution conditions separately; document supported approach or choose an alternative provider. Keep this integration work separate from hardware experimentation.

## Phase 6: Agent preparation and guidance cards

**Done when:** origin/destination produces an accepted saved pack whose sourced cards appear correctly during offline tracking.

- [ ] Add minimal origin/destination input and ambiguity handling; show resolved locations, route, first station and direction for review.
- [ ] R9: Select/test a currently available model for tool use and structured output; centralize model configuration instead of relying on old draft example IDs.
- [ ] Agent calls routing tool and assembles validated pack/cards; output triggers and data, not executable scripts.
- [ ] R6: Inspect MTA entrance/exit data and official maps/guidance for the demo route; verify station linkage and platform reachability where possible.
- [ ] R6: Produce supported line/direction transfer cards and verified exits; do not infer an internal staircase/path solely from entrance coordinates.
- [ ] R6: Hand-check demo cards; omit unsupported detail and fall back to station/line/direction/sign-following guidance.
- [ ] R9: Validate schema, station references, trigger values, text length and factual support. Reject invalid or unsupported output; model confidence alone is insufficient.
- [ ] R9: Handle API/model timeout, partial enrichment, missing keys and denied permissions; preserve a valid saved-pack fallback, clearly labeled when used.
- [ ] Save complete valid pack while online and verify restoration after reload/network loss.
- [ ] Run origin/destination -> agent/tool route -> station sequence/cards -> phone storage -> glasses start -> arrival/transfer end to end.

## Phase 7: Installed Beta, ride evidence and submission

**Done when:** intended MVP is demonstrable, validation limits are documented and submission is ready.

- [ ] R1: Verify current naming/category, physical-device judging, Beta/group installation, public repo and video requirements.
- [ ] Package .ehpk, upload/install Beta and test on the actual demo phone/G2.
- [ ] Repeat installed-build lock/background/resume, reconnect, denied-permission and system exit-confirmation checks.
- [ ] R11: Capture physical ride/through-the-lens footage where feasible; accurately label NYC replay versus non-NYC sensor testing.
- [ ] Record false/missed stops, latency and corrections; distinguish measured support from hypotheses.
- [ ] Demonstrate agent preparation, route review, start/arming, departure, quiet tracking, veto/late correction and arrival/transfer cards.
- [ ] Prepare reproducible replay, hand-checked saved pack and backup video.
- [ ] Update README with setup, tooling versions, backend accounts/keys, permissions, G2 installation, supported routes and known limits.
- [ ] Draft Devpost entry with challenge selection, Even Hub app name, public repo and required video.
- [ ] Charge devices and re-run installed Beta after final changes.

## Later / optional enhancements

- [ ] Voice origin/destination: capture audio, parse with supported model and confirm recognized places before route creation.
- [ ] GPS origin after SDK/permission validation; manually supplied origin stays supported.
- [ ] Favorites/recents and glasses-first setup.
- [ ] Broader NYC service-pattern coverage.
- [ ] Audio corroboration, pre-ride realtime warnings or trained detection only after core measurements justify them.

## Final acceptance gate

- [ ] Full agent-prepared flow works for supported demo route; fixture-only fallback is labeled reduced scope.
- [ ] One motion cycle produces at most one advancement; veto and late corrections keep progress consistent.
- [ ] No network required during normal tracking after preparation.
- [ ] Observation gaps request position confirmation rather than silently restoring confidence.
- [ ] Each subway leg requires explicit start; transfer walking cannot advance train progress.
- [ ] Cards are readable and supported by checked facts; unsupported internal paths are omitted.
- [ ] Evidence and remaining limitations for R1-R12 are recorded, not implied solved.
