# AlwaysOnTrack

**A glasses-first NYC subway companion for Even Realities G2 and an Android phone.** Tell it where you are and where you want to go, confirm the places it understood, and receive boarding, station, transfer, and arrival prompts on the glasses.

AlwaysOnTrack combines speech recognition and an AI trip-planning agent with Google Maps routing, MTA subway schedules, and an experimental phone-motion station counter. The display stays quiet while riding: a small station rail shows the last stop, next stop, ride endpoint, and stops remaining until your transfer or destination.

This repository is a working hackathon MVP, developed and tested with physical G2 glasses and an Android phone. It also includes a minimal mobile dashboard, a glasses-layout preview, and the original diagnostic dashboard for sensor experiments and manual recovery.

## What it does

1. **Listen:** tap the glasses and say both your starting location and destination. Tap again to submit.
2. **Understand:** transcribe the recording, extract the two locations, and resolve names and landmarks through Google Places.
3. **Confirm:** select between matching places when necessary, then review the origin and destination on the glasses. Scroll between Yes and No; tap to select.
4. **Plan:** request subway routes from Google Routes and expand each train ride into an ordered station list using MTA schedules. Load a route only when its station sequence can be resolved.
5. **Board:** show the boarding station, train line, and direction. Tap once aboard to arm tracking.
6. **Track:** detect departure using the phone's acceleration, wait through most of the expected segment time, then watch for motion followed by quiet that could indicate arrival.
7. **Correct:** immediately show the proposed station and updated directions, with time to tap if you are not at that station.
8. **Transfer or finish:** at a transfer, board the next train and tap to restart the ride loop. At the final station, show arrival and general exit-sign guidance.

Typed route search, prepared-trip JSON import/export, a built-in NYC demonstration, and manual station correction are available as alternatives to speech planning.

## How the pieces fit together

| Component | Responsibility |
| --- | --- |
| G2 glasses | Microphone input, taps/scrolls, and the rider-facing display. |
| Android phone / Even app | Runs the web application, connects to G2 through the Even SDK, and supplies phone motion events. |
| Local Node server | Keeps API credentials off the client; handles speech, agent requests, place lookup, routing, and schedule matching. Vite provides this backend during development. |
| Groq, the default AI provider | Whisper transcription and an agent that extracts trip intent and recommends among resolved routes. |
| Google Places API (New) | Resolves spoken locations into names, addresses, and place IDs. |
| Google Routes API | Supplies transit alternatives, train endpoints, line/direction information, and reported stop counts. |
| Local MTA GTFS catalog | Supplies intermediate stations and scheduled inter-station travel times needed by the tracker. |

The AI does not invent station sequences or make live arrival decisions. Route matching and motion tracking use application code. **G2 IMU readings are available for diagnostics but do not drive station counting.**

The USB cable in the setup below forwards the phone's localhost requests to the laptop. The glasses remain paired with the phone through the Even app. There is no separate native Android companion app in this repository.

## Requirements

### Hardware and software

- Even Realities **G2 glasses**, paired and working in the Even Realities Android app.
- An **Android phone** whose Even app WebView exposes usable gravity-removed device acceleration. iOS has not been validated for this project.
- A laptop or desktop with **Node.js 24**, npm, and this repository. Use Node 24 for the backend and tests, which import TypeScript source directly.
- [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools), including `adb`.
- A USB cable that supports data, with USB debugging enabled on the phone.
- Access to the Even app's developer loading flow. See the official [Even Hub developer setup](https://hub.evenrealities.com/docs/getting-started/installation) and [Even Hub support guide](https://support.evenrealities.com/hc/en-us/articles/15688149217167-Even-Hub) for registration and app-side access.

The walkthrough uses Windows PowerShell. On macOS/Linux, use the equivalent file-copy command and run `adb reverse` directly instead of the Windows helper script.

### Choose a setup path

| Goal | API keys | MTA import | Physical hardware |
| --- | --- | --- | --- |
| Inspect the mobile UI and built-in demo in a desktop browser | None | Not needed | Not needed; glasses connection and real phone sensing are unavailable. |
| Demonstrate station tracking on your phone and G2 using the built-in route | None | Not needed | Android + G2 required. |
| Use typed Google/MTA route search | Google Maps | Required | Optional for planning; required for the complete glasses experience. |
| Use the complete spoken trip-planning experience | Google Maps + Groq, or the optional Gemini provider | Required | Android + G2 required for glasses microphone input. |

