# Seasonbook — weekend 1

The data spine: a Cloudflare Worker with a D1 cache of TVmaze (shows + episodes + exact airtimes, UTC-normalized), follows, a "tonight" query, and a subscribe-able ICS calendar feed — driven by an internal PWA.

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
| `GET /` | internal PWA (search / follow / tonight / ICS feed) |
| `GET /api` | endpoint docs |
| `GET /api/search?q=` | TVmaze search (compact results) |
| `GET /api/shows/:id` | cached show + next/last episode (auto-syncs on first hit) |
| `POST /api/follow` | `{deviceId, showId, action: "add" or "remove"}` — add triggers a sync |
| `GET /api/follows?deviceId=` | your shelf |
| `GET /api/tonight?deviceId=&window=24` | upcoming episodes in a UTC window (`from=` for testing) |
| `POST /api/sync` | `{ids: [..]}` or `{all: true, force: true}` |
| `GET /calendar.ics?deviceId=` | calendar feed (past 7 days → next 180 days); subscribe in Google/Apple Calendar |
| `GET /api/shows/:id/episodes?deviceId=` | episode list with per-device watched flags |
| `POST /api/watched` | `{deviceId, episodeId, state: "add" or "remove"}` |
| `GET /export.json?deviceId=` | full copy: shows + watchmarks (JSON) |

Localhost-first is a project decision: domain registration and deployment happen at the final build — everything is tested here until then.

Sync has a 12h cache TTL against TVmaze fair use; hourly `scheduled` refresh is wired for after deploy.

## Deploy (later in the week, own risk)

1. `npx wrangler d1 create seasonbook` → paste the returned `database_id` into `wrangler.toml`
2. `npx wrangler d1 execute seasonbook --remote --file=schema.sql`
3. `npx wrangler deploy`

**Before going public:** protect `POST /api/sync` (add a token to `.dev.vars`), replace deviceId with real accounts (weekend 3), keep the TVmaze attribution, respect their fair use.

## Weekend 2 (next)

Android skeleton: follow list → FCM topic-per-show subscription, local notifications at airtime, daily digest via WorkManager. Manual checks on 3 OEM skins (stock / Samsung / Xiaomi battery profiles).
