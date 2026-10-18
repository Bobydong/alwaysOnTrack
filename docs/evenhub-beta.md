# Live AI demo through an Even Hub beta

This path installs the frontend as an Even Hub beta and keeps speech, AI, Places, Google Routes, and MTA matching on your laptop. There is no USB connection or ADB requirement once the beta is installed. Your laptop can use the phone's hotspot; both need working internet. Keep the phone screen on for motion tracking.

## What runs where

- **Installed beta:** G2 microphone/taps/display, mobile dashboard, phone motion, and station tracking.
- **Laptop backend:** Groq/Gemini, Google Places/Routes, and local MTA catalog. Provider keys remain in `.env.local` on the laptop.
- **HTTPS tunnel:** forwards requests from the installed beta to the laptop backend.

The beta includes a random shared demo access token. This is an access credential for your private demo, not a provider API key. Give the package only to invited testers. Anyone who extracts that token from a package can call the demo backend while it is running. This is not a public multi-user authentication system.

## First setup

1. Complete the normal Groq/Google configuration and `npm run gtfs:import` from the README. Use Node 24.
2. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/). If this project's `.tools/cloudflared.exe` exists, use it directly as shown below.
3. Connect the laptop to the phone's hotspot (or another internet connection).
4. Start a [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) in a dedicated terminal:

   ```powershell
   .\.tools\cloudflared.exe tunnel --url http://localhost:5174
   ```

   If installed globally, use `cloudflared` instead. Leave this running. Copy the printed `https://....trycloudflare.com` origin. An unavailable local backend is expected until step 7. Do not add interactive email authentication to this tunnel: the packaged app uses API fetches.

5. Configure that origin from a second terminal in the repository:

   ```powershell
   npm run beta:configure -- https://YOUR-TUNNEL.trycloudflare.com
   ```

   This creates/reuses a random token in `.env.local` and writes the backend origin to `.env.beta.local`. It does not print the token or change your provider keys. Both environment files are ignored by Git.

6. Build the beta:

   ```powershell
   npm run beta:pack
   ```

   Output: **`release/alwaysontrack.ehpk`** and `release/app.json`. The script type-checks, builds in beta mode, replaces the network whitelist with your exact HTTPS origin, and packs the frontend. The ordinary development manifest remains unchanged. The default beta package ID is `com.alwaysontrack.subway`; set `EVENHUB_PACKAGE_ID` in `.env.local` if your portal project uses another identity. Identity availability must be checked in your developer account. Increase `version` in `app.json` for subsequent uploaded versions as required by the portal.

7. Start the API-only backend in another terminal:

   ```powershell
   npm run beta:serve
   ```

   Keep it running with the tunnel. It defaults to port **5174**, so ordinary Vite development on 5173 can remain separate. It reads `.env.local` and your existing MTA catalog. It does not serve frontend assets, recordings, or source files through the tunnel. Set `BETA_PORT` only if you also update the tunnel's local target.

8. Run `npm run beta:check`. This checks remote readiness, opaque-origin preflights, authentication, manifest/backend agreement, and exclusion of provider keys from the frontend without making paid provider calls. Readiness does not prove live provider credentials or route matching.

## Upload and install

Even Hub supports invited beta testers; this does not require making the app public. See the official [testing overview](https://hub.evenrealities.com/docs/test) and [beta management support](https://support.evenrealities.com/hc/en-us/articles/15688149217167-Even-Hub).

1. Sign in to the Even Hub developer portal and create/open your project.
2. Upload `release/alwaysontrack.ehpk` as a build. Ensure its package ID agrees with the project.
3. Set up beta distribution/testing groups and invite the email used by your Even Realities app account. Promote/assign the uploaded version to that beta group. Portal labels can vary.
4. Accept the invitation and install through the Even app's beta section. Use the beta invitation flow rather than the development localhost QR.
5. Launch the installed app, grant microphone permission, and verify phone motion is live.
6. Make a spoken request, select/confirm the intended places, wait for a resolved route, and run the boarding/arrival/transfer loop. Test this with USB unplugged.

An upload alone does not validate microphone access, device-motion availability in the packaged WebView, or its permission/network behavior. Those need a physical beta check. Keeping the phone screen locked is not established as working by these changes.

The installed SDK's packaging compatibility map currently stamps a minimum Even app version of **2.2.5**. Update the phone app if it is older; do not force a lower floor to bypass this requirement.

## During the demo

- Keep laptop, hotspot, backend, and tunnel awake and connected. Your laptop can stay nearby without a cable to the phone.
- Leave the phone screen on and the app visible for acceleration capture.
- Demo timing defaults to 12-second segments. Turn it off before loading a plan if you want schedule-based segment times.
- A full AI request still uses provider quotas and needs internet. The backend and tunnel are required to prepare another trip.
- Do not stop/restart the tunnel casually. A Quick Tunnel's hostname changes on restart; the installed build contains the old address and whitelist. A new hostname requires `beta:configure`, `beta:pack`, and a beta update. For reuse across days, use a named tunnel with a stable hostname instead.
- Stop the backend/tunnel after the demonstration to close remote access. Do not publish this shared-token demo build publicly.

## Troubleshooting

### Stop the background demo processes

For the background tunnel/backend started during setup on Windows, run:

```powershell
npm run beta:stop
```

This stops only the recorded tunnel and beta API processes, checking executable paths and process start times to avoid stopping a reused PID. It leaves ordinary Vite and other Node processes alone. To preview without stopping anything, run `npm run beta:stop -- -WhatIf`. Repeating the command after shutdown is safe.

Processes you start yourself in dedicated terminals can be stopped with **Ctrl+C** in each terminal. The stop command tracks the background setup session, not every future manual server you start. After stopping/restarting a Quick Tunnel, its new address requires reconfiguration and another beta package.

### Connection issues

| Symptom | Check |
| --- | --- |
| Tunnel returns 502 | Start `npm run beta:serve` and verify the tunnel targets port 5174. |
| Opening an API URL manually returns 401 | Expected: API requests require the beta token. Use the installed app. |
| Opening the tunnel root returns 404 | Expected: this backend serves only authenticated API endpoints. |
| App reports private beta access missing/expired | Ensure the backend uses the same `.env.local` token used to build the installed package. Restart the backend after configuration. Rebuild/reinstall after rotating the token. |
| App cannot reach the backend | Verify the tunnel is still running at the packaged origin, laptop/hotspot have internet, and the beta whitelist contains that origin. A changed URL requires a new package. |
| No routes resolve | Check the API keys/model access and refresh the MTA catalog; strict Google/MTA matching still applies. |
| Motion works in local testing but not in beta | Keep the screen on and check Lab's secure-context/motion diagnostics. The packaged WebView must expose linear acceleration; beta distribution is not a substitute for that sensor support. |

## Implementation

`src/companion.ts` routes all speech/planning/status requests to the configured backend. With no remote origin it preserves relative local URLs. `server/demo-access.mjs` checks the shared token for both reads and writes and handles cross-origin preflights, including opaque WebView origins. Without a configured token, local POST endpoints retain their same-origin checks. Provider keys are never compiled into the frontend.

`beta:configure` shares the token with local development too: restart an already-running Vite server after configuring it. Ordinary `npm run build` does not load `.env.beta.local`; `beta:pack` does. The beta API server never exposes the frontend bundle containing the demo token.
