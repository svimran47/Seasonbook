import { searchShows, fetchShow, fetchEpisodes, fetchSchedule, compactShow } from "./tvmaze.js";
import { searchMovies, trendingMovies, fetchMovie, compactMovie, tmdbMissing } from "./tmdb.js";
import { buildICS } from "./ics.js";
import { airtimeMessage, fcmConfigured, sendToTopic } from "./fcm.js";

const SYNC_TTL_MS = 12 * 60 * 60 * 1000; // TVmaze fair-use friendly cache window

const json = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });

export default {
  async fetch(request, env) {
    const { pathname, searchParams } = new URL(request.url);
    try {
      if (pathname.startsWith("/api") || pathname === "/calendar.ics" || pathname === "/export.json") {
        return await route(request, env, request.method, pathname, searchParams);
      }
      const asset = await env.ASSETS.fetch(request);
      return asset.status !== 404 ? asset : env.ASSETS.fetch(new URL("/index.html", request.url));
    } catch (err) {
      return json({ error: String(err?.message || err) }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const sync = await syncAll(env);
      const announce = await announceEngine(env, { dryRun: false });
      return { sync, announce };
    })());
  },
};

async function route(request, env, method, pathname, sp) {
  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  if (method === "GET") {
    if (pathname === "/api") return apiDocs();
    if (pathname === "/api/search") return searchRoute(sp);
    const epsMatch = pathname.match(/^\/api\/shows\/(\d+)\/episodes$/);
    if (epsMatch) return episodesRoute(env, sp, Number(epsMatch[1]));
    const showMatch = pathname.match(/^\/api\/shows\/(\d+)$/);
    if (showMatch) return getShow(env, Number(showMatch[1]));
    if (pathname === "/api/tonight") return tonight(env, sp);
    if (pathname === "/api/schedule") return scheduleRoute(sp);
    if (pathname === "/api/follows") return listFollows(env, sp);
    if (pathname === "/api/notify/status") return notifyStatus(env);
    if (pathname === "/api/notify/preview") return notifyPreview(env, sp);
    if (pathname === "/api/movies/search") return movieSearchRoute(env, sp);
    if (pathname === "/api/movies/trending") {
      return tmdbRoute(env, () => trendingMovies(env).then((list) => ({ count: list.length, results: list.slice(0, 20) })));
    }
    const movieMatch = pathname.match(/^\/api\/movies\/(\d+)$/);
    if (movieMatch) return getMovieRoute(env, sp, Number(movieMatch[1]));
    if (pathname === "/api/movies") return moviesRoute(env, sp);
    if (pathname === "/calendar.ics") return calendarFeed(env, sp);
    if (pathname === "/export.json") return exportRoute(env, sp);
  }

  if (method === "POST") {
    if (pathname === "/api/follow") return setFollow(env, request);
    if (pathname === "/api/watched") return watchedRoute(env, request);
    if (pathname === "/api/movie-state") return movieStateRoute(env, request);
    if (pathname === "/api/notify/test") return notifyTest(env, request);
    if (pathname === "/api/notify/simulate") return notifySimulate(env, request);
    if (pathname === "/api/sync") return syncRoute(env, request, sp);
  }

  return json({ error: `no route: ${method} ${pathname}` }, 404);
}

