# Screen-lock tracking investigation

The current app runs its detector in the Even app WebView and obtains phone acceleration from `DeviceMotionEvent`. It is not yet a screen-off tracker. Saving the itinerary or running a JavaScript timer does not provide background accelerometer access.

## Findings

- The W3C motion specification gates delivery on document visibility. Removing our `document.hidden` check is insufficient. [Device Orientation and Motion](https://www.w3.org/TR/orientation-event/).
- Android restricts continuous sensors for background apps; a native foreground service is the supported path for continuous collection. [Android sensors overview](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview).
- Even documents Android WebView suspension and possible loss of in-memory state. SDK 0.0.10 mentions improved background keep-alive, which does not establish motion or bridge continuity. [Even background lifecycle](https://hub.evenrealities.com/docs/build/background-lifecycle).
- The connected test device reports Android 14 / API 34 and Even app 2.3.2. The installed SDK exposes G2 IMU, not a typed native phone-acceleration stream. No Android build toolchain was found in the standard local paths checked; adb is available.

## Test now

1. Reload the updated app in Even. Stop any active trip. Find **Screen-lock diagnostic** beneath phone motion.
2. Press **Start screen-lock test**. It enables phone motion and temporarily replaces the glasses UI. Confirm PHONE EVENTS and VALID LINEAR are increasing before locking.
3. Lock for 30 seconds. Watch whether LOCK TEST seconds keep increasing. Move the secured phone briefly and single-tap the glasses once. This test records input; the tap does not arm a trip.
4. Unlock and press **Stop test**. Use **Prepare diagnostic JSON**, then the existing **Save to laptop** action. Tell us whether the glasses actually updated during lock.
5. Repeat for five minutes and while switching apps. Later repeat without USB power, on the installed build and on the intended wireless deployment. A cable/charger can affect idle behavior; a short connected trial is not a full sleep test.

The JSON contains `screenLockTest`: visible/hidden durations, motion-event counts, valid linear-acceleration counts, maximum gaps, JavaScript heartbeats, bridge accept/failure counts, taps, and lifecycle events. No phone motion is invented or inferred from silence. Hidden is a browser visibility state, not independent evidence of physical lock. Bridge acceptance is not proof that pixels updated. Reports save locally once per second and at lifecycle boundaries; an interrupted report remains available after reload. This persistence is for diagnostics, not trip restoration.

For an optional read-only Android-side trace, run from the laptop while doing the test:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android-lock-status.ps1 -DurationSeconds 60
```

It writes `recordings/screen-lock-device-*.json` with power state and Even foreground-service information. It changes no phone settings and does not lock/unlock the phone.

## Decide from evidence

| Observation during lock | Next implementation |
| --- | --- |
| Glasses timer/taps continue, phone acceleration stops | Prototype a native Android foreground sensor service and relay real timestamped samples into the Even WebView. Preserve the existing detector and UI initially. |
| Phone samples and bridge both continue | Add a controlled background-tracking mode, continuity checks, and recovery; verify a longer unplugged sleep trial before declaring support. |
| JavaScript or glasses updates stop | A sensor relay alone cannot solve this. Establish a supported Even background execution/rendering path before proceeding; a separate Android wrapper does not inherit the Even bridge. |
| WebView restarts | Recover persisted state and require current-station confirmation after missing evidence. Never count buffered silence as arrivals. |

## Native prototype, if needed

Build a small Android companion that starts a user-visible foreground service from its activity, collects `TYPE_LINEAR_ACCELERATION` with monotonic sensor timestamps, and exposes a phone-local authenticated relay. An ongoing notification provides Stop. Use a partial wake lock only during active collection if needed for non-wake-up sensors, with reliable release on stop/error. Browser and native samples must never be mixed or replayed after a delivery gap as though they were live.

On Android 14, select and declare a foreground-service type matching the actual use. A sensor-only prototype can evaluate `specialUse` with an explicit subtype explanation; do not claim fitness/health or media playback merely to keep the app running. [Foreground-service types](https://developer.android.com/develop/background-work/services/fgs/service-types).

The relay still depends on the Even WebView running and its display bridge accepting and delivering updates while locked. If that fails, move detection into the service only after resolving how the glasses receive live updates; native collection by itself is not an end-to-end solution.
