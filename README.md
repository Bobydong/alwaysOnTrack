# AlwaysOnTrack: G2 subway companion prototype

An Even Hub G2 and Android phone prototype for route-aware subway station prompts. It combines a phone-motion station counter, Google Routes + MTA schedule matching, and a trip-planning agent with short G2 microphone recordings for speech input. Groq provides Whisper Large V3 Turbo transcription and GPT-OSS 120B intent/tool calling; Gemini remains an optional provider. Manual route search and itinerary import remain available. Route preparation needs internet; tracking runs on the phone.

## Project status

The current hackathon demo flow is working on the developer's G2 and Android test setup. The station counter can follow a sequence of named stops, detect a simulated departure and a braking-like arrival, ask the rider to veto a proposed arrival, and advance to the next stop. The timing and thresholds are exposed in the short demo preset. This is a prototype for testing the interaction and motion rules; its thresholds have not been validated on real train journeys.

Completed in the current prototype:

- Glasses-first speech planning: tap to record, tap to submit, review understood From/To locations, scroll between Yes/No and tap to confirm. Yes automatically plans and loads a verified Google/MTA itinerary into the boarding screen; No returns to recording. Phone search/import remains available. Live speech/planning has been tested; the new scroll confirmation flow still needs a physical G2 check.
- Spoken landmarks resolve through Google Places API (New) before confirmation. Multiple matches can be scrolled and selected on the glasses; confirmation includes names and street addresses. Routes receives the selected server-verified place IDs. Places API access must be enabled for the Google key.
- An optional 12-second-per-stop demo timing override for generated plans. Original provider schedules remain in the prepared itinerary and export; the tracker identifies simulated timing separately.
- G2 IMU exploration with live X/Y/Z values, plots, summary statistics, movement labels, and JSON/CSV export.
- Optional Android phone motion capture and side-by-side comparison with G2 readings.
- A route editor for entering the current stop, later stops, and expected time between each pair. The app assumes the rider starts at the first listed stop.
- Optional station instructions for boarding, staying on a train, transferring, and exiting. Full text appears on the phone, with a short version on the glasses. Instructions persist until the next departure; destination instructions stay visible.
- One tracking loop per train ride: ordinary stops continue automatically; confirmed transfer arrivals pause detection until the rider boards the next train and taps again. Walking between trains cannot start a segment timer.
- Tap-to-start tracking, phone-motion departure detection, and a segment timer that opens arrival detection after `floor(90% × segment duration)`.
- Arrival proposals based on phone acceleration, followed by a correction countdown. Phone movement during that countdown does not cancel the proposal; a single tap vetoes it. Missing phone sensor samples cancel it because the app cannot confirm tracking continued.
- Glasses and phone status messages for blocked detection, arrival watching, proposed arrivals, veto cooldowns, departure waiting, and trip completion.
- A quiet G2 riding layout with a right-side moving stop window: last stop, next stop, the ride endpoint, and stops remaining. Labels align close to the rail; only the last-station marker is filled. Small pixel graphics mark boarding/transfer/exit/voice states. Detection and correction status stays at bottom left. Physical font, image rendering, and overflow checks remain pending.
- Manual station correction and manual departure controls for recovering during a demo.
- Timestamped detector events and current route/state/settings in the JSON export.
- Versioned prepared-trip JSON: ordered walking/train legs, line/headsign, intermediate stations, per-station schedule estimates, and source provenance. JSON can be imported and loaded into the existing transfer loop.
- Google Routes backend and MTA supplemented GTFS importer. The planner resolves intermediate stops against active MTA schedules and rejects unresolved/ambiguous alternatives. Google credentials stay on the server. Live Google validation requires local API-key setup; automated routing checks use synthetic fixtures.

Still to do or validate:

- Physical G2 validation of the new full-screen preparation flow, Yes/No scrolling, text fit, retry behavior, and transition into the corner boarding layout. Gemini access, speech/planning, and Google/MTA integration have been checked; each demo route still needs review.
- Automatic sourcing and verification of platform and exit details. Preset directions are fictional examples; planned itineraries currently use line/headsign and general exit-sign guidance. The local transfer loop has been tested on G2; externally planned journeys still need a live check.
- More motion recordings and threshold tuning, especially tests that compare ordinary seated movement with train departure and braking. The user reports the current demo transition works well; real-train reliability has not been established.
- Reliable screen-lock/background sensing is outside this MVP. The lock test kept JavaScript and glasses communication running but lost phone acceleration. Keep the page visible and the phone screen on during the five-minute demo; no native Android companion or wake-lock feature is included.
- Any use of G2 IMU data to improve detection. The glasses IMU is captured for diagnostics and comparison only; it does not affect departure or arrival decisions.