function apiDocs() {
  return json({
    name: "Seasonbook",
    build: "weekend-2 · notification engine",
    app: "/",
    endpoints: {
      "GET /": "internal PWA (search / follow / tonight / ICS feed)",
      "GET /api": "this page",
      "GET /api/search?q=": "TVmaze search, compact results",
      "GET /api/shows/:id": "cached show + next/last episode",
      "POST /api/follow": "{ deviceId, showId, action: 'add' or 'remove' }",
      "GET /api/follows?deviceId=": "your shelf",
      "GET /api/movies?deviceId=": "movie watch list ('want'/'watched' states)",
      "GET /api/movies/search?q=": "TMDB search, compact movie results",
      "GET /api/movies/trending": "TMDB trending this week",
      "GET /api/movies/:id?deviceId=": "cached movie detail + this device's state",
      "POST /api/movie-state": "{ deviceId, movieId, state: 'want' | 'watched' | 'unwatched' | 'remove' }",
      "GET /api/tonight?deviceId=&window=24&from=ISO": "upcoming episodes (UTC window)",
      "GET /api/schedule?country=US": "today's broadcast-TV listings per country (Discover tab)",
      "POST /api/sync": "{ ids: [..], force? } or { all: true }",
      "GET /calendar.ics?deviceId=&past_days=7&future_days=180": "calendar feed",
      "GET /api/shows/:id/episodes?deviceId=": "episode list with per-device watched flags",
      "POST /api/watched": "{ deviceId, episodeId, state: 'add' or 'remove' }",
      "GET /export.json?deviceId=": "full copy: shows + watchmarks + movies (JSON)",
      "GET /api/notify/status": "notification engine state (FCM configured?) + setup hint",
      "GET /api/notify/preview?minutes=75": "dry-run: exactly what the hourly announce would send now",
      "POST /api/notify/test": "owner tool — push a test message to a topic (closed unless SB_OPEN_TOOLS)",
      "POST /api/notify/simulate": "owner tool — inject/remove a ghost airtime to exercise the engine (same gate)",
    },
    notes: [
      "deviceId stands in for accounts until weekend 3.",
      "Owner tools stay closed on public deploys: POST /api/sync needs SB_OPEN_SYNC; /api/notify/test and /api/notify/simulate need SB_OPEN_TOOLS. Cron runs regardless.",
      "Episode and airtime data by TVmaze; movie data by TMDB(©). Keep both attributions visible.",
      "TMDB routes answer 501 {error:'tmdb-token-missing'} with no TMDB_TOKEN. FCM announce skips with 501 {error:'fcm-service-account-missing'} — configure via .dev.vars locally, wrangler secret in prod.",
    ],
  });
}

async function searchRoute(sp) {
  const q = (sp.get("q") || "").trim();
  if (!q) return json({ error: "q is required" }, 400);
  const found = await searchShows(q);
  return json({
    count: found.length,
    results: found.slice(0, 20).map((r) => compactShow(r.show)),
  });
}

async function getShow(env, id) {
  let show = await env.DB.prepare("SELECT * FROM shows WHERE id = ?1").bind(id).first();
  if (!show) {
    const synced = await syncShow(env, id).catch(() => null);
    if (!synced?.ok) return json({ error: "unknown show (TVmaze 404 or fetch failed)", id }, 404);
    show = await env.DB.prepare("SELECT * FROM shows WHERE id = ?1").bind(id).first();
  }
  const now = new Date().toISOString();
  const next = await env.DB.prepare(
    "SELECT id, season, number, name, air_utc, runtime FROM episodes WHERE show_id = ?1 AND air_utc >= ?2 ORDER BY air_utc ASC LIMIT 1"
  ).bind(id, now).first();
  const last = await env.DB.prepare(
    "SELECT id, season, number, name, air_utc FROM episodes WHERE show_id = ?1 AND air_utc < ?2 ORDER BY air_utc DESC LIMIT 1"
  ).bind(id, now).first();
  return json({ show, next_episode: next ?? null, last_episode: last ?? null });
}

async function setFollow(env, request) {
  const body = await request.json().catch(() => null);
  if (!body?.deviceId || !Number(body.showId)) {
    return json({ error: "deviceId and numeric showId required" }, 400);
  }
  const id = Number(body.showId);

  if (body.action === "remove") {
    await env.DB.prepare("DELETE FROM follows WHERE device_id = ?1 AND show_id = ?2")
      .bind(body.deviceId, id)
      .run();
    return json({ ok: true, device: body.deviceId, removed: id });
  }

  const sync = await syncShow(env, id).catch((e) => ({ ok: false, error: String(e?.message || e) }));
  if (!sync.ok) return json({ error: `sync failed: ${sync.error}`, id }, 502);

  await env.DB.prepare("INSERT OR IGNORE INTO follows (device_id, show_id, created_at) VALUES (?1, ?2, ?3)")
    .bind(body.deviceId, id, Date.now())
    .run();
  return json({ ok: true, device: body.deviceId, following: id, sync });
}