Internet is required for dependency installation, downloading schedules, and online trip preparation. Once loaded, the route and detection logic live in the phone page; tracking does not request a provider on every stop. This is not a fully packaged offline application.

## 1. Install the project

Clone or download this repository and open a terminal in its root directory. Then run:

```powershell
node --version
npm ci
Copy-Item .env.example .env.local
```

`node --version` should report Node 24.x. If `.env.local` already exists, preserve its values instead of copying over it.

For the no-key demo, you can leave credentials blank and skip to **Connect your Android phone and G2**. For real route planning, complete the next two sections first.

## 2. Configure speech and routing services

Edit `.env.local` on the computer running the server. A full setup using the default Groq provider needs these values:

```dotenv
GOOGLE_MAPS_API_KEY=your_google_maps_key
MTA_GTFS_CATALOG=data/mta-subway.json

AI_PROVIDER=groq
GROQ_API_KEY=your_groq_key
GROQ_STT_MODEL=whisper-large-v3-turbo
GROQ_AGENT_MODEL=openai/gpt-oss-120b
```

These are placeholders, not working credentials. Keep actual keys in `.env.local`, which is ignored by Git. Do not give them a `VITE_` prefix: Vite-prefixed environment variables can be exposed to browser code.

### Google Maps

Create or select a Google Cloud project, configure billing, and enable both:

- **Routes API**, following Google's [Routes setup instructions](https://developers.google.com/maps/documentation/routes/get-api-key).
- **Places API (New)**, following Google's [Places setup instructions](https://developers.google.com/maps/documentation/places/web-service/get-api-key).

Set `GOOGLE_MAPS_API_KEY` to a server-side API key allowed to call these services. If using API restrictions, allow both services. Browser HTTP-referrer restrictions are not appropriate for these backend requests.

Places uses the same key by default. To use a different key for place lookup, set `GOOGLE_PLACES_API_KEY` as well.

### Groq