## Run with your phone and G2

1. Install/use a compatible Node version (the installed SDK requires Node 20 or 22+). Run `npm install` if dependencies are not present.
2. Pair the G2 through the Even app.
3. For Android phone-motion access, enable USB debugging on the phone, connect it to the laptop by USB, and accept the phone's debugging prompt. Run `npm run dev:phone` once; it discovers `adb` and forwards device port 5173 to the laptop's Vite server. (Android platform-tools must be installed.)
4. Run `npm run dev` in one terminal. In another run `npx evenhub qr --url http://localhost:5173` and open it using the Even app development flow. The `localhost` URL is important: LAN HTTP addresses such as `http://192.168…` are not secure contexts, so Android may block motion sensors. A normal phone browser cannot access the G2 bridge.
5. If using the LAN QR instead, connect both devices to Wi-Fi and expect Android phone motion to be unavailable unless you serve over trusted HTTPS. The G2 connection may still work. For LAN connection problems, check the laptop firewall and Wi-Fi client isolation.
6. In the phone dashboard press **Start IMU**, then **Start recording**. Look for actual X/Y/Z values and the measured receipt rate.
7. Choose a movement label before each experiment. Label changes add a marker while recording. **Tap the glasses** to add a timestamped marker without using the phone. **Double-tap** opens system exit confirmation.
8. Stop recording and export JSON and/or CSV before closing/reloading. Stop IMU when finished.

On this machine an installed Node binary was found at:
`C:\Users\bryan\AppData\Local\Author Software\nvm\installs\v24.22.0\node.exe`
If the node/npm shims say no active version is configured, activate your installed version in nvm. The implementation was checked using that binary directly.

## Online route preparation

For voice and conversational planning, see [AI setup and demo flow](docs/voice-agent.md). Set `AI_PROVIDER=groq` and `GROQ_API_KEY` in `.env.local`, then restart the server. Use `AI_PROVIDER=gemini` to select the previous Gemini integration. Manual Google/MTA search works without an AI key.