async function listFollows(env, sp) {
  const deviceId = sp.get("deviceId");
  if (!deviceId) return json({ error: "deviceId required" }, 400);
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.name, s.status, s.network, s.timezone, s.schedule, s.image, f.created_at,
       (SELECT COUNT(*) FROM episodes e WHERE e.show_id = s.id) AS ep_total,
       (SELECT COUNT(*) FROM watchmarks w WHERE w.show_id = s.id AND w.device_id = f.device_id) AS watched
     FROM follows f JOIN shows s ON s.id = f.show_id
     WHERE f.device_id = ?1 ORDER BY f.created_at DESC`
  ).bind(deviceId).all();
  return json({ count: results.length, shows: results });
}

// Discover tab: today's broadcast-TV listings for one country — pure passthrough, no DB.
async function scheduleRoute(sp) {
  const country = (sp.get("country") || "US").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return json({ error: "country must be ISO-3166 alpha-2, e.g. US, GB, IN" }, 400);
  const schedule = await fetchSchedule(country);
  const listings = schedule.slice(0, 240).map((r) => ({
    episode_id: r.id,
    show_id: r.show?.id ?? null,
    show: r.show?.name ?? null,
    network: r.show?.network?.name || r.show?.webChannel?.name || null,
    time: r.airtime || r.airdate || "",
    season: r.season,
    number: r.number,
    image: r.show?.image?.medium || r.show?.image?.original || null,
  }));
  return json({
    country,
    date: schedule[0]?.airdate || null,
    count: listings.length,
    listings,
  });
}

// ── Movies (TMDB) ─────────────────────────────────────────────────────────────
// A missing/bad TMDB key is a setup state, not a crash: routes answer 501 with
// an actionable marker the Movies tab renders as a setup card.

const TMDB_SETUP = {
  error: "tmdb-token-missing",
  how: [
    "Create a free account at themoviedb.org → Settings → API → Developer (copy the key).",
    'Local dev: put TMDB_TOKEN="your-key" in a .dev.vars file at the project root, then restart npm run dev.',
    "Deployed: run `wrangler secret put TMDB_TOKEN` once per environment.",
  ],
};

function tmdbSetup(err) {
  return json({ ...TMDB_SETUP, detail: err.message }, 501);
}

// Wraps anything TMDB-backed so missing/broken keys surface as the friendly 501.
async function tmdbRoute(env, fn) {
  try {
    return json(await fn(env));
  } catch (err) {
    if (err?.setup || String(err?.message).includes("tmdb-token-missing")) return tmdbSetup(err);
    return json({ error: String(err?.message || err) }, 502);
  }
}

async function movieSearchRoute(env, sp) {
  const q = (sp.get("q") || "").trim();
  if (!q) return json({ error: "q is required" }, 400);
  const results = await tmdbRoute(env, (e) => searchMovies(e, q).then((list) => ({ count: list.length, results: list.slice(0, 20) })));
  return results;
}

// The device's movie watch list (cached metadata joined with watch state).
async function moviesRoute(env, sp) {
  void env; // cache hydration below is best-effort; the list itself is D1-only
  const deviceId = sp.get("deviceId");
  if (!deviceId) return json({ error: "deviceId required" }, 400);
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.title, m.year, m.release_date, m.runtime, m.poster, mm.state, mm.updated_at
     FROM movie_marks mm JOIN movies m ON m.id = mm.movie_id
     WHERE mm.device_id = ?1
     ORDER BY mm.updated_at DESC`
  ).bind(deviceId).all();
  return json({ count: results.length, movies: results });
}

