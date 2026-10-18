# Render Free hosting check and deployment

Render Free is a candidate for this demo backend. Local checks are not a completed Render deployment: Linux memory accounting, the free service's CPU allocation, account limits, MTA download speed from Render, and live provider access must still be checked on the deployed service.

## Verified locally

- The existing catalog is 122,927,821 bytes and includes 80,875 subway trips / 1,488 stops.
- The original long-running backend recorded a 576 MiB peak working set. Do not deploy that configuration unmodified to a 512 MB instance.
- With Node 24 and `--max-old-space-size=320`, a fresh service-process check loaded the full catalog and matched six synthetic Google responses against the real schedules. Peak working set was approximately 445 MiB. No paid provider requests were made. This leaves limited headroom; it is evidence to try the free service, not a memory guarantee under all load.
- Importing the saved official 18.9 MiB GTFS ZIP took about 25 seconds and peaked around 905 MiB on the development machine. Import belongs in the deployment **build**, not the 512 MB runtime. Render's default build pipeline currently provides 8 GB RAM.
- A fresh download/import also completed: 76,749 trips / 1,488 stops, about 364 seconds including the download, and 861 MiB peak memory. The fresh catalog passed six further schedule-matching checks at about 437 MiB peak runtime memory. Download time is a material build dependency; it was much longer than local ZIP parsing.
- The Render entry point was tested over real local HTTP: it honors the supplied `PORT`, preloads schedules before listening, returns a public `/healthz`, and requires the private-beta token for API endpoints. Its root does not serve the frontend or secrets.

These timings and memory readings are from Windows; they do not emulate Linux cgroups or Render Free CPU throttling. Repeat the deployed checks before relying on it for judging.

Reproduce the runtime check with `npm run render:check`. It uses a schedule-derived, explicitly synthetic Google response and does not call Google or an AI provider. The parent constructs the fixture; a separate measured child loads the catalog using the same heap limit as the deployment.

## Free-tier behavior

See Render's official [free service limits](https://render.com/docs/free), [resource plans](https://render.com/docs/blueprint-spec#plan), and [build pipeline](https://render.com/docs/build-pipeline).

- Runtime: 512 MB RAM and shared CPU.
- After 15 minutes without inbound traffic the service sleeps. Waking typically takes about a minute. Wake it before starting a spoken request; the app's request timeout can expire during a cold start.
- Free services can restart. A restart loses in-memory place confirmations; repeat the spoken request if confirmation expires. Already-loaded trips remain on the phone while the page stays open.
- No persistent disk is required for the current design: import `data/mta-subway.json` during every build so it is part of the deployed artifact. Do not generate it only after runtime startup and expect it to survive sleep/restarts.
- The catalog remains a schedule snapshot. To refresh it, deploy a fresh build and reimport; a service wake alone does not refresh schedules.
- Free instance hours, bandwidth, and build minutes have account limits. Keep the service on **Free**, do not enable paid resources, and review spending/payment settings if you require a hard $0 hosting budget. Google/Groq usage is separate from hosting costs.

## Deploy the prepared Blueprint

The repository includes [render.yaml](../render.yaml). It declares a single **Free** Node web service, no databases, and no paid disk:

- Build: `npm ci && npm run gtfs:import`
- Start: `npm run render:serve`
- Health check: `/healthz`
- Node: 24.22.0
- Automatic deploys: off, to avoid an unrelated push restarting the demo.

1. Make these deployment changes available in the Git repository/branch you connect to Render. Render cannot see uncommitted local files. Do not commit `.env.local`, generated catalogs, or the private beta package.
2. In your Render account, create a Blueprint from that repository/branch. Confirm the service compute plan is **Free** before creating it. A plain Web Service with the same settings is equivalent.
3. Enter the secret environment variables when prompted, copying from your local configuration without putting them in source or chat:

   | Variable | Value |
   | --- | --- |
   | `GOOGLE_MAPS_API_KEY` | Your existing server-side Maps key with Routes and Places API (New) enabled. |
   | `GROQ_API_KEY` | Your existing Groq key. |
   | `DEMO_ACCESS_TOKEN` | The same 64-character hexadecimal token in your local `.env.local`. |

   If Places uses a separate key locally, also add `GOOGLE_PLACES_API_KEY` manually. The Blueprint defaults to Groq; changing provider also requires its corresponding key/model settings. Check any Google key IP restrictions against the hosted backend.

4. Wait for the build/import and startup health check to succeed. Check the Logs and memory metrics. A failed download or importer must fail the build; do not substitute a fake catalog. If the feed download fails, retry the build after checking MTA availability.
5. Open `https://YOUR-SERVICE.onrender.com/healthz` and wait until it returns `{"ok":true}`. The root returning 404 is intentional.
6. Point the local beta configuration at this stable origin:

   ```powershell
   npm run beta:configure -- https://YOUR-SERVICE.onrender.com
   ```

   This normally reuses the existing local token. Ensure it is still identical to the Render secret. Do not use Render's generated base64 secret for this variable; the demo expects 64 lowercase hex characters.

7. Build and validate the matching package:

   ```powershell
   npm run beta:pack
   npm run beta:check
   ```

   `beta:check` makes readiness/authentication checks, not paid provider calls. If Render is asleep, first open `/healthz` and wait for it to wake, then run the check. The local MTA catalog can be older than Render's; inspect the returned import timestamp.

8. Upload `release/alwaysontrack.ehpk` as a new beta version and install it. Follow the [Even Hub beta instructions](evenhub-beta.md). Perform a complete spoken request, place confirmation, and route load on the installed beta.
9. Verify a second request after the backend has gone idle and been manually warmed. Also check transfer tracking with the laptop tunnel stopped. Only then treat Render as verified for the demo.

The hosted origin stays the same across ordinary restarts/deploys of that service, so those restarts do not require a new beta package. Changing service origins or rotating the shared token does.

## Before judging

Open `/healthz`, wait for a successful response, and run `npm run beta:check`. Then test one intended spoken journey. Keep the phone screen on and Bluetooth connected. The laptop can be off once the package uses Render; internet is required on the phone while preparing trips.

The prior laptop tunnel/backend are separate. Stop them manually with `npm run beta:stop` when you no longer need the fallback. This migration does not stop them automatically or alter the currently uploaded beta.
