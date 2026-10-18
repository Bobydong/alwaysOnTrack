# Voice and trip planning

The default preparation flow runs on the glasses. The AI backend transcribes a short G2 microphone recording and extracts the starting place and destination. The rider confirms those locations with Yes/No before Google Routes/MTA planning begins. The recommended verified route loads automatically into the existing boarding screen. The detector, boarding taps, transfers, and correction window remain in control during the trip. Manual typed planning and route selection remain available on the phone.

## Setup

1. Put your Groq key in `GROQ_API_KEY` in `.env.local` and select `AI_PROVIDER=groq`. This is separate from `GOOGLE_MAPS_API_KEY`. Never prefix secrets with `VITE_` or paste them into the phone UI.
2. `GROQ_STT_MODEL=whisper-large-v3-turbo` transcribes recordings; `GROQ_AGENT_MODEL=openai/gpt-oss-120b` handles intent, tool calling, and recommendation. Model access and quotas depend on the account. To switch back explicitly, set `AI_PROVIDER=gemini` and configure `GEMINI_API_KEY` / `GEMINI_MODEL`. Without an explicit provider, a configured Groq key selects Groq; otherwise Gemini is used. There is no automatic provider fallback or retry loop.
3. Keep the existing Google Routes key and imported MTA catalog configured as described in [routing.md](routing.md).
   Enable **Places API (New)** in the same Google Cloud project and allow that API in the key's restrictions. Place lookup defaults to `GOOGLE_MAPS_API_KEY`; optionally set a separate `GOOGLE_PLACES_API_KEY`. Places requests use separate Google Maps Platform billing/quota from Routes.
4. Restart `npm run dev`, or rebuild and run `npm start` for the standalone backend. Reload the Even app page and grant glasses microphone permission if requested.

The app manifest declares `g2-microphone` and the local backend URL. For a deployed version, replace the localhost network-whitelist entry with the actual trusted HTTPS backend origin. Static hosting alone does not provide these API endpoints.

## Five-minute demo

1. Open the app on G2. The full display asks you to tap to begin recording and say where you are and where you want to go. Tap, then speak both locations.
2. While **Listening**, tap again to submit. Recording also stops after 30 seconds. The microphone closes before submission. **Understanding intent** covers transcription and endpoint extraction.
3. Google Places first resolves the spoken names, with NYC location bias, into place IDs, display names, and addresses. If multiple candidates match, **Which starting place?** / **Which destination?** shows one result at a time: scroll to cycle through matches, then tap to select. **Is this right?** shows the selected From/To names and street addresses. Scroll between **Yes** and **No**, then tap. Yes is selected initially. No returns to recording without requesting routes. Full candidate addresses are also visible on the phone.
4. Yes displays **Planning your route**. The backend sends the selected Google place IDs to Routes, rather than freeform names, and recommends a verified itinerary; if optional ranking fails, the first verified Google result is used. Place IDs must belong to the server's lookup results. Confirmations expire after 15 minutes or a backend restart; record again if expired. The itinerary loads automatically and the normal corner layout shows where to board. No Times Square preset is preloaded.
5. Board the indicated train, then tap to arm tracking. At transfers, board the next train and tap again. Phone motion is enabled automatically after route loading where supported. Leave the phone screen on and the page visible. The phone's **Demo timing** checkbox still defaults to simulated 12-second segments; uncheck before planning for scheduled segment durations.

The optional NYC presets and manual search/import remain fallbacks. Select a preset and press Load route to use it. Phone controls under **Glasses trip setup** mirror tap/scroll and can reset preparation; **New spoken trip** reopens the prompt when tracking is stopped. During preparation, taps cannot arm the old route. Missing endpoints, unavailable Places access, provider failures, or unmatched routes show a retry screen; they never load a fallback demo. Numbered streets alone require an intersection or specific station. Long final confirmation labels are shortened; candidate selection screens and the phone retain more address detail. The legacy manual phone search still accepts address strings directly; use the glasses setup for place selection.

## Boundaries and verification

- G2 audio is treated as SDK-provided 16 kHz mono PCM16 and wrapped in WAV. Recordings are bounded to 30 seconds, submitted for transcription, and not saved by this feature. Groq transcription was verified with a public speech sample; the provider switch still needs a physical G2 check.
- Cancel discards buffered audio and aborts an in-flight transcription request locally. It cannot undo a request already received by the provider. Losing page visibility cancels recording.
- Keys stay on the backend. The selected provider receives audio for transcription, conversation text for planning, and verified route summaries for ranking. Groq uses separate speech and chat endpoints. Do not include secrets in spoken requests.
- Each transcription makes one speech API call. A manual clarification turn makes one agent call; a manual route-planning turn makes up to two plus one Google Routes request. MTA matching uses the local catalog. Provider quotas and charges can apply; no requests are made merely by loading the page beyond local configuration checks.
- Only the backend's Google/MTA results populate the itinerary. Unsupported or ambiguous stop sequences are rejected. If recommendation fails after routes are verified, those routes can still be reviewed and selected. Platform numbers, detailed exits, and live delays are not inferred.
- Simulated timings change only the tracker's route durations. The original itinerary and source schedule provenance remain intact in the export.

Endpoints: `GET /api/agent/status`, `POST /api/agent/turn` (manual JSON conversation), `POST /api/agent/intent` (transcript to endpoints and resolved place candidates), `POST /api/agent/plan-confirmed` (lookup resolution ID plus selected origin/destination place IDs), and `POST /api/speech/transcribe` (`audio/wav`). Mutations enforce same-origin requests and bounded bodies; agent/speech processing has a two-request concurrency limit. The glasses flow makes one speech call, one agent intent call, and two Places Text Search requests, then one Google Routes request and one optional agent ranking call after Yes. Selection/confirmation does not repeat the Places requests. The status endpoint reports the selected provider and both model names, without returning keys.

Local checks: `node --test dev/*.test.mjs` and `npm run build`. Tests cover microphone cancellation races, late audio, WAV limits, secret-safe provider failures, tool restrictions, clarification, and the fixture pipeline from transcription through MTA matching into transfer tracking. They do not establish live Gemini access or hardware microphone compatibility.