async function getMovieRoute(env, sp, id) {
  const deviceId = sp.get("deviceId");
  void sp;
  let ok;
  try {
    ok = await cacheMovie(env, id);
  } catch (err) {
    if (err?.setup || String(err?.message).includes("tmdb-token-missing")) return tmdbSetup(err);
    return json({ error: `tmdb fetch failed: ${err.message}` }, 502);
  }
  if (!ok) return json({ error: "unknown movie (TMDB 404 or fetch failed)", id }, 404);
  const movie = await env.DB.prepare(
    "SELECT id, title, year, release_date, runtime, poster, overview, status FROM movies WHERE id = ?1"
  ).bind(id).first();
  let state = null;
  if (deviceId) {
    const row = await env.DB.prepare(
      "SELECT state, updated_at FROM movie_marks WHERE device_id = ?1 AND movie_id = ?2"
    ).bind(deviceId, id).first();
    state = row ?? null;
  }
  return json({ movie, state });
}

// Insert-or-refresh the D1 cache row for one movie (12h TTL, mirrors the TVmaze spine).
async function cacheMovie(env, id, { force = false } = {}) {
  const existing = await env.DB.prepare("SELECT synced_at FROM movies WHERE id = ?1").bind(id).first();
  if (!force && existing && Date.now() - existing.synced_at < SYNC_TTL_MS) return true;
  const movie = await fetchMovie(env, id);
  if (!movie) return existing ? true : false;
  const c = compactMovie(movie);
  await env.DB.prepare(
    `INSERT INTO movies (id, title, year, release_date, runtime, poster, overview, status, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(id) DO UPDATE SET title = ?2, year = ?3, release_date = ?4, runtime = ?5,
       poster = ?6, overview = ?7, status = ?8, synced_at = ?9`
  ).bind(c.id, c.title, c.year, c.release_date, c.runtime, c.poster, c.overview, c.status, Date.now()).run();
  return true;
}

async function movieStateRoute(env, request) {
  const body = await request.json().catch(() => null);
  if (!body?.deviceId || !Number(body.movieId)) {
    return json({ error: "deviceId and numeric movieId required" }, 400);
  }
  const id = Number(body.movieId);
  const state = body.state;

  if (state === "remove") {
    await env.DB.prepare("DELETE FROM movie_marks WHERE device_id = ?1 AND movie_id = ?2")
      .bind(body.deviceId, id).run();
    return json({ ok: true, device: body.deviceId, removed: id });
  }
  if (state !== "want" && state !== "watched" && state !== "unwatched") {
    return json({ error: "state must be 'want', 'watched', 'unwatched' or 'remove'" }, 400);
  }

  let cached;
  try {
    cached = await cacheMovie(env, id);
  } catch (err) {
    if (err?.setup || String(err?.message).includes("tmdb-token-missing")) return tmdbSetup(err);
    return json({ error: `tmdb fetch failed: ${err.message}` }, 502);
  }
  if (!cached) return json({ error: "unknown movie (TMDB 404 or fetch failed)", id }, 404);

  // unwatched → back to the want-list (TV Time semantics)
  const effective = state === "unwatched" ? "want" : state;
  await env.DB.prepare(
    `INSERT INTO movie_marks (device_id, movie_id, state, updated_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(device_id, movie_id) DO UPDATE SET state = ?3, updated_at = ?4`
  ).bind(body.deviceId, id, effective, Date.now()).run();
  return json({ ok: true, device: body.deviceId, movie: id, state: effective });
}

async function tonight(env, sp) {
  const hours = Math.min(Math.max(Number(sp.get("window") || 24), 0.5), 24 * 60);
  const from = sp.get("from") ? new Date(sp.get("from")) : new Date();
  if (isNaN(from.getTime())) return json({ error: "from must be an ISO date" }, 400);
  const to = new Date(from.getTime() + hours * 3600 * 1000);
  const deviceId = sp.get("deviceId");
  const ids = parseIds(sp);
  if (!deviceId && !ids.length) return json({ error: "deviceId or ids required" }, 400);
  const episodes = await queryUpcoming(env, { deviceId, ids, from: from.toISOString(), to: to.toISOString() });
  return json({ from: from.toISOString(), to: to.toISOString(), count: episodes.length, episodes });
}

