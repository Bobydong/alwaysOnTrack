# AlwaysOnTrack: G2 subway companion prototype

An Even Hub G2 and Android phone prototype for testing route-aware subway station prompts. It includes an IMU explorer for understanding device motion and an experimental station counter that uses Android phone motion with a manually supplied route. The unused ASR interface/stub from the Even Hub scaffold remains in `src/ui.ts` and `src/asr/stt.ts`. No microphone or cloud service is used.

## Project status

The current hackathon demo flow is working on the developer's G2 and Android test setup. The station counter can follow a sequence of named stops, detect a simulated departure and a braking-like arrival, ask the rider to veto a proposed arrival, and advance to the next stop. The timing and thresholds are exposed in the short demo preset. This is a prototype for testing the interaction and motion rules; its thresholds have not been validated on real train journeys.

Completed in the current prototype:

- G2 IMU exploration with live X/Y/Z values, plots, summary statistics, movement labels, and JSON/CSV export.
- Optional Android phone motion capture and side-by-side comparison with G2 readings.
- A route editor for entering the current stop, later stops, and expected time between each pair. The app assumes the rider starts at the first listed stop.
- Tap-to-start tracking, phone-motion departure detection, and a segment timer that opens arrival detection after `floor(90% × segment duration)`.
- Arrival proposals based on phone acceleration, followed by a veto countdown. Phone movement during that countdown does not cancel the proposal; a single tap vetoes it. Missing phone sensor samples cancel it because the app cannot confirm tracking continued.
- Glasses and phone status messages for blocked detection, arrival watching, proposed arrivals, veto cooldowns, departure waiting, and trip completion.
- Manual station correction and manual departure controls for recovering during a demo.
- Timestamped detector events and current route/state/settings in the JSON export.

Still to do or validate:

- Route planning from origin to destination. Routes are currently entered manually; no Google Maps, transit, or other routing API is connected.
- Station-specific transfer, platform, and exit instructions. The prototype currently reports stop names and detector state.
- More motion recordings and threshold tuning, especially tests that compare ordinary seated movement with train departure and braking. The user reports the current demo transition works well; real-train reliability has not been established.
- Phone sensor behavior during screen lock, app backgrounding, reconnection, and longer trips. The current experiment assumes the page stays in the foreground.
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

## Experimental station counting

Enable phone motion over Android localhost/USB forwarding, then use the new station-counter panel:

1. Choose the three-minute example route or the responsive **12-second demo**. The demo preset makes braking more responsive while preserving the original departure sensitivity. Edit names and segment durations if desired. Each line after the first uses `station name | travel seconds from previous station`. Press **Load route, then tap glasses to start**.
2. **Single-tap the glasses to begin tracking**, or press **Start tracking (or tap glasses)** on the phone. The glasses show this instruction after the route loads. Motion does not start tracking before your tap. Arming starts raw recording automatically; the travel timer waits for departure. Keep the phone secured in one position and the page in the foreground. G2 IMU can also be started for comparison; its readings do not control the station count.
3. Sustained phone linear acceleration starts the segment timer. **Mark departure now** is an explicit recovery option if the detector misses your departure.
4. Arrival inputs remain blocked until `floor(90% × expected segment duration)` after departure. A 12-second demo segment opens at 10 seconds. Both screens show **Arrival inputs blocked / Detection opens in ...** until that gate opens, then **Arrival detection OPEN / waiting for jolt**. This countdown measures the input-block period. The expected time may pass without advancing the station.
5. After the window opens, a coherent **jolt**, a settling interval, and quiet dwell produces a proposed arrival. Recoil is not required. The demo requires a 250 ms mean of at least 0.35 m/s² for 0.4 seconds, allows 0.3 seconds to settle after the detected jolt, then checks for 0.25 seconds at or below 0.25 m/s². Normal settings use 0.5 seconds to settle and 3 seconds of quiet. The proposal stays on the glasses for an adjustable veto period (8 seconds normally, 6 seconds in demo). Single-tap the glasses or press **Veto arrival** to cancel. Phone motion during the veto period does not cancel the proposal, allowing for the rider shifting in their seat. The count advances at the end of the period if fresh sensor samples continue; a sensor gap cancels the proposal and requires a new jolt. Successful expiry advances the current station once and shows **Waiting for departure**.
6. After acceptance, the current station advances once. The next segment timer waits for a new departure. Use **Set current station** to fix a missed/extra count; correction resets the timer and waits for departure. If already moving, use **Mark departure now**. Veto enters an explicit 10-second cooldown: both screens show **Arrival vetoed / Detection paused**, all motion evidence is discarded, and a new jolt is required after the cooldown ends.
7. Stop recording and export **JSON** for raw streams plus the `tripTracking` route, settings, state and timestamped evidence/event log. CSV retains only sensor samples. **Stop tracking** stops the counter but leaves diagnostic recording running until you stop it. Clearing the diagnostic recording does not clear the trip log; reload only after exporting.

