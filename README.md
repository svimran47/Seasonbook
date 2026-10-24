# Seasonbook

The data spine: a Cloudflare Worker with a D1 cache of TVmaze (shows + episodes + exact airtimes, UTC-normalized), follows, a "tonight" query, and a subscribe-able ICS calendar feed — driven by an internal PWA. Weekend 2 added the notification engine: FCM topic-per-show announce (hourly cron, ≤75 min lead, ledger-deduped) + the Android skeleton (`android/`) that polls airtimes, arms exact alarms, and shows daily digests.

No accounts yet (deviceId only — that's weekend 3). No video, no piracy, ever: schedule data and legal where-to-watch only.

## Run locally

```
npm install
npm run db      # create the local D1 schema (.wrangler/state)
npm run dev     # serve http://localhost:8787  (run in its own terminal)
npm run smoke   # end-to-end checks against the running server
```

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /` | internal PWA — TV-Time-style tabs: Shows (front) · Movies · Discover · Profile |
| `GET /api` | endpoint docs |
| `GET /api/search?q=` | TVmaze search (compact results) |
| `GET /api/shows/:id` | cached show + next/last episode (auto-syncs on first hit) |
| `POST /api/follow` | `{deviceId, showId, action: "add" or "remove"}` — add triggers a sync |
| `GET /api/follows?deviceId=` | your watch list |
| `GET /api/tonight?deviceId=&window=24` | upcoming episodes in a UTC window (`from=` for testing) |
| `GET /api/schedule?country=US` | today's broadcast-TV listings per country (Discover tab) |
| `POST /api/sync` | `{ids: [..]}` or `{all: true, force: true}` |
| `GET /calendar.ics?deviceId=` | calendar feed (past 7 days → next 180 days); subscribe in Google/Apple Calendar |
| `GET /api/shows/:id/episodes?deviceId=` | episode list with per-device watched flags |
| `POST /api/watched` | `{deviceId, episodeId, state: "add" or "remove"}` |
| `GET /api/movies?deviceId=` | movie watch list (`want` / `watched` per device) |
| `GET /api/movies/search?q=` | TMDB movie search |
| `GET /api/movies/trending` | TMDB trending this week |
| `GET /api/movies/:id?deviceId=` | cached movie detail + this device's state |
| `POST /api/movie-state` | `{deviceId, movieId, state: "want" \| "watched" \| "unwatched" \| "remove"}` |
| `GET /api/notify/status` | notification engine state (FCM configured?) + setup hint |
| `GET /api/notify/preview?minutes=75` | dry-run: exactly what the hourly announce would send now |
| `POST /api/notify/test` | owner tool — push a test message to a topic (closed unless SB_OPEN_TOOLS) |
| `POST /api/notify/simulate` | owner tool — inject/remove a ghost airtime to exercise the engine (same gate) |
| `GET /export.json?deviceId=` | full copy: shows + watchmarks + movies (JSON) |

TMDB needs one free key: create it at themoviedb.org (Settings → API → Developer). Locally copy `.dev.vars.example` to `.dev.vars` and paste the token; in production `wrangler secret put TMDB_TOKEN`. Without it every route stays up — TMDB routes answer `501 {error: "tmdb-token-missing"}` and the Movies tab shows the setup card.

Localhost-first is a project decision: domain registration and deployment happen at the final build — everything is tested here until then.

Sync has a 12h cache TTL against TVmaze fair use; the hourly `scheduled` cron runs `syncAll` **and** the FCM announce engine (topic-per-show, one push per episode, `announcements` ledger dedupe). Notifications copy and channels follow `design/BRIEF.md`; quietly skipped when `FCM_SERVICE_ACCOUNT` is absent (check `/api/notify/status`). Owner tools (`/api/sync`, `/api/notify/test`, `/api/notify/simulate`) stay closed on public deploys unless their `SB_OPEN_*` vars are set.

## Weekend 2 — notification engine + Android skeleton (2026-10-24)

- **Worker:** `src/fcm.js` (FCM HTTP v1 via `jose` RS256 service-account JWT, token cached), hourly announce engine, 4 `/api/notify/*` routes, `announcements` ledger table, smoke steps for status/preview/ghost-airtime/owner-gate.
- **Android:** `android/` skeleton (Gradle 8.10.2 · AGP 8.7.3 · Kotlin 2.0.21 · minSdk 24): FCM `MessagingService`, topic subscribe/unsubscribe + test topic, `PollWorker` (4 h → arm exact alarms at T-2 h), daily `DigestWorker`, quiet hours, Watched action posting `/api/watched`. Builds green without Firebase (graceful setup-card pattern); unit tests for the pure logic ride CI (`.github/workflows/android-ci.yml`).
- **Remaining manual:** story owns Firebase project + `google-services.json` in `android/app/` + `FCM_SERVICE_ACCOUNT` secret; OEM battery checks on stock/Samsung/Xiaomi per `android/README.md` checklist.

## Weekend 3 (next)

Real accounts (replacing deviceId — keep every device's history), TV Time GDPR import (CSV/ZIP ingest), CSV export alongside JSON.

## Deploy (done, first deployment 2026-10-23)

1. `npx wrangler d1 create seasonbook` → paste the returned `database_id` into `wrangler.toml` (done)
2. `npx wrangler d1 execute seasonbook --remote --file=schema.sql` (done)
3. TMDB key: `npx wrangler secret put TMDB_TOKEN` (done — v4 read token)
4. `npx wrangler deploy` → live on `seasonbook.svimranmy.workers.dev`
5. Hourly cron refresh wired via `[triggers] crons` — re-syncs every followed show (12h TVmaze TTL)
6. Owner tool changes: **POST /api/sync is closed on prod** (503 unless a deployment sets `SB_OPEN_SYNC`); smoke $env:SB_BASE override: `$env:SB_BASE="https://seasonbook.svimranmy.workers.dev"; npm run smoke`

Localhost-first still applies to code: edit locally, `npm run dev`, `npm run smoke` locally, then redeploy.
3. `npx wrangler deploy`

**Before going public:** protect `POST /api/sync` (add a token to `.dev.vars`), replace deviceId with real accounts (weekend 3), keep the TVmaze attribution, respect their fair use.

## Weekend 3 (next)

Real accounts (replacing deviceId). Manual checks on 3 OEM skins (stock / Samsung / Xiaomi battery profiles).