// Shared query for /api/tonight and /calendar.ics (UTC-normalized air_utc comparisons)
async function queryUpcoming(env, { deviceId, ids, from, to }) {
  const selection = `e.id, e.show_id, e.season, e.number, e.name AS episode_name, e.air_utc, e.runtime,
                     s.name AS show_name, s.network`;
  if (deviceId) {
    const { results } = await env.DB.prepare(
      `SELECT ${selection}, (w.episode_id IS NOT NULL) AS watched
       FROM follows f
       JOIN episodes e ON e.show_id = f.show_id
       JOIN shows s ON s.id = f.show_id
       LEFT JOIN watchmarks w ON w.episode_id = e.id AND w.device_id = ?1
       WHERE f.device_id = ?1 AND e.air_utc >= ?2 AND e.air_utc < ?3
       ORDER BY e.air_utc ASC LIMIT 600`
    ).bind(deviceId, from, to).all();
    return results;
  }
  const { results } = await env.DB.prepare(
    `SELECT ${selection}
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE e.show_id IN (${ids.map(Number).join(",") || "0"}) AND e.air_utc >= ?1 AND e.air_utc < ?2
     ORDER BY e.air_utc ASC LIMIT 600`
  ).bind(from, to).all();
  return results;
}

const CAL_HEADERS = {
  "content-type": "text/calendar; charset=utf-8",
  "cache-control": "no-store",
  "content-disposition": 'inline; filename="seasonbook.ics"',
};

async function calendarFeed(env, sp) {
  const pastDays = clampNum(sp.get("past_days"), 7, 0, 36500);
  const futureDays = clampNum(sp.get("future_days"), 180, 0, 36500);
  const from = new Date(Date.now() - pastDays * 864e5).toISOString();
  const to = new Date(Date.now() + futureDays * 864e5).toISOString();
  const deviceId = sp.get("deviceId");
  const ids = parseIds(sp);
  if (!deviceId && !ids.length) return json({ error: "deviceId or ids required" }, 400);
  const rows = await queryUpcoming(env, { deviceId, ids, from, to });
  return new Response(buildICS(rows), { headers: CAL_HEADERS });
}