Departure has its own settings: a 500 ms average of phone gravity-removed acceleration magnitude, a 0.35 m/s² threshold sustained for 0.7 seconds, and direction consistency of at least 0.50. Both presets use these original departure settings. Normal braking defaults also use a 500 ms window, a 0.35 m/s² threshold held for 0.8 seconds, and a 0.18 m/s² quiet threshold held for 3 seconds. Short demo **braking** uses a 250 ms window, a 0.35 m/s² threshold held for 0.4 seconds, a 0.25 m/s² quiet threshold held for 0.25 seconds, and a six-second veto. Direction consistency is the magnitude of the average vector divided by the average vector magnitude; alternating vibration tends to cancel. Settings are adjustable under the timing/detection controls, with separate departure and braking fields. Braking-like motion followed by quiet suggests a possible arrival. Quiet readings cannot distinguish a stopped train from one moving at steady speed; the expected travel time and correction controls remain necessary. No glasses-based noise cancellation or calibrated confidence is claimed.

Either sign on any phone axis can provide the initial jolt. Keep the phone secured relative to your body. Recoil and other settling movements can happen, but no direction reversal is required. Continued motion prevents quiet dwell; a missing sensor stream resets evidence. A jolt that does not settle into quiet expires after the greater of 12 seconds or the configured settling + dwell + 4 seconds. The glasses and phone show the current phase; JSON logs include `braking-jolt`, expiry, and arrival-candidate evidence.

For an end-to-end trial, use the short demo: simulate departure, a jolt before the 10-second gate that should be ignored, a later lean/jolt, then stillness through settling and dwell. Shift the phone during the veto countdown to confirm the proposal remains pending. Repeat with an explicit veto, a delayed arrival, and a second segment. Labels only annotate recordings; changing a label never triggers detection. Missing linear-acceleration channels, sample gaps over 500 ms, and page hiding reset accumulated evidence; missing events never substitute for quiet. Screen-lock/background operation remains unsupported for this experiment.

The pure state machine is covered by `dev/station-tracker.test.mjs`; with Node 24 run `node --test dev/station-tracker.test.mjs`.

## What the dashboard shows

- Three raw G2 SDK channels, X/Y/Z. Units and physical meaning are deliberately unspecified.
- Optional Android phone `devicemotion` events: acceleration, acceleration including gravity, rotation rate, and browser-reported event interval when available. G2 and phone streams share the WebView receipt clock and are stored separately in the recording.
- A shared-scale G2 plot of the last 15 seconds, per-axis min/max/mean/standard deviation, and presence counts. Auto scaling can exaggerate very small noise; always read the range/numbers.
- A comparison plot of G2 vector magnitude and phone linear / gravity-inclusive acceleration magnitude. It compares receipt timing and magnitude, not direction: the devices use different axis frames. Missing browser fields remain null.
- Measured WebView receipt rate and largest interval within the plot window. P100-P1000 are protocol pacing selections, not asserted Hz. Stop the stream before changing pace.
- Optional subtraction of a captured two-second mean for visual comparison. This is a display offset, not gravity removal or calibrated acceleration. It never changes raw exports.
- A glasses display with raw values and recording status, updated at most twice per second without overlapping display writes.
- Explicit stale-stream feedback. After reconnect/resume use Stop/Start if needed; sensor continuity is not assumed.

Missing/nonfinite channels remain null in JSON and blank in CSV, not invented zeros. Valid zero values are retained. The SDK may normalize the native payload; these are SDK-delivered channels, not direct access to sensor registers. Phone browser motion events require a secure context in many implementations, may require host permission, and may be missing from this WebView. The normal QR command below serves plain HTTP from the laptop LAN, so Android may withhold phone sensor readings even though the glasses IMU works. The dashboard reports secure-context status and unavailable fields. Foreground events do not establish lock-screen continuity.

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

The app manifest has no microphone/network permission because this diagnostic uses neither service. It retains the template package ID; choose a project identity before publication. See context/ for the product scope and remaining sensor/lifecycle tasks.