1. Set `GOOGLE_MAPS_API_KEY` in `.env.local` on the laptop. Enable Routes API and billing for the key. Never use a `VITE_` prefix for this secret.
2. Run `npm run gtfs:import` to import the official MTA supplemented subway schedules. If downloading fails, download the supplemented ZIP from [MTA developer resources](https://www.mta.info/developers) and run `npm run gtfs:import -- "path/to/feed.zip"`.
3. Restart Vite. Open **Plan a NYC subway journey** in the route panel, enter origin and destination, and press **Find subway routes**.
4. Choose **Load this itinerary**. Board at its first train station and tap the glasses. Walking links and transfers are retained in the full plan; walking to a new boarding station does not create a false station count.

Google supplies train endpoints and stop counts; MTA schedules supply the actual intermediate stations and expected travel times. Unresolved routes are rejected. Specific exits/platform paths are not inferred. Plans are currently in page memory; export before reloading.

See [prepared-trip format and routing setup](docs/routing.md) for the API contract, matching rules, limits, JSON import/export, and standalone server deployment. `npm run build` then `npm start` serves the built app and planner backend on port 5173; static hosting alone does not include the route service.

## Experimental station counting

Enable phone motion over Android localhost/USB forwarding, then use the new station-counter panel:

On launch, the glasses show the spoken-trip prompt. The optional NYC demo is available on the phone: **Times Sq-42 St (N) → 34 St-Herald Sq (transfer to F) → 23 St → 14 St**. Select the preset and load the route explicitly. It uses simulated 12-second segments (arrival sensing opens after 10 seconds) and makes no Google request. It is not a verified live itinerary.

1. Choose the three-minute example itinerary or the **Short demo with transfer (12-second segments)**. Both have a starting station, an ordinary stop, a transfer station, and a destination. Edit names, durations, and instructions as needed. Use `station name | travel seconds from previous station | optional instruction | transfer`; the last field is only for intermediate stops where you change trains. The starting station uses 0 seconds. Old two-field routes still work. Press **Load route, then tap glasses to start**.
2. **Board the first train and single-tap the glasses to begin tracking**, or press **Start tracking (or tap glasses)** on the phone. Motion does not start tracking before your tap. Arming starts raw recording automatically; the travel timer waits for departure motion. Keep the phone secured in one position and the page in the foreground. G2 IMU can also be started for comparison; its readings do not control the station count.
3. Sustained phone linear acceleration starts the segment timer. **Mark departure now** is an explicit recovery option if the detector misses your departure.
4. Arrival inputs remain blocked until `floor(90% × expected segment duration)` after departure. A 12-second demo segment opens at 10 seconds. Both screens show **Arrival inputs blocked / Detection opens in ...** until that gate opens, then **Arrival detection OPEN / waiting for jolt**. This countdown measures the input-block period. The expected time may pass without advancing the station.
5. After the window opens, a coherent **jolt**, a settling interval, and quiet dwell produces a proposed arrival. Recoil is not required. The demo requires a 250 ms mean of at least 0.35 m/s² for 0.4 seconds, allows 0.3 seconds to settle after the detected jolt, then checks for 0.25 seconds at or below 0.25 m/s². Normal settings use 0.5 seconds to settle and 3 seconds of quiet. The proposal stays on the glasses for an adjustable correction window (8 seconds normally, 6 seconds in demo). Single-tap the glasses or press **Not at station** to cancel. Phone motion during the correction window does not cancel the proposal, allowing for the rider shifting in their seat. A sensor gap cancels the proposal and requires a new jolt. The next-station, transfer, or exit screen appears immediately when an arrival is detected; tapping Not at station restores the previous view.
6. Successful expiry advances the current station once and shows its instruction. At an ordinary stop, the app waits for departure and continues automatically. At a transfer stop, it shows **Transfer: tracking paused** and ignores detector input until you board the next train and tap. That tap arms departure detection; it does not start the timer itself. At the destination, tracking ends and the exit instruction remains visible. Use **Set current station** to fix a missed/extra count; corrections respect transfer markers. If already aboard and armed, **Mark departure now** can recover a missed departure. An explicit veto enters a 10-second cooldown and requires fresh arrival evidence afterward.
7. Stop recording and export **JSON** for raw streams plus the `tripTracking` route, settings, state and timestamped evidence/event log. CSV retains only sensor samples. **Stop tracking** stops the counter but leaves diagnostic recording running until you stop it. Clearing the diagnostic recording does not clear the trip log; reload only after exporting.

Example manual itinerary (fictional directions):

```text
Start station | 0 | Board the Blue Line
Second station | 12 | Stay on this train
Transfer station | 12 | Change to the Green Line | transfer
Destination | 12 | Use the north exit
```

Only the explicit `transfer` marker pauses for another boarding tap. Instruction text alone does not change tracking behavior. Each instruction may contain up to 160 characters; avoid `|` within the text because it separates fields. The phone retains the full instruction; the glasses show at most three short instruction lines, with an ellipsis when needed. Route instructions, transfer markers, instruction-display events, and the current instruction are included in JSON exports.

Departure has its own settings: a 500 ms average of phone gravity-removed acceleration magnitude, a 0.35 m/s² threshold sustained for 0.7 seconds, and direction consistency of at least 0.50. Both presets use these original departure settings. Normal braking defaults also use a 500 ms window, a 0.35 m/s² threshold held for 0.8 seconds, and a 0.18 m/s² quiet threshold held for 3 seconds. Short demo **braking** uses a 250 ms window, a 0.35 m/s² threshold held for 0.4 seconds, a 0.25 m/s² quiet threshold held for 0.25 seconds, and a six-second veto. Direction consistency is the magnitude of the average vector divided by the average vector magnitude; alternating vibration tends to cancel. Settings are adjustable under the timing/detection controls, with separate departure and braking fields. Braking-like motion followed by quiet suggests a possible arrival. Quiet readings cannot distinguish a stopped train from one moving at steady speed; the expected travel time and correction controls remain necessary. No glasses-based noise cancellation or calibrated confidence is claimed.

Either sign on any phone axis can provide the initial jolt. Keep the phone secured relative to your body. Recoil and other settling movements can happen, but no direction reversal is required. Continued motion prevents quiet dwell; a missing sensor stream resets evidence. A jolt that does not settle into quiet expires after the greater of 12 seconds or the configured settling + dwell + 4 seconds. The glasses and phone show the current phase; JSON logs include `braking-jolt`, expiry, and arrival-candidate evidence.

For an end-to-end trial, use the short demo: simulate departure, a jolt before the 10-second gate that should be ignored, a later lean/jolt, then stillness through settling and dwell. Shift the phone during the correction countdown to confirm the proposal remains pending. Repeat with an explicit veto, a delayed arrival, and a second segment. Labels only annotate recordings; changing a label never triggers detection. Missing linear-acceleration channels, sample gaps over 500 ms, and page hiding reset accumulated evidence; missing events never substitute for quiet. Screen-lock/background operation remains unsupported for this experiment.

The pure state machine is covered by `dev/station-tracker.test.mjs`; with Node 24 run `node --test dev/station-tracker.test.mjs`.

## What the dashboard shows

- Three raw G2 SDK channels, X/Y/Z. Units and physical meaning are deliberately unspecified.
- Optional Android phone `devicemotion` events: acceleration, acceleration including gravity, rotation rate, and browser-reported event interval when available. G2 and phone streams share the WebView receipt clock and are stored separately in the recording.
- A shared-scale G2 plot of the last 15 seconds, per-axis min/max/mean/standard deviation, and presence counts. Auto scaling can exaggerate very small noise; always read the range/numbers.
- A comparison plot of G2 vector magnitude and phone linear / gravity-inclusive acceleration magnitude. It compares receipt timing and magnitude, not direction: the devices use different axis frames. Missing browser fields remain null.
- Measured WebView receipt rate and largest interval within the plot window. P100-P1000 are protocol pacing selections, not asserted Hz. Stop the stream before changing pace.
- Optional subtraction of a captured two-second mean for visual comparison. This is a display offset, not gravity removal or calibrated acceleration. It never changes raw exports.
- A live glasses-layout preview. Boarding uses 3 visible containers, tracking/approach 4, and destination 2, plus one empty gesture layer. Writes are serialized, and phase changes discard unsent obsolete content. Detection and tap meanings are unchanged.
- Explicit stale-stream feedback. After reconnect/resume use Stop/Start if needed; sensor continuity is not assumed.

Missing/nonfinite channels remain null in JSON and blank in CSV, not invented zeros. Valid zero values are retained. The SDK may normalize the native payload; these are SDK-delivered channels, not direct access to sensor registers. Phone browser motion events require a secure context in many implementations, may require host permission, and may be missing from this WebView. The normal QR command below serves plain HTTP from the laptop LAN, so Android may withhold phone sensor readings even though the glasses IMU works. The dashboard reports secure-context status and unavailable fields. Foreground events do not establish lock-screen continuity.

## Glasses layout

For screen-off work, use the new **Screen-lock diagnostic** on the phone. It measures phone acceleration, JavaScript execution, glasses bridge writes and taps separately while locked, and saves the report for JSON export. It does not yet enable background tracking. See [the investigation and test procedure](docs/screen-lock.md).

The 576 x 288 riding display concentrates the journey in a narrow rail on the right, leaving the center and most of the left side clear. It shows LAST (the last confirmed or provisionally detected station), NEXT STATION, and GET OFF AT / TRANSFER AT at a fixed lower position. Only LAST has a filled circle; future stops have hollow circles. Dotted rail segments indicate hidden stops between NEXT and the endpoint. At the final hop, NEXT / GET OFF or NEXT / TRANSFER merges the duplicate endpoint labels. Each label/name and the N STOPS LEFT count aligns independently to the rail's left edge. The count reaches the current ride endpoint, so it counts down to a transfer before resetting on the next train.

Rail labels use fixed rows with 4-pixel internal padding and a 28-pixel line estimate. Text is shortened using browser canvas measurements; native G2 font metrics are unavailable, so physical fit still needs checking. Full station names remain on the phone. Boarding, destination, and bottom-left status retain 10-pixel padding and corner alignment. Custom 24 x 24 pixel icons identify boarding, transfer, exit, microphone, confirmation, and route-preparation states. The rail is two 20 x 112 grayscale PNG tiles to fit the SDK's maximum image height. Text stays native and readable independently of image upload success.

Boarding shows the station, train/direction, and Tap once aboard. After tapping, train instructions disappear and the stop rail appears. Its window advances when arrival is detected; it does not estimate movement or distance between stations. Transfers immediately preview the next boarding directions, and the destination previews arrival/exit guidance. TAP IF NOT AT [detected station name] and the remaining seconds appear at bottom left during the correction window. A tap restores the previous window/count and starts the existing cooldown. No tap finalizes the arrival after the configured window (currently 20 seconds in both presets), with fresh sensor data still required. Transfer boarding stays disabled until confirmation. A sensor gap also cancels the preview. Detector behavior and internal export names are unchanged.

Live plans use the supplied train destination/headsign for direction; they do not invent uptown/downtown labels or platform/track numbers. Transfer walks use the next train's actual boarding station, which can differ from the station where you got off. Long text is shortened on the glasses; full route instructions remain on the phone. The built-in NYC demo supplies explicit downtown directions.

Close and reopen after updating the app. Geometry changes use `rebuildPageContainer`; same-size text updates use `textContainerUpgrade`, and changed graphics use `updateImageRawData`. Writes are serialized and unchanged graphic payloads are cached so countdown ticks do not repeatedly upload images. Failed graphics retry without blocking microphone startup or native text. One empty text container captures gestures; images do not capture events. Physical G2 checks are still needed for image transfer, font fit, scrollbars, and transition timing.

The phone preview reflects the same rail graphics and native text. [Current illustrative screens](docs/glasses-rail-preview.png) show boarding, a long stop window, the final hop, and a detected arrival. These are approximate font renders, not hardware captures. Relevant checks: `node --test dev/glasses-view.test.mjs dev/station-tracker.test.mjs dev/routing.test.mjs`.

## First axis-identification experiment (about five minutes)

1. Label **still**, record ten seconds facing forward. Capture a baseline if useful.
2. Label **turn head left/right**; rotate left, hold five seconds, return to center, then repeat right. Tap at each transition.
3. Label **nod up/down**; repeat with looking up/down and holding each pose.
4. Label **tilt ear to shoulder**; repeat side tilts.
5. Keep the glasses level and translate forward/back, left/right, then up/down, stopping between motions. Moving the glasses by hand can help isolate translation from rotation. Mark each direction and return.
6. Repeat a movement facing sideways. Compare which channel changes and whether values stay changed while the pose is held.
7. Export the JSON and note your phone OS, G2/Even app versions, starting pose, movement order and approximate sizes.

A held change during rotation could be orientation or gravity-sensitive acceleration; it is not conclusive. Brief translation spikes may support acceleration, but do not establish units. Do not label an axis train-forward or convert to g/m/s² until measurements justify it. If outputs describe orientation only, this API may not expose the translational acceleration needed for the subway detector.

For a comparison session, confirm the phone status says secure context before enabling motion. The Android localhost tunnel uses `adb reverse tcp:5173 tcp:5173`; keep USB connected and Vite running. If it still reports an insecure context, verify the URL is exactly `http://localhost:5173` (not the laptop IP) and reload through Even's development flow. If secure context is true but fields stay blank, check Android/WebView motion permission and API support; do not interpret blanks as zero acceleration. Once fields arrive, enable phone motion and start G2 IMU, then begin recording. Compare phone-only movement, glasses/head-only movement, and movements affecting both. For a train simulation use departure/cruising/braking/dwell labels and independent markers. A tap marks the time you tapped, not exact physical arrival. Start with short sessions and export often. Test screen lock separately; continuity is unknown.

## Data and export

Recordings remain **in page memory** until exported. Reload/exit/crash may lose them; Clear recording asks for confirmation. Recording automatically stops at 100,000 samples. Plot history is bounded separately.

JSON contains separate G2 samples and phone-motion events, ISO UTC wall times, monotonic receipt milliseconds since page initialization, per-sample labels, explicit markers, stream requests/device events, secure-context status, and metadata. CSV merges both streams by WebView receipt time with source labels and separate columns. Values are recorded at event receipt, not sensor acquisition timestamps. Exports snapshot the recording at click time; stop recording first for a final capture.

Some phone WebViews block downloads. Press Export JSON/CSV to prepare a snapshot, then choose a save method; preparation alone does not save a file:

- **Save to laptop** (recommended during development): sends the prepared snapshot to the same Vite server and writes it into this project's `recordings/` folder. Wait for the saved filename confirmation. Restart Vite after installing this update. This endpoint is development-only and requires the phone to reach the laptop.
- **Share / Save to Files**: opens native file sharing if the phone/WebView supports it. Choose a destination such as Files.
- **Copy export text**: copies the snapshot where clipboard access is allowed; otherwise selects it for manual copying into Notes or a text file.
- **Try download**: retains the ordinary file-download link for browsers that support it.

Export feedback stays next to the save controls, separate from sensor status. Save to laptop is an explicit local upload; recordings are not sent to a cloud service. Check a short recording before taking a long ride. Do not refresh a page with an unsaved recording. Browser storage persistence and remote live laptop viewing are not implemented.

## Synthetic preview and build

- `http://localhost:5173/?demo=1` explicitly selects generated test values. Press Start IMU. The banner and JSON identify synthetic data. It validates controls/plot/export, not hardware.
- `npm run simulate` can preview the UI, but physical IMU behavior must be tested on G2. No fake readings are substituted in live mode.
- `npm run build` performs strict type checking and Vite production build.
- `npm run pack` builds and packages the diagnostic for installed-device testing.

The manifest retains the template package ID and permissions. The current same-origin planner runs through Vite or the standalone server; packaged Even Hub deployment still needs backend connectivity and phone-motion validation. Choose a project identity before publication. See context/ for the product scope and remaining sensor/lifecycle tasks.