async function syncRoute(env, request, sp) {
  // Bulk sync is an owner tool: closed by default on public deploys (no SB_OPEN_SYNC var set),
  // open in local dev when .dev.vars sets SB_OPEN_SYNC="1". Cron sync is unaffected.
  if (!env.SB_OPEN_SYNC) return json({ error: "sync is closed on this deployment (set SB_OPEN_SYNC to enable)" }, 503);
  const body = await request.json().catch(() => null);
  if (body?.all) return json({ ok: true, results: await syncAll(env) });
  let ids = parseIds(sp);
  if (!ids.length && Array.isArray(body?.ids)) ids = body.ids.map(Number).filter((n) => n > 0);
  if (!ids.length) return json({ error: "send ids=[tv-id,...] as ?ids= or body, or { all: true }" }, 400);
  const results = [];
  for (const id of ids.slice(0, 50)) {
    results.push(
      await syncShow(env, id, { force: !!body?.force }).catch((e) => ({
        id,
        ok: false,
        error: String(e?.message || e),
      }))
    );
  }
  return json({ ok: true, results });
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function syncShow(env, id, { force = false } = {}) {
  const existing = await env.DB.prepare("SELECT synced_at FROM shows WHERE id = ?1").bind(id).first();
  if (!force && existing && Date.now() - existing.synced_at < SYNC_TTL_MS) {
    return { id, ok: true, cached: true };
  }

  const show = await fetchShow(id);
  if (!show) return { id, ok: false, error: "not-found" };
  const c = compactShow(show);
  await env.DB.prepare(
    `INSERT INTO shows (id, name, status, network, timezone, schedule, runtime, image, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(id) DO UPDATE SET name = ?2, status = ?3, network = ?4, timezone = ?5,
       schedule = ?6, runtime = ?7, image = ?8, synced_at = ?9`
  ).bind(c.id, c.name, c.status, c.network, c.timezone, c.schedule, c.runtime, c.image, Date.now()).run();

  const eps = await fetchEpisodes(id);
  const now = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO episodes (id, show_id, season, number, name, airdate, air_utc, runtime, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
     ON CONFLICT(id) DO UPDATE SET season = ?3, number = ?4, name = ?5, airdate = ?6,
       air_utc = ?7, runtime = ?8, synced_at = ?9`
  );
  for (const part of chunk(eps, 40)) {
    await env.DB.batch(
      part.map((e) =>
        stmt.bind(
          e.id,
          id,
          e.season ?? 0,
          e.number ?? null,
          e.name ?? null,
          e.airdate ?? null,
          e.airstamp ? new Date(e.airstamp).toISOString() : null,
          e.runtime ?? null,
          now
        )
      )
    );
  }
  return { id, ok: true, episodes: eps.length };
}

async function syncAll(env) {
  const { results } = await env.DB.prepare("SELECT id FROM shows ORDER BY id").all();
  const out = [];
  for (const { id } of results) {
    out.push(await syncShow(env, id).catch((e) => ({ id, ok: false, error: String(e?.message || e) })));
  }
  return out;
}

function parseIds(sp) {
  return (sp.get("ids") || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function clampNum(raw, fallback, min, max) {
  // absent/empty/whitespace params must fall back — Number(null) is 0, NOT NaN,
  // so an bare `null` used to collapse onto `min` instead of the fallback (silent
  // window bugs: preview?minutes defaulted to 5h instead of 75m, tonight?window to 1).
  if (raw === null || raw === undefined || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

async function episodesRoute(env, sp, showId) {
  const deviceId = sp.get("deviceId");
  if (!deviceId) return json({ error: "deviceId required" }, 400);
  const show = await env.DB.prepare("SELECT id, name FROM shows WHERE id = ?1").bind(showId).first();
  if (!show) return json({ error: "show not cached — follow it or POST /api/sync first", showId }, 404);
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.season, e.number, e.name, e.airdate, e.air_utc, e.runtime,
            (w.episode_id IS NOT NULL) AS watched
     FROM episodes e
     LEFT JOIN watchmarks w ON w.episode_id = e.id AND w.device_id = ?1
     WHERE e.show_id = ?2
     ORDER BY e.season ASC, (e.number IS NULL), e.number ASC`
  ).bind(deviceId, showId).all();
  const watched = results.reduce((n, r) => n + (r.watched ? 1 : 0), 0);
  return json({ show, count: results.length, watched, episodes: results });
}

async function watchedRoute(env, request) {
  const body = await request.json().catch(() => null);
  if (!body?.deviceId || !Number(body.episodeId)) {
    return json({ error: "deviceId and numeric episodeId required" }, 400);
  }
  const epId = Number(body.episodeId);
  if (body.state === "remove") {
    await env.DB.prepare("DELETE FROM watchmarks WHERE device_id = ?1 AND episode_id = ?2")
      .bind(body.deviceId, epId).run();
    return json({ ok: true, unwatched: epId });
  }
  const ep = await env.DB.prepare("SELECT id, show_id FROM episodes WHERE id = ?1").bind(epId).first();
  if (!ep) return json({ error: "unknown episode" }, 404);
  await env.DB.prepare(
    `INSERT INTO watchmarks (device_id, episode_id, show_id, watched_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(device_id, episode_id) DO UPDATE SET watched_at = ?4`
  ).bind(body.deviceId, epId, ep.show_id, Date.now()).run();
  return json({ ok: true, watched: epId, show: ep.show_id });
}

async function exportRoute(env, sp) {
  const deviceId = sp.get("deviceId");
  if (!deviceId) return json({ error: "deviceId required" }, 400);
  const { results: shows } = await env.DB.prepare(
    `SELECT s.id, s.name, s.status, s.network, s.timezone, s.schedule, f.created_at,
       (SELECT COUNT(*) FROM episodes e WHERE e.show_id = s.id) AS ep_total,
       (SELECT COUNT(*) FROM watchmarks w WHERE w.show_id = s.id AND w.device_id = f.device_id) AS watched
     FROM follows f JOIN shows s ON s.id = f.show_id
     WHERE f.device_id = ?1 ORDER BY f.created_at DESC`
  ).bind(deviceId).all();
  const { results: marks } = await env.DB.prepare(
    "SELECT episode_id, show_id, watched_at FROM watchmarks WHERE device_id = ?1 ORDER BY watched_at DESC"
  ).bind(deviceId).all();
  const { results: movies } = await env.DB.prepare(
    `SELECT m.id, m.title, m.year, m.release_date, m.runtime, mm.state, mm.updated_at
     FROM movie_marks mm JOIN movies m ON m.id = mm.movie_id
     WHERE mm.device_id = ?1 ORDER BY mm.updated_at DESC`
  ).bind(deviceId).all();
  return new Response(
    JSON.stringify({
      format: "seasonbook-export-v1",
      generated_at: new Date().toISOString(),
      device: deviceId,
      watchmarks: marks,
      movies,
      shows,
    }, null, 2),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="seasonbook-export-${deviceId.slice(0, 8)}.json"`,
      },
    }
  );
}

/* ── Notification engine (weekend 2) ─────────────────────────────────────
   Contract (design/BRIEF.md): FCM topic-per-show + device reschedule; one push
   per episode; topics the app subscribes itself to as "show-<tvmazeId>".      */

const ANNOUNCE_LEAD_MIN = 75;     // hourly cron → episodes announce once, ≤75 min before air
const GHOST_EPISODE_ID = 99100001; // /api/notify/simulate writes this id; smoke cleans it up

function ownerOpen(env) {
  return !!env.SB_OPEN_TOOLS;
}

async function notifyStatus(env) {
  return json({
    status: "ok",
    fcm: {
      state: fcmConfigured(env) ? "configured" : "not-configured",
      effect: fcmConfigured(env)
        ? "the hourly cron announces upcoming episodes to show topics"
        : "announces are skipped; the engine still runs dry (preview + ledger checks work)",
      setup: "console.firebase.google.com → Project settings → Service accounts → 'Generate new private key' → paste the whole JSON as FCM_SERVICE_ACCOUNT (local: .dev.vars; prod: wrangler secret put FCM_SERVICE_ACCOUNT)",
    },
    engine: {
      mode: "topic-per-show",
      trigger: "hourly cron (sync + announce)",
      lead: `≤ ${ANNOUNCE_LEAD_MIN} min before air, exactly once`,
      dedupe: "announcements ledger",
    },
    client: {
      channel_id: "airtime must exist on the device or tray payloads drop silently",
      subscription: "app subscribes itself: FirebaseMessaging.subscribeToTopic('show-<tvmazeId>')",
    },
  });
}

async function announcementCandidates(env, leadMinutes = ANNOUNCE_LEAD_MIN) {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT e.id, e.show_id, e.season, e.number, e.name AS episode_name, e.air_utc,
            s.name AS show_name, s.network
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE e.air_utc IS NOT NULL
       AND e.air_utc >= ?1 AND e.air_utc <= ?2
       AND NOT EXISTS (SELECT 1 FROM announcements a WHERE a.episode_id = e.id AND a.kind = 'air')
     ORDER BY e.air_utc ASC LIMIT 50`
  ).bind(new Date(now).toISOString(), new Date(now + leadMinutes * 60000).toISOString()).all();
  return results;
}

async function announceEngine(env, { dryRun = false } = {}) {
  const rows = await announcementCandidates(env);
  if (dryRun || rows.length === 0) {
    return { status: "ok", dryRun: true, count: rows.length, items: rows.map(airtimeMessage) };
  }
  if (!fcmConfigured(env)) {
    return { status: "ok", count: rows.length, skipped: "fcm-service-account-missing", items: rows.map(airtimeMessage) };
  }
  const sent = [];
  for (const row of rows) {
    const item = airtimeMessage(row);
    try {
      await sendToTopic(env, item);
      await env.DB.prepare(
        "INSERT OR IGNORE INTO announcements (episode_id, kind, air_utc, announced_at) VALUES (?1, 'air', ?2, ?3)"
      ).bind(row.id, row.air_utc, Date.now()).run();
      sent.push({ ok: true, topic: item.topic, title: item.title, episode_id: row.id });
    } catch (err) {
      // one bad message must not sink the batch or the ledger for the others
      sent.push({ ok: false, topic: item.topic, title: item.title, episode_id: row.id, error: String(err?.message || err) });
    }
  }
  return { status: "ok", count: sent.length, sent };
}

async function notifyPreview(env, sp) {
  const minutes = clampNum(sp.get("minutes"), ANNOUNCE_LEAD_MIN, 5, 12 * 60);
  const rows = await announcementCandidates(env, minutes);
  const now = Date.now();
  return json({
    status: "dry-run",
    window: { from: new Date(now).toISOString(), to: new Date(now + minutes * 60000).toISOString() },
    fcm: fcmConfigured(env) ? "configured" : "not-configured (preview is credential-free by design)",
    count: rows.length,
    items: rows.map(airtimeMessage),
  });
}

async function notifyTest(env, request) {
  if (!ownerOpen(env)) {
    return json({ error: "closed on this deployment — set SB_OPEN_TOOLS to open owner tools locally / via wrangler vars" }, 503);
  }
  if (!fcmConfigured(env)) {
    return json({ error: "fcm-service-account-missing", setup: "paste the service-account key JSON into FCM_SERVICE_ACCOUNT (.dev.vars locally, wrangler secret in prod)" }, 501);
  }
  const body = await request.json().catch(() => null);
  const topic = String(body?.topic || "announce-test").slice(0, 60);
  await sendToTopic(env, {
    topic,
    title: "Seasonbook test",
    body: "If this lands, the FCM v1 relay works and your device's topic subscription does too.",
    data: { type: "test", sent_at: new Date().toISOString() },
  });
  return json({ ok: true, topic, note: "any subscribed device on this topic got it — the app has a 'subscribe to test topic' button" });
}

async function notifySimulate(env, request) {
  if (!ownerOpen(env)) {
    return json({ error: "closed on this deployment — set SB_OPEN_TOOLS to open owner tools locally / via wrangler vars" }, 503);
  }
  const body = await request.json().catch(() => null);
  if (body?.action === "remove") {
    await env.DB.prepare("DELETE FROM episodes WHERE id = ?1").bind(GHOST_EPISODE_ID).run();
    await env.DB.prepare("DELETE FROM announcements WHERE episode_id = ?1").bind(GHOST_EPISODE_ID).run();
    return json({ ok: true, removed: GHOST_EPISODE_ID });
  }
  const showId = Number(body?.showId);
  if (!showId) return json({ error: "showId required (169 = Breaking Bad, cached by smoke)" }, 400);
  const minutes = clampNum(body?.minutesFromNow, 60, 1, ANNOUNCE_LEAD_MIN);
  const show = await env.DB.prepare("SELECT id FROM shows WHERE id = ?1").bind(showId).first();
  if (!show) return json({ error: "show not cached — follow it or POST /api/sync first", showId }, 404);
  const airUtc = new Date(Date.now() + minutes * 60000).toISOString();
  await env.DB.prepare(
    `INSERT INTO episodes (id, show_id, season, number, name, airdate, air_utc, runtime, synced_at)
     VALUES (?1, ?2, 42, 1, ?3, ?4, ?5, 45, ?6)
     ON CONFLICT(id) DO UPDATE SET air_utc = ?5, name = ?3, airdate = ?4`
  ).bind(GHOST_EPISODE_ID, showId, "Simulated airtime", airUtc.slice(0, 10), airUtc, Date.now()).run();
  await env.DB.prepare("DELETE FROM announcements WHERE episode_id = ?1").bind(GHOST_EPISODE_ID).run();
  return json({ ok: true, episode: { id: GHOST_EPISODE_ID, show_id: showId, air_utc: airUtc, announced_at: null } });
}
