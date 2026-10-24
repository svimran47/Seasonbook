# Seasonbook Android — the notifications engine

Two lanes, per `design/BRIEF.md`:

```
Lane 1 (server → FCM):   hourly cron announces each upcoming episode once, ≤75 min
                         before air, to topic "show-<tvmazeId>". Devices subscribe themselves.
Lane 2 (device, local):  WorkManager polls /api/tonight every 4 h, then arms exact alarms
                         ~2 h before air ("device reschedule") — works even if FCM missed.
```

Copy in both lanes follows the contract: title `show · SxxEyy`, body = one fact + time offset,
quiet hours 22:00–07:00. Actions: **Open** (tap) and **Watched** (posts `/api/watched`); Mute ships
with the first UI design pass.

## Toolchain (decided fresh at Weekend 2 kickoff)

| Thing | Version |
|---|---|
| Gradle | 8.10.2 (wrapper committed) |
| AGP | 8.7.3 |
| Kotlin | 2.0.21 |
| compileSdk / targetSdk | 35 |
| minSdk | 24 |
| JDK | 17 |

## Build

Local (if you have Android Studio + JDK 17): open **this `android/` folder** in Android Studio,
let it sync, run `assembleDebug`. The CI does it too:

```
.github/workflows/android-ci.yml → gradle testDebugUnitTest + assembleDebug
```

Every push touching `android/**` produces a downloadable debug APK artifact — **that is the
no-JVM path** (this dev machine has no Android toolchain).

## Firebase setup (the one thing that needs your hands)

Firebase is optional by design — the app builds and runs without it, shows the setup-card
behavior exactly like the TMDB key pattern:

1. **console.firebase.google.com** → new project.
2. Add an Android app with package **`com.svimranmy.seasonbook`** → download
   **`google-services.json`** → put it in **`android/app/`**. The plugin auto-activates
   (copy `google-services.json.example` for the expected shape).
3. In the Firebase console: Project settings → **Service accounts** → *Generate new private
   key* → save the JSON **server-side**: local `.dev.vars` `FCM_SERVICE_ACCOUNT="<whole json>"
   (one line)`; production `npx wrangler secret put FCM_SERVICE_ACCOUNT`.
4. Restart `npm run dev`; `GET /api/notify/status` flips to `configured`.

## Testing locally (worker on this PC)

```
adb reverse tcp:8787 tcp:8787     # phone's 127.0.0.1:8787 → computer's worker
```

Then in the app: leave the base URL at `http://127.0.0.1:8787`, follow show `169`, tap
**Sync topics / Subscribe to test topic**, and run `npm run smoke` — the ghost-airtime
step (`/api/notify/simulate`) plus `/api/notify/test` poke both lanes end to end.

## OEM checklist (manual, per pre-agreed scope — stock / Samsung / Xiaomi)

| Skin | What gets notification-killed | What to test |
|---|---|---|
| Pixel/stock | nothing much; grant SCHEDULE_EXACT_ALARM in the button | alarms through DND-adjacent hours, boot re-arm |
| Samsung (One UI) | app sleep + "battery savings" background caps | Settings → Apps → Seasonbook → Battery → *Unrestricted*; alarms after 8 h idle; digest arrives |
| Xiaomi (MIUI/HyperOS) | autostart off = WorkManager nuked; aggressive alarm killing | Autostart ON, Battery saver → *No restrictions*; alarm at 2 h offset arrives |

Record results in this table after each device pass.

## Known skeleton limits (honest list)

- Programmatic LinearLayout UI, no design pass yet — the engine is the deliverable.
- Digest hour is fixed 18:15 (no picker yet); quiet hours suppress it after 22:00.
- No Mute action on notifications yet (Open + Watched shipped).
- `postman`-grade error toasts; no retry UI.
