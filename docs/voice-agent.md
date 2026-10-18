# Gemini voice and trip planning

The new preparation flow accepts a short recording from the G2 microphone or a typed request. Gemini transcribes audio, asks for missing or ambiguous locations, requests Google Routes/MTA itineraries, and recommends one returned itinerary. The rider reviews and loads the route before tracking begins. The existing detector, boarding taps, transfers, and correction window remain in control during the trip.

## Setup

1. Create a Gemini API key in Google AI Studio and put it in `GEMINI_API_KEY` in `.env.local`. This is separate from `GOOGLE_MAPS_API_KEY`. Never prefix either key with `VITE_` or paste it into the phone UI.
2. `GEMINI_MODEL` defaults to `gemini-3.8-flash`; use a model available to your account that supports audio input and function calling. Model access and billing depend on the account.
3. Keep the existing Google Routes key and imported MTA catalog configured as described in [routing.md](routing.md).
4. Restart `npm run dev`, or rebuild and run `npm start` for the standalone backend. Reload the Even app page and grant glasses microphone permission if requested.

The app manifest declares `g2-microphone` and the local backend URL. For a deployed version, replace the localhost network-whitelist entry with the actual trusted HTTPS backend origin. Static hosting alone does not provide these API endpoints.

## Five-minute demo

1. Open **Plan a journey** on the phone. Press **Speak on glasses**, then say a specific origin and destination, for example: “I'm at Times Square. Take me to Union Square.”
2. Single-tap the glasses or press **Finish recording**. Recording also stops after 30 seconds. The microphone closes before the audio is submitted to Gemini.
3. Review or edit the transcript and press **Plan my trip**. Answer any clarification question by voice or text. A recording alone does not start a route search.
4. Review the returned train legs and stops. The agent's recommendation is marked, but loading is always explicit. The checked **Demo timing** option uses simulated 12-second station segments and the demo detector preset. Uncheck it to retain scheduled segment durations.
5. Load the itinerary, enable phone motion, board the indicated train, then single-tap to arm tracking. At a transfer, board the next train and tap again. Leave the phone screen on and the page visible.

The default NYC demo and manual search/import remain fallbacks if a provider or microphone is unavailable. Speech starts from the phone; while recording, the glasses tap finishes input instead of starting a trip. Voice preparation is unavailable during an active trip or screen-lock diagnostic.

## Boundaries and verification

- G2 audio is treated as SDK-provided 16 kHz mono PCM16 and wrapped in WAV. Recordings are bounded to 30 seconds, submitted for transcription, and not saved by this feature. Actual microphone audio and transcription still need a physical-device check after key setup.
- Cancel discards buffered audio and aborts an in-flight transcription request locally. It cannot undo a request already received by the provider. Losing page visibility cancels recording.
- Keys stay on the backend. Gemini receives audio for transcription, conversation text for planning, and verified route summaries for ranking. Do not include secrets in spoken requests.
- Each transcription makes one Gemini call. A clarification turn makes one; a route-planning turn makes up to two plus one Google Routes request. MTA matching uses the local catalog. Provider quotas and charges can apply; no requests are made merely by loading the page beyond local configuration checks.
- Only the backend's Google/MTA results populate the itinerary. Unsupported or ambiguous stop sequences are rejected. If recommendation fails after routes are verified, those routes can still be reviewed and selected. Platform numbers, detailed exits, and live delays are not inferred.
- Simulated timings change only the tracker's route durations. The original itinerary and source schedule provenance remain intact in the export.

Endpoints: `GET /api/agent/status`, `POST /api/agent/turn` (JSON conversation), and `POST /api/speech/transcribe` (`audio/wav`). Mutations enforce same-origin requests and bounded bodies; agent/speech processing has a two-request concurrency limit.

Local checks: `node --test dev/*.test.mjs` and `npm run build`. Tests cover microphone cancellation races, late audio, WAV limits, secret-safe provider failures, tool restrictions, clarification, and the fixture pipeline from transcription through MTA matching into transfer tracking. They do not establish live Gemini access or hardware microphone compatibility.
