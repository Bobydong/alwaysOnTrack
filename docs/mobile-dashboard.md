# Mobile dashboard

The app opens to the minimal mobile view. **Lab** opens the original dashboard in the same page, keeping the bridge, route, detector, sensor streams, and recordings running. **Back to mobile view** returns. Add `?view=lab` to the QR URL to open the original view directly; other query parameters are preserved.

## What stays visible

- **Glasses view:** the same text, rail and pixel icons used by the glasses renderer. Once connected, it shows the last fully acknowledged page update. A pending transition retains that frame until the new one finishes sending. The badge distinguishes **Sent to glasses**, **Updating glasses**, **Update failed**, and **Preview only**. Native text metrics may differ slightly; this is not a camera feed from the glasses.
- **Right now:** the current instruction, with the full selected address while choosing a place. The main button follows the glasses flow: record, submit, select, confirm, board, or reject a proposed arrival. During automatic tracking there is no extra primary action to press.
- **Stops remaining:** the countdown to the current train's destination or transfer, using the same provisional arrival and correction behavior as the glasses.
- **Phone motion:** off, waiting for usable linear acceleration, live, or paused. Enable/restart is available when needed. Starting a ride from the phone enables motion before arming.
- **Start over / New trip:** cancels preparation or ends current tracking and returns to the spoken prompt. Diagnostic recordings are retained in memory.

Keep the phone screen on during the demo. The preview belongs to this phone session; opening the URL in another browser creates a separate session rather than remotely watching the phone.

## Demo controls

Expand **Demo controls** to select 12-second timing for newly generated plans, load the built-in NYC demo, manually mark departure, correct the current station, or stop tracking. Loading a new demo is disabled during an active trip or preparation request. The timing toggle changes future plan loads; it does not rewrite an already loaded route.

Lab retains the manual planner, prepared JSON import/export, all detector settings, G2 IMU tools, motion plots, recordings, save-to-laptop controls, and screen-lock diagnostic. The new mobile view does not start the glasses IMU or make extra AI/route API calls. Hidden lab plots do not redraw until Lab is opened; capture continues.

## Checks

`node --test dev/mobile.test.mjs` covers contextual actions, transfer/correction counts, and preview delivery states. With Vite running, `/dev/mobile-ui.browser.html` checks the 390-pixel layout, Lab switching without reload, fallback demo loading, preview state, transfer guidance, station selection, and reset. It makes no paid AI or routing calls. A physical Even/G2 check is still needed for connection feedback and preview delivery timing.