Create an API key using the [Groq quickstart](https://console.groq.com/docs/quickstart), then set `GROQ_API_KEY`. The repository defaults to `whisper-large-v3-turbo` for speech and `openai/gpt-oss-120b` for agent work. Your account must have access to the configured models; model names are configurable in `.env.local`.

### Optional Gemini provider

The backend also supports `AI_PROVIDER=gemini` with `GEMINI_API_KEY` and `GEMINI_MODEL`. Choose a model available to your own account; the value in `.env.example` is configuration, not a guarantee of current provider availability. Gemini is optional when using Groq. There is no automatic provider fallback or retry loop.

### Usage and costs

Google Maps billing is separate from the AI provider's usage. Quotas, model access, and charges depend on your accounts; check their consoles before a demo. Loading the app performs local readiness checks, not a paid trip request. Recording/submitting and planning a trip invoke external services.

The glasses preparation flow normally makes one transcription request, one agent intent request, and two Places searches. Confirming Yes then makes a Routes request and an optional AI recommendation request. Changing the selected place does not repeat its Places search.

**Restart the development or standalone server after changing environment values.**

## 3. Import MTA subway schedules

For generated routes, run:

```powershell
npm run gtfs:import
```

This downloads the official MTA supplemented GTFS ZIP and builds `data/mta-subway.json`. The generated catalog is excluded from Git, so a fresh checkout must create it locally. Importing can take several minutes and produce a large file; allow time, disk space, and memory for it.

If the automatic download fails, download **Supplemented GTFS** from [MTA developer resources](https://www.mta.info/developers), then import the ZIP:

```powershell
npm run gtfs:import -- "C:\path\to\gtfs_supplemented.zip"
```

A second argument can specify a different output path. If you use one, update `MTA_GTFS_CATALOG` to match it. Restart the server after importing or replacing the catalog.

Refresh the catalog before demonstrating live route preparation. It contains schedules, station coordinates, lines, trip patterns, and service calendars. **Live delay feeds, train positions, and verified exits/platform paths are not integrated.**

Google's train legs do not contain the full intermediate station list this tracker needs. The backend matches them to active MTA schedules using line, endpoints, stop count, station sequence, and timing. If it cannot resolve a consistent sequence, it rejects the route rather than generating missing stops. See [routing details](docs/routing.md).

## 4. Connect your Android phone and G2

### Authorize the computer

1. Pair G2 with the Even Realities app and verify the glasses work normally.
2. Install Android Platform-Tools on the computer. Add its `platform-tools` directory to `PATH`, or configure `ANDROID_SDK_ROOT` for the Windows helper.
3. Enable Android **Developer options** and **USB debugging**. Connect the phone with the data cable, unlock it, and accept the computer's debugging authorization prompt. See the official [ADB setup guide](https://developer.android.com/tools/adb).
4. Check the connection:

```powershell
adb devices
```

Your phone should appear with status `device`, not `unauthorized` or `offline`.

### Forward localhost to the laptop

On Windows, from the repository root:

```powershell
npm run dev:phone
```

This helper finds ADB and runs the port forwarding. It does not start the app server. You can also run the forwarding directly on any supported desktop OS:

```powershell
adb reverse tcp:5173 tcp:5173
```

If several devices are connected, select yours explicitly with `adb -s YOUR_DEVICE_SERIAL reverse tcp:5173 tcp:5173`.

**Why localhost matters:** Android can block device-motion events on an ordinary LAN HTTP URL such as `http://192.168.1.10:5173`. The forwarded `http://localhost:5173` address provides the secure-context setup used by this project's working phone-motion flow. Opening a LAN address and seeing the page load does not establish that motion sensors will work.

### Start the server and open the app

In one terminal, keep this running:

```powershell
npm run dev
```

Check that Vite is listening on **port 5173**. If it chooses another port because 5173 is occupied, resolve the conflict before continuing: the forwarding and app manifest currently expect 5173.

In a second terminal, generate the development QR:

```powershell
npx evenhub qr --url http://localhost:5173
```

In the Even app, use its **Developer Center** scanner/development loading flow to open that QR. Grant glasses microphone access when requested. The app should open on the phone and the spoken-trip prompt should appear on G2.

Use the Even app's loader for hardware testing. Opening the same URL in Chrome gives you a web preview without the G2 SDK bridge.

Keep the cable attached, the laptop server running, and the phone screen on with the app visible. Repeat the ADB forwarding after a reconnect if necessary. Screen locking can leave the glasses connected while stopping the phone acceleration stream, which prevents reliable tracking.

## 5. Run a first hardware demo without API keys

This checks the display, phone motion, boarding loop, transfers, and arrival corrections before involving external services.

1. On the mobile dashboard, expand **Demo controls** and choose **Load the NYC demo**.
2. Enable **Phone motion** if it is off. Confirm its status becomes live while moving the phone slightly. Do not confuse this with the separate G2 IMU controls in Lab.
3. The preset boards a downtown N train at Times Sq-42 St, transfers at 34 St-Herald Sq to F, then continues via 23 St to 14 St. These are illustrative instructions with **12-second simulated segments**, not a verified current travel recommendation.
4. Tap the glasses once as though you have boarded. The detector now waits for departure motion.
5. Move/lean the phone with a sustained motion to simulate departure. If needed, use **Mark departure now** in Demo controls to start the segment timer manually.
6. Wait until arrival detection opens. With a 12-second segment, the gate opens at `floor(12 × 0.9) = 10` seconds after detected departure.
7. Simulate a braking jolt, then hold the phone still. If the motion meets the configured rules, the display proposes arrival and immediately shows the new station/directions.
8. During the correction window, tap only if you are **not** at the named station. Otherwise, let the countdown finish. A boarding tap during this window rejects the arrival; wait for it to finish before arming the next train.
9. At the transfer, tap again once aboard the next train. Ordinary intermediate stops continue through the departure/arrival loop without another boarding tap.

There is no built-in route silently preloaded on startup. Choose the demo explicitly. The mobile **Set current station** control can recover from a missed or accidental detection.

## 6. Plan a spoken trip

With credentials and the MTA catalog configured:

1. Start at the glasses prompt: tap to record, then state both endpoints, for example, “I'm at Macy's Herald Square and I want to go to Times Square.”
2. Tap again to submit. Recording also ends at 30 seconds. The display changes to **Understanding intent**.
3. If several places match, scroll through the candidates and tap the intended result. Confirm the displayed origin and destination: scroll to Yes or No, then tap. No returns to the initial recording prompt.
4. Yes opens **Planning your route**. A resolved Google/MTA itinerary loads into the boarding screen automatically.
5. Follow the boarding instruction and tap once aboard. Phone motion is enabled automatically when supported; verify that it is live on the dashboard.
6. Follow the same tracking, correction, and transfer loop as the hardware demo.

Use specific landmarks, intersections, or station names. “42nd Street to 22nd Street” is ambiguous and does not uniquely identify either endpoint. A request that has no supported subway itinerary can be rejected even if a walking route exists.

**Demo timing is enabled by default.** The mobile Demo controls checkbox, **Use 12-second station segments**, controls newly loaded generated plans. Turn it off **before planning/loading** to use provider schedule estimates. Changing it does not rewrite a route that is already loaded. The original provider itinerary retains its schedule data when demo timing is used.

The system assumes you begin at the first boarding station and board the instructed train. It does not independently locate you, check the train you entered, or navigate indoor station corridors.

## Mobile dashboard and Lab

The default mobile screen focuses on:

- **Glasses view:** a reconstruction of the app's display layout, including text, rail, and pixel icons. On a connected session it retains the last fully acknowledged update and identifies pending or failed sends. It is not a camera capture; native font appearance can differ.
- **Right now:** the current instruction and an action appropriate to the state, such as record, submit, confirm, board, or reject an arrival.
- **Stops remaining:** stops until the current train's transfer or destination.
- **Phone motion:** off/waiting/live/paused feedback and enable/restart controls.
- **Demo controls:** simulated timing, built-in route, manual departure, station correction, and stop tracking.

**Lab** opens the original dashboard without reloading or losing the session. **Back to mobile view** returns. To open directly in Lab, use `http://localhost:5173/?view=lab` in the development QR.

Lab contains typed route planning, prepared-trip JSON import/export, detector settings, motion plots, G2 IMU tools, labeled recordings, and the screen-lock diagnostic. See [mobile dashboard details](docs/mobile-dashboard.md).

The glasses monitor belongs to the phone session. Opening the URL on your laptop starts a separate instance; it does not remotely mirror the phone's session.

### Manual routes and saved plans

In Lab, a simple route uses one line per station:

```text
Starting station | 0 | Board the indicated train
Intermediate station | 12 | Stay on this train
Destination station | 12 | Follow exit signs
```

Each duration is the expected travel time **from the previous station**, in seconds. The first station uses zero. Add `| transfer` as a fourth field at an intermediate transfer stop. Manual routes support 2–50 stations; they have no provider verification.

Prepared-trip JSON preserves the richer walking/train-leg structure and source information. See the [trip format and import/export guide](docs/routing.md). Plans and active tracking are held in page memory; **export before reloading or closing if you want to keep a plan**. Automatic session restoration is not implemented.

### Sensor recordings

Use Lab to start G2 IMU capture and/or phone motion, start a labeled recording, then stop and export JSON/CSV. This is for diagnostics; starting the glasses IMU is unnecessary for station counting.

During `npm run dev`, **Save to laptop** sends the recording to the Vite development server and writes it into the laptop's `recordings/` directory. It does not rely on the phone downloading a file. That upload endpoint is not included in the standalone `npm start` server. Export recordings before closing the page; they are not automatically persisted.

## How station detection works

The detector uses the Android device-motion event's gravity-removed acceleration in m/s². It evaluates a rolling motion window and directional consistency rather than assuming a fixed phone axis. It does not infer train speed from a quiet accelerometer.

1. **Boarding:** a tap arms the first ride or the next ride after a transfer.
2. **Departure:** sufficient sustained phone motion starts the segment timer.
3. **Time gate:** arrival detection stays blocked until `floor(0.9 × expected segment seconds)` after departure. Time alone never advances a station.
4. **Arrival evidence:** a coherent motion event, a short settling interval, and a quiet dwell propose the next station. Recoil is not required.
5. **Correction window:** directions advance provisionally. A tap restores the prior position; otherwise the arrival commits. Moving the phone during the window does not cancel the proposal. A sensor gap can cancel it because continued sensing is no longer established.
6. **Repeat:** ordinary stops await another departure. A transfer awaits a new boarding tap. The final stop retains arrival/exit guidance.

Current short-demo settings are defined in [src/station-tracker.ts](src/station-tracker.ts):

| Setting | Demo value |
| --- | --- |
| Departure motion threshold / sustained duration | 0.35 m/s² / 0.7 seconds |
| Arrival motion threshold / sustained duration | 0.35 m/s² / 0.4 seconds |
| Arrival settling interval | 0.3 seconds |
| Quiet threshold / dwell | At or below 0.25 m/s² / 0.25 seconds |
| Arrival correction window | 20 seconds |

These thresholds apply to processed rolling-window evidence, not a single raw sample. Lab exposes the settings and detection log. The normal preset uses longer arrival durations; the short preset is designed for an in-person demonstration.

## Build, test, and package

Run commands from the repository root with Node 24:

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked dependencies. |
| `npm run dev` | Start Vite with the local speech, agent, routing, and recording-upload endpoints. |
| `npm run dev:phone` | Windows ADB localhost-forwarding helper; does not start Vite. |
| `npm run gtfs:import` | Download/import the MTA schedule catalog. |
| `node --test dev/*.test.mjs` | Run automated tests; fixtures do not require API keys or paid requests. |
| `npm run build` | Type-check and build the frontend into `dist/`. |
| `npm start` | Serve `dist/` and the speech/agent/routing backend; defaults to port 5173 and loads `.env.local`. |
| `npm run preview` | Preview frontend build assets; does not provide the complete companion backend. |
| `npm run simulate` | Launch the Even Hub simulator against the running development URL. |
| `npm run pack` | Build and package an Even Hub bundle using `app.json`. |

To run the built app instead of Vite:

```powershell
npm run build
npm start
```

Stop Vite first so the servers do not compete for port 5173. Retain `.env.local` and the generated MTA catalog on the server. The same ADB/QR setup can target this local server, but development-only recording uploads are unavailable.

Automated tests cover detector transitions, schedule matching, provider contracts, audio handling, preparation flow, and UI state. They do not replace physical G2 checks or establish real-train accuracy. With Vite running, `/dev/mobile-ui.browser.html` also exercises the mobile layout and fallback controls without paid calls.

### Wireless and deployment status

For an installed private beta with the full AI pipeline, follow [Even Hub beta setup](docs/evenhub-beta.md). The laptop can use your phone's hotspot and run the backend behind an HTTPS tunnel. `beta:configure`, `beta:pack`, and `beta:serve` configure the remote API, generate a matching network whitelist/package, and run a token-protected API-only backend. Physical beta validation of microphone and phone motion is still required.

To remove the laptop dependency, a Free Render deployment configuration and local resource preflight are available. See [Render hosting checks and setup](docs/render-hosting.md) for measured memory use, deployment secrets, and free-tier cold-start limits. A real Render deployment must still be checked before using it for a demo.

The ordinary development manifest permits `http://localhost:5173` and retains a template package ID; the beta script writes a separate manifest in `release/`. Hosting only `dist/` or installing an `.ehpk` does not provide the Node backend. Beta upload/invitations still take place in your developer account. This shared-token beta is intended for invited demo testers, not public production distribution.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `adb` is not found | Install Platform-Tools and add its directory to `PATH`; on Windows the helper also checks the Android SDK environment variables and default SDK location. Restart the terminal after changing `PATH`. |
| Phone is `unauthorized` or missing | Unlock it, accept the USB debugging prompt, check USB debugging and the data cable, then run `adb devices` again. |
| Page does not load on the phone | Keep the server running, verify port 5173, and repeat `adb reverse tcp:5173 tcp:5173`. Ensure you opened the localhost QR. |
| “Not a secure context” / no phone motion on LAN HTTP | Use the documented forwarded localhost URL. Ordinary LAN HTTP is insufficient for this sensor flow. |
| Phone motion stays waiting or paused | Keep the page visible and screen on, move the phone, and use Enable/Restart phone motion. Confirm the WebView exposes gravity-removed acceleration. Connected glasses alone do not establish phone sensor availability. |
| Mobile page opens but G2 remains blank / preview only | Load through the Even app developer scanner, verify G2 pairing, and reopen the app. A desktop or ordinary browser has no G2 bridge. For a startup-page error, capture the exact error; native display validation can fail independently of pairing. |
| Voice/route setup says a service is unavailable | Check `.env.local`, restart the server, and check the local readiness endpoints below. Full voice planning needs AI, Places, Routes, and the imported catalog. |
| Google rejects a request | Verify billing, enabled Routes and Places API (New), and server-compatible key restrictions. Check the server error without sharing the key. |
| AI returns 429 or 503 | 429 indicates a quota/rate-limit issue; inspect provider usage and wait or change to an available configured model/provider. 503 indicates temporary service unavailability. Repeated submission can consume more quota. |
| “No fully resolved NYC subway itinerary” | Refresh the MTA feed, use precise endpoints, and try another route/time. Google and MTA schedules can disagree; the matcher deliberately rejects ambiguous or incomplete stop sequences. |
| Trip still shows an old or demo route | Complete place confirmation and route planning, or explicitly load the intended route. A rejected request does not substitute a new demo itinerary. |
| Arrival is detected too early for a real trip | Check whether 12-second demo timing was enabled when the plan loaded. Turn it off before loading a new plan to use schedule durations. |
| Tap seems to undo a transfer arrival | During the correction countdown a tap means “not at this station.” Wait for it to finish before tapping to board the next train. |
| Save to laptop is unavailable | Use `npm run dev` for the recording upload endpoint. The standalone server serves planning APIs but not that development feature. |
| A reload lost the route | Session restoration is not implemented. Import an exported plan or prepare/load it again. |

Local readiness endpoints, available while the server runs:

- `http://localhost:5173/api/agent/status` — selected AI provider/model configuration, without returning keys.
- `http://localhost:5173/api/trips/status` — routing key/catalog readiness and catalog information.

A ready status means configuration is present; it does not prove the provider accepts a key or that a particular journey resolves. Verify a complete spoken request and confirmed route before presenting.

## Current limits

- **Hackathon motion detector:** demonstrated with simulated seated movement, not validated for dependable real-train station counting. Pocket/bag movement can still produce misleading evidence.
- **Screen-on operation:** the screen-lock experiment retained some app/glasses activity but lost usable phone acceleration. No Android foreground service, background-sensing guarantee, or automatic keep-awake feature is included. See [screen-lock findings](docs/screen-lock.md).
- **NYC subway scope:** the imported catalog and matcher target MTA subway service. This is not a general bus, commuter-rail, or worldwide transit navigator.
- **Schedule estimates:** no live-delay integration or independent proof that the rider is on the right train. Follow actual service information and station signs.
- **General exits:** no verified street-exit or platform routing; the final instruction is “Follow exit signs.”
- **Memory-only sessions:** reloads discard active tracking and plans unless you exported a plan. Recording exports are also manual.
- **Online preparation:** provider access and the companion backend are required for new voice-generated routes. Audio is sent to the selected speech provider; trip text and route information are sent to the configured planning services.

## Repository guide

| Path | Contents |
| --- | --- |
| `src/main.ts` | App startup, Even bridge, sensors, shared state, and display updates. |
| `src/mobile-ui.ts`, `src/mobile-view.ts` | Minimal mobile dashboard and phase-specific actions. |
| `src/glasses-view.ts`, `src/glasses-art.ts`, `src/glasses-native.ts` | Glasses layouts, pixel graphics, previews, and native container projection. |
| `src/glasses-planner.ts`, `src/asr/` | Glasses preparation flow and speech capture. |
| `src/station-tracker.ts`, `src/trip-ui.ts`, `src/trip-status.ts` | Motion state machine, settings, Lab controls, and journey presentation. |
| `src/trip-plan.ts` | Prepared-trip schema, validation, and mapping to tracker stops. |
| `server/` | Backend APIs, AI providers, place resolution, Google routing, and MTA matching. |
| `scripts/` | MTA importer and Android development helpers. |
| `dev/` | Automated tests and development browser checks. |
| `data/` | Local generated schedule catalog; not bundled in a fresh clone. |
| `recordings/` | Sensor experiments and development recording exports. |
| `context/` | Product scope, build tasks, and project planning documents. |
| `app.json` | Even Hub manifest, permissions, and package metadata. |

Further implementation notes: [routing and trip JSON](docs/routing.md), [speech and agent flow](docs/voice-agent.md), [mobile dashboard](docs/mobile-dashboard.md), and [screen-lock investigation](docs/screen-lock.md).
