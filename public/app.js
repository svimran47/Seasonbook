"use strict";

/* ── helpers ─────────────────────────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const deviceId = (() => {
  let d = localStorage.getItem("sb_device");
  if (!d) { d = (self.crypto.randomUUID && crypto.randomUUID()) || "dev-" + Math.random().toString(36).slice(2); localStorage.setItem("sb_device", d); }
  return d;
})();

const state = {
  follows: null,
  tonight: null,
  tonightWin: Number(localStorage.getItem("sb_win")) || 24,
  onAir: {},            // showId -> has an unwatched airing in the current tonight window
  show: null, episodes: null,
  reveal: false,
  posterMode: localStorage.getItem("sb_post") || "posters",
  discCountry: localStorage.getItem("sb_disc") || "US",
  seq: 0,
};

const PALETTES = [
  "linear-gradient(160deg,#4A2F14,#1C1208)", "linear-gradient(160deg,#14344A,#0C1B26)",
  "linear-gradient(160deg,#38224A,#170F24)", "linear-gradient(160deg,#1E3A17,#0E1A0C)",
  "linear-gradient(160deg,#40351E,#26200F)", "linear-gradient(160deg,#2E3650,#12141F)",
];
const SPINES = [
  "linear-gradient(180deg,#3E2C1D,#241A12)", "linear-gradient(180deg,#233A4A,#152430)",
  "linear-gradient(180deg,#3A2A45,#221930)", "linear-gradient(180deg,#2C3A2A,#1A241A)",
  "linear-gradient(180deg,#40351E,#26200F)", "linear-gradient(180deg,#423030,#271717)",
];
const pick = (arr, id) => arr[Math.abs(Number(id) || 0) % arr.length];

const api = async (path, opts) => {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { toast(data.error || "HTTP " + res.status, true); throw new Error(String(res.status)); }
  return data;
};
const post = (path, obj) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(obj) });

let toastTimer;
function toast(msg, isErr) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "show" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), 2600);
}

const fmtClock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
const code = (e) => (e.number ? `S${String(e.season).padStart(2, "0")}E${String(e.number).padStart(2, "0")}` : `S${e.season} special`);
const strip = (html) => String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function countdown(iso) {
  let s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (s < 0) s = 0;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `in ${m}m`;
  return `in ${ss}s`;
}

/* ── router ──────────────────────────────────────────── */
// weekend-1 hashes → the TV-Time-style tab set (front = Shows)
const REDIRECT = { tonight: "shows", shelf: "shows", search: "discover", export: "profile" };

async function render() {
  state.reveal = state.reveal || false;
  let hash = location.hash || "#shows";
  if (REDIRECT[hash.slice(1)]) {
    location.hash = "#" + REDIRECT[hash.slice(1)];
    return;
  }
  if (hash !== "#shows" && hash !== "#movies" && hash !== "#discover" && hash !== "#profile" && !hash.startsWith("#show/")) {
    location.hash = "#shows";
    return;
  }
  const seq = ++state.seq;
  const view = $("#view");
  view.firstRenderDone = view.firstRenderDone || false;

  const punch = (html) => { if (seq === state.seq) { view.innerHTML = `<div class="enter">${html}</div>`; window.scrollTo(0, 0); } };

  // nav active state
  const section = hash.startsWith("#show/") ? "shows" : hash.startsWith("#movie/") ? "movies" : hash.replace("#", "");
  document.querySelectorAll(".bottom a").forEach((a) => a.classList.toggle("on", a.dataset.view === section));

  try {
    if (hash.startsWith("#show/")) {
      const id = Number(hash.split("/")[1]);
      await renderShow(id, punch);
    } else if (hash.startsWith("#movie/")) {
      const id = Number(hash.split("/")[1]);
      await renderMovie(id, punch);
    } else if (hash === "#shows") {
      await renderShows(punch);
    } else if (hash === "#movies") {
      await renderMovies(punch);
    } else if (hash === "#discover") {
      await renderDiscover(punch);
    } else if (hash === "#profile") {
      await renderProfile(punch);
    }
  } catch {
    punch(`<div class="empty"><span class="e">📕</span>Something unhinged itself.<br><button class="btn quiet" onclick="location.reload()">Reload</button></div>`);
  }
}

async function ensureFollows() {
  if (!state.follows) state.follows = await api(`/api/follows?deviceId=${deviceId}`);
  return state.follows;
}

/* ── shows (front view — Up Next strip + Watch List, TV Time style) ── */
async function renderShows(punch) {
  punch(`
    <h1 class="h-view">Shows</h1>
    <p class="h-sub">${esc(fmtDay(new Date().toISOString()))} · your watch list and what's airing next</p>
    <div class="sk skrow"></div><div class="sk skrow"></div><div class="sk skrow"></div>
    <p class="note" style="text-align:center;margin-top:18px">Schedule data by <a href="https://www.tvmaze.com/" target="_blank" rel="noopener">TVmaze</a></p>
  `);
  const j = await ensureFollows();
  const shows = j.shows;

  const eps = shows.length
    ? (await api(`/api/tonight?deviceId=${deviceId}&window=${state.tonightWin}`)).episodes
    : [];
  state.tonight = eps;
  state.onAir = {};
  for (const e of eps) if (!e.watched) state.onAir[e.show_id] = true;

  // Up Next — TV Time's "Upcoming", surfaced at the top of the Shows tab
  let hero = "";
  const next = eps.find((e) => !e.watched && new Date(e.air_utc).getTime() >= Date.now());
  if (next) {
    const mins = (new Date(next.air_utc).getTime() - Date.now()) / 60000;
    hero = `<div class="next">
      <div style="flex:1;min-width:0">
        <div class="k">UP NEXT</div>
        <b>${esc(next.show_name)} · ${esc(code(next))}</b>
        <span class="cd" data-cd data-iso="${esc(next.air_utc)}">${esc(countdown(next.air_utc))}</span>
      </div>
      ${mins <= 45 ? '<span class="livechip">LIVE SOON</span>' : ""}
    </div>`;
  }

  const rows = eps.map((e) => {
    const mins = (new Date(e.air_utc).getTime() - Date.now()) / 60000;
    return `<div class="ev ${e.watched ? "watched" : ""} ${mins <= 45 ? "live" : ""}">
      <span class="t">${esc(fmtClock(e.air_utc))}</span>
      <span class="dot"></span>
      <div class="d"><b>${esc(e.show_name)} · ${esc(code(e))}</b>
        <span>${esc(e.episode_name || "—")} · ${esc(e.network || "")}</span>
        ${mins <= 45 ? '<span class="livechip">LIVE SOON</span>' : ""}</div>
      <button class="chk ${e.watched ? "done" : ""}" data-action="watch" data-ep="${e.id}" data-watched="${e.watched ? 1 : 0}" title="Mark/unmark watched">✓</button>
    </div>`;
  }).join("");

  const upcoming = shows.length ? `
    <div class="chips">
      <button class="chip ${state.tonightWin === 24 ? "on" : ""}" data-action="win" data-v="24">Next 24 h</button>
      <button class="chip ${state.tonightWin === 168 ? "on" : ""}" data-action="win" data-v="168">Next 7 days</button>
    </div>
    ${hero || ""}
    ${eps.length ? rows : `<div class="empty" style="padding:18px"><span class="e">🌙</span>Nothing airing ${state.tonightWin === 24 ? "in the next 24 hours" : "this week"} on your watch list.</div>`}
  ` : "";

  punch(`
    <h1 class="h-view">Shows</h1>
    <p class="h-sub">${esc(fmtDay(new Date().toISOString()))} · ${shows.length} on your watch list${eps.length ? ` · ${eps.length} airing` : ""}</p>
    ${upcoming}
    ${watchListBlock(shows)}
    <p class="note" style="text-align:center;margin-top:16px">Schedule data by <a href="https://www.tvmaze.com/" target="_blank" rel="noopener">TVmaze</a></p>
  `);
}

function watchListBlock(shows) {
  if (!shows.length) {
    return `
      <div class="sectT">WATCH LIST</div>
      <div class="empty"><span class="e">🪴</span>The watch list is empty.<br>
      Follow your first series and its airtimes light up here.<br><br>
      <a class="btn primary" href="#discover">Find shows</a></div>
      <p class="note" style="margin-top:14px;text-align:center">TV Time GDPR import arrives with accounts (weekend 3). Nothing here is throwaway — export anytime.</p>`;
  }

  const pct = (s) => (s.ep_total ? Math.min(100, Math.round((s.watched * 100) / s.ep_total)) : 0);
  const finished = (s) => s.ep_total > 0 && s.watched >= s.ep_total;

  let body = "";
  if (state.posterMode === "spines") {
    body = `<div class="spineRow">${shows.map((s) => `
      <div class="spine" style="background:${pick(SPINES, s.id)}" data-action="open" data-id="${s.id}" title="${esc(s.name)}">
        ${state.onAir[s.id] ? '<span class="rib"><svg viewBox="0 0 12 26" width="12" height="26"><path d="M0 0 H12 V26 L6 18 L0 26 Z" fill="#FB7185"/></svg></span>'
          : (pct(s) > 0 && !finished(s) ? '<span class="rib" style="top:-16px"><svg viewBox="0 0 12 26" width="12" height="26"><path d="M0 0 H12 V26 L6 18 L0 26 Z" fill="#F5A93F"/></svg></span>' : "")}
        <span class="st">${esc(s.name)}</span>
      </div>`).join("")}</div>
      <p class="note" style="margin-top:10px">Pink ribbon: airs soon · amber: mid-way through</p>`;
  } else {
    body = `<div class="pgrid">${shows.map((s) => `
      <div data-action="open" data-id="${s.id}" title="${esc(s.name)}">
        <div class="poster ${finished(s) ? "finished" : ""}">
          ${s.image ? `<img src="${esc(s.image)}" loading="lazy" onerror="this.remove()">` : `<div style="position:absolute;inset:0;background:${pick(PALETTES, s.id)};display:grid;place-items:center;font-family:Fraunces,serif;font-size:34px;color:rgba(255,255,255,.65)">${esc((s.name || "?")[0])}</div>`}
          ${state.onAir[s.id] ? '<span class="rib"><svg viewBox="0 0 12 26" width="12" height="26"><path d="M0 0 H12 V26 L6 18 L0 26 Z" fill="#FB7185"/></svg></span>' : ""}
          <div class="pb"><i style="width:${pct(s)}%"></i></div>
        </div>
        <div class="pmeta"><b>${esc(s.name)}</b>
          <span>${s.ep_total ? `${s.watched}/${s.ep_total} · ${finished(s) ? "finished" : pct(s) + "%"}` : "syncing…"}</span></div>
      </div>`).join("")}</div>`;
  }

  return `
    <div class="sectT">WATCH LIST · ${shows.length}</div>
    <div class="chips" style="margin-bottom:12px">
      <button class="chip ${state.posterMode === "posters" ? "on" : ""}" data-action="mode" data-v="posters">Poster view</button>
      <button class="chip ${state.posterMode === "spines" ? "on" : ""}" data-action="mode" data-v="spines">Spine view</button>
    </div>
    ${body}`;
}

/* ── show detail ─────────────────────────────────────── */
async function renderShow(id, punch) {
  punch(`
    <button class="crumb" onclick="location.hash='#shows'">← shows</button>
    <div class="sk skrow"></div><div class="sk skrow" style="height:80px"></div><div class="sk skrow"></div><div class="sk skrow"></div>
  `);
  const [showJ, epJ] = await Promise.all([
    api(`/api/shows/${id}`),
    api(`/api/shows/${id}/episodes?deviceId=${deviceId}`),
  ]);
  const s = showJ.show;
  const eps = epJ.episodes;
  state.show = s; state.episodes = eps;
  const nextWatched = showJ.next_episode ? !!eps.find((x) => x.id === showJ.next_episode.id)?.watched : false;

  // per-season progress
  const seasons = new Map();
  for (const e of eps) {
    const k = e.season;
    if (!seasons.has(k)) seasons.set(k, { total: 0, watched: 0 });
    const b = seasons.get(k);
    b.total++; if (e.watched) b.watched++;
  }
  const seasonKeys = [...seasons.keys()].sort((a, b) => a - b);
  const ladder = seasonKeys.map((k) => {
    const b = seasons.get(k);
    const cls = b.watched >= b.total ? "done" : (b.watched > 0 ? "part" : "");
    return `<i class="seg ${cls}" title="S${k}: ${b.watched}/${b.total}"></i>`;
  }).join("");
  const ladlbl = `<div class="ladlbl"><span>S${seasonKeys[0]} · ${seasons.get(seasonKeys[0]).watched}/${seasons.get(seasonKeys[0]).total}</span><span>${seasonKeys.length} season${seasonKeys.length === 1 ? "" : "s"}</span></div>`;

  const next = showJ.next_episode;
  const nextCard = next
    ? `<div class="shownext"><span class="k">NEXT UP</span>
        <b>${esc(code(next))} — ${state.reveal || nextWatched ? esc(next.name || "Untitled") : '<span style="color:var(--fg-faint);font-style:italic">spoiler-safe until watched</span>'}</b>
        ${next.air_utc ? `<div class="cd"><span data-cd data-iso="${esc(next.air_utc)}">${esc(countdown(next.air_utc))}</span> · ${esc(fmtDay(next.air_utc))} ${esc(fmtClock(next.air_utc))}${s.network ? " · " + esc(s.network) : ""}</div>` : '<div class="cd">airdate not confirmed yet</div>'}
       </div>`
    : `<div class="shownext"><span class="k">${s.status === "Ended" ? "COMPLETE" : "PROGRESS"}</span><b>${epJ.watched}/${epJ.count} watched</b>${s.status === "Ended" ? '<div class="cd">series ended — ribbon it done</div>' : '<div class="cd">no further airdates announced</div>'}</div>`;

  const spoilerBlock = s.summary
    ? `<div class="spoil ${state.reveal ? "" : "blur"}">
        <div class="note" style="font-family:var(--fm);font-size:9px;letter-spacing:.12em">SYNOPSIS</div>
        <p class="body" style="font-size:13px;color:var(--fg-dim);margin-top:6px">${esc(strip(s.summary))}</p>
        <div class="lockrow">${state.reveal ? `<button class="btn" data-action="toggle-reveal">🙈 Hide spoilers</button>` : `<span>🔒 <b>Spoiler-safe</b></span><button class="btn" data-action="toggle-reveal">👁 Reveal</button>`}</div>
       </div>`
    : "";

  const seasonRows = seasonKeys.slice().reverse().map((k) => {
    const b = seasons.get(k);
    const list = eps.filter((e) => e.season === k);
    const isCurrent = b.watched < b.total;
    return `<details class="season" ${isCurrent ? "open" : ""}>
      <summary><span>Season ${k}</span><span>${b.watched}/${b.total}</span></summary>
      ${list.map(epRow).join("")}
    </details>`;
  }).join("");

  function epRow(e) {
    const known = e.watched || state.reveal;
    const name = e.watched || state.reveal ? (e.name || "Untitled") : (e.number ? `Episode ${e.number}` : "Special/unaired");
    return `<div class="eprow">
      <button class="chk ${e.watched ? "done" : ""}" data-action="watch" data-ep="${e.id}" data-watched="${e.watched ? 1 : 0}">✓</button>
      <span class="d"><b class="${e.watched ? "" : known ? "" : "hinted"}">${esc(name)}${!e.watched && state.reveal ? " <span class='note'>(revealed)</span>" : ""}</b>
        <span>${esc(code(e))}${e.air_utc ? " · " + esc(fmtClock(e.air_utc)) : ""}</span></span>
      <span class="air">${e.airdate || "tbd"}</span>
    </div>`;
  }

  punch(`
    <button class="crumb" onclick="location.hash='#shows'">← shows</button>
    <h1 class="heroT">${esc(s.name)}</h1>
    <p class="heroS">${esc(s.network || "")}${s.network ? " · " : ""}${esc(s.status || "")}${s.schedule ? " · " + esc(s.schedule) : ""}</p>
    ${nextCard}
    ${ladder}${ladlbl}
    ${spoilerBlock}
    ${seasonRows}
    <p class="note" style="margin:16px 0 0;text-align:center">Episode + airtime data by <a href="https://www.tvmaze.com/" target="_blank" rel="noopener">TVmaze</a></p>
  `);
}

function tmdbSetupCard() {
  return `
    <div class="card exportcard">
      <div class="h-sub" style="margin-bottom:2px">SETUP · FREE TMDB KEY</div>
      <p class="note" style="margin-bottom:10px">The write side of this tab is already live — it needs one free key to light up film data.</p>
      <ol class="steps">
        <li>Create a free account at <a href="https://www.themoviedb.org/" target="_blank" rel="noopener">themoviedb.org</a> → Settings → API → “Developer”, copy the key.</li>
        <li>Local dev: create a <b>.dev.vars</b> file at the project root with <b>TMDB_TOKEN="your-key"</b>, then restart <b>npm run dev</b>.</li>
        <li>Deployed: <b>wrangler secret put TMDB_TOKEN</b> once per environment.</li>
      </ol>
      <p class="note">Your movies already live in the Seasonbook export — the watch state was always yours, the key only feeds posters and titles.</p>
    </div>
    <p class="note" style="text-align:center;margin-top:14px">Movie data by <a href="https://www.themoviedb.org/" target="_blank" rel="noopener">TMDB</a>.</p>`;
}

async function renderMovies(punch) {
  punch(`
    <h1 class="h-view">Movies</h1>
    <p class="h-sub">your film watch list — same rules as shows</p>
    <div class="sk skrow"></div><div class="sk skrow"></div><div class="sk skrow"></div>
  `);

  // Device list (D1-only, works with or without a TMDB key) + trending (key-gated).
  let mine = { count: 0, movies: [] };
  let trend = null, setup = false, fail = false;
  try {
    const res = await fetch(`/api/movies?deviceId=${deviceId}`);
    const j = await res.json().catch(() => ({}));
    if (res.ok) mine = j; else fail = true;
  } catch { fail = true; }
  try {
    const res = await fetch(`/api/movies/trending`);
    const j = await res.json().catch(() => ({}));
    if (j.error === "tmdb-token-missing") setup = true;
    else if (res.ok) trend = j.results || [];
  } catch { /* trending is optional garnish */ }

  const isUpcoming = (m) => m.release_date && new Date(m.release_date) > new Date();
  const gridRow = (m) => `
    <div data-action="open-m" data-id="${m.id}" title="${esc(m.title)}">
      <div class="poster ${m.state === "watched" ? "finished" : ""}">
        ${m.poster ? `<img src="${esc(m.poster)}" loading="lazy" onerror="this.remove()">`
          : `<div style="position:absolute;inset:0;background:${pick(PALETTES, m.id)};display:grid;place-items:center;font-family:Fraunces,serif;font-size:34px;color:rgba(255,255,255,.65)">${esc((m.title || "?")[0])}</div>`}
        ${m.state === "watched" ? '<span class="fin">✓</span>' : ""}
        <div class="pb"><i style="width:${m.state === "watched" ? 100 : isUpcoming(m) ? 0 : 25}%"></i></div>
      </div>
      <div class="pmeta"><b>${esc(m.title)}</b><span>${m.year || "—"}${isUpcoming(m) ? " · upcoming" : ""}</span></div>
    </div>`;

  const want = mine.movies.filter((m) => m.state === "want");
  const watched = mine.movies.filter((m) => m.state === "watched");

  let body;
  if (want.length || watched.length) {
    body = `${want.length ? `<div class="sectT">WANT TO WATCH · ${want.length}</div><div class="pgrid">${want.map(gridRow).join("")}</div>` : ""}
      ${watched.length ? `<div class="sectT" style="margin-top:18px">WATCHED · ${watched.length}</div><div class="pgrid">${watched.map(gridRow).join("")}</div>` : ""}`;
  } else {
    body = `<div class="empty"><span class="e">🎬</span>Your film list is empty.<br>${setup ? "Add a TMDB key, then search or pick from trending below." : "Search below or start from this week's trending films."}</div>`;
  }

  if (fail) {
    body += `<div class="empty" style="margin-top:14px;padding:16px"><span class="e">📡</span>Movie list hiccupped. <button class="btn" data-action="render-again">Retry</button></div>`;
  }

  if (setup) {
    punch(`
      <h1 class="h-view">Movies</h1>
      <p class="h-sub">your film watch list — same rules as shows</p>
      ${body}
      ${tmdbSetupCard()}
    `);
    return;
  }

  punch(`
    <h1 class="h-view">Movies</h1>
    <p class="h-sub">your film watch list — same rules as shows</p>
    ${body}
    <div class="sectT">FIND FILMS</div>
    <div class="searchrow"><input id="mq" placeholder="Try: Interstellar, Parasite, Dune…" autocomplete="off"></div>
    <div id="msr"></div>
    ${trend && trend.length ? `
      <div class="sectT">TRENDING THIS WEEK</div>
      <div id="trend">${trend.slice(0, 10).map((m) => `
        <div class="sr listing" data-action="open-m" data-id="${m.id}" title="Open ${esc(m.title)}">
          <img src="${esc(m.poster || "data:,")}" loading="lazy" onerror="this.remove()">
          <div class="d"><b>${esc(m.title)}</b><span>${m.year || "—"}${m.runtime ? " · " + m.runtime + " min" : ""}</span></div>
          <button class="btn" data-action="mstate" data-id="${m.id}" data-v="want" data-title="${esc(m.title)}">+ Want</button>
        </div>`).join("")}</div>` : `
      <div class="sectT">TRENDING THIS WEEK</div>
      <div id="trend" class="note" style="text-align:center;padding:8px 0">no trending data right now.</div>`}
    <p class="note" style="text-align:center;margin-top:16px">Movie data by <a href="https://www.themoviedb.org/" target="_blank" rel="noopener">TMDB</a></p>
  `);

  const input = $("#mq");
  if (input) {
    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => doMovieSearch(input.value.trim()), 380);
    });
    input.focus();
  }

  async function doMovieSearch(q) {
    const box = $("#msr");
    if (!box) return;
    if (!q) { box.innerHTML = ""; return; }
    try {
      const res = await fetch(`/api/movies/search?q=${encodeURIComponent(q)}`);
      const j = await res.json().catch(() => ({}));
      if (!box.isConnected) return;
      const has = new Set(mine.movies.map((x) => x.id));
      box.innerHTML = res.ok && j.results?.length
        ? j.results.map((m) => `
          <div class="sr listing" data-action="open-m" data-id="${m.id}" title="Open ${esc(m.title)}">
            <img src="${esc(m.poster || "data:,")}" loading="lazy" onerror="this.remove()">
            <div class="d"><b>${esc(m.title)}</b><span>${m.year || "—"}${m.runtime ? " · " + m.runtime + " min" : ""}</span></div>
            <button class="btn ${has.has(m.id) ? "" : "primary"}" data-action="mstate" data-id="${m.id}" data-v="want" data-title="${esc(m.title)}">
              ${has.has(m.id) ? "✓ On list" : "+ Want"}</button>
          </div>`).join("")
        : `<div class="empty"><span class="e">🔎</span>Nothing found for “${esc(q)}”</div>`;
    } catch {
      box.innerHTML = `<div class="empty"><span class="e">📡</span>Search hiccupped. Try again.</div>`;
    }
  }
}

/* ── movie detail ─────────────────────────────────────── */
async function renderMovie(id, punch) {
  punch(`
    <button class="crumb" onclick="location.hash='#movies'">← movies</button>
    <div class="sk skrow"></div><div class="sk skrow" style="height:80px"></div><div class="sk skrow"></div>
  `);
  let j;
  try {
    const res = await fetch(`/api/movies/${id}?deviceId=${deviceId}`);
    j = await res.json().catch(() => ({}));
    if (j.error === "tmdb-token-missing") {
      punch(`
        <button class="crumb" onclick="location.hash='#movies'">← movies</button>
        <h1 class="h-view">Movies</h1>
        <p class="h-sub">setup needed for film pages</p>
        ${tmdbSetupCard()}`);
      return;
    }
    if (!res.ok) throw new Error("http " + res.status);
  } catch {
    punch(`
      <button class="crumb" onclick="location.hash='#movies'">← movies</button>
      <div class="empty"><span class="e">🎬</span>Couldn't load that film.<br><button class="btn quiet" onclick="location.reload()">Reload</button></div>`);
    return;
  }
  const m = j.movie;
  const st = j.state?.state || "";
  const upcoming = m.release_date && new Date(m.release_date) > new Date();
  const released = m.status === "Released";
  punch(`
    <button class="crumb" onclick="location.hash='#movies'">← movies</button>
    <div class="mdetail">
      ${m.poster ? `<img src="${esc(m.poster)}" onerror="this.remove()">` : ""}
      <div style="min-width:0">
        <h2>${esc(m.title)}</h2>
        <div class="meta">${m.year || "—"}${m.runtime ? " · " + m.runtime + " min" : ""}${m.status ? " · " + esc(m.status) : ""}</div>
        ${released && !upcoming && m.release_date ? `<div class="meta" style="margin-top:4px">released ${esc(m.release_date)}</div>` : ""}
        ${upcoming ? `<div style="margin-top:8px"><span class="upchip">RELEASES ${esc(m.release_date)}</span></div>` : ""}
      </div>
    </div>
    <div class="macts">
      <button class="btn ${st === "want" ? "primary" : ""}" data-action="mstate" data-id="${m.id}" data-v="want">${st === "want" ? "✓ On your list" : "＋ Want to watch"}</button>
      <button class="btn ${st === "watched" ? "primary" : ""}" data-action="mstate" data-id="${m.id}" data-v="watched">${st === "watched" ? "↩ Un-mark" : "✓ Watched"}</button>
      ${st ? '<button class="btn" data-action="mstate" data-id="' + m.id + '" data-v="remove" title="Track nothing">✕</button>' : ""}
    </div>
    ${m.overview ? `<div class="card" style="margin-bottom:14px"><div class="h-sub" style="margin-bottom:4px">OVERVIEW</div><p class="body" style="font-size:13px;color:var(--fg-dim)">${esc(m.overview)}</p></div>` : ""}
    <p class="note" style="text-align:center;margin-top:14px">Movie data by <a href="https://www.themoviedb.org/" target="_blank" rel="noopener">TMDB</a></p>
  `);
}

/* ── discover (search + on-TV-today listings) ────────── */
async function renderDiscover(punch) {
  punch(`
    <h1 class="h-view">Discover</h1>
    <p class="h-sub">find shows to follow · see what's on TV today</p>
    <div class="searchrow"><input id="q" placeholder="Try: Breaking Bad, Arcane, Game of Thrones…" autocomplete="off"></div>
    <div id="sr"></div>
    <div class="sectT">ON TV TODAY</div>
    <div class="chips">${["US", "GB", "IN", "CA", "AU"].map((c) =>
      `<button class="chip ${state.discCountry === c ? "on" : ""}" data-action="disc-country" data-v="${c}">${c}</button>`).join("")}</div>
    <div id="sched"><div class="sk skrow"></div><div class="sk skrow"></div><div class="sk skrow"></div></div>
    <p class="note" style="text-align:center;margin-top:16px">Listings + catalog by <a href="https://www.tvmaze.com/" target="_blank" rel="noopener">TVmaze</a> · broadcast TV only</p>
  `);
  const input = $("#q");
  let t;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => doSearch(input.value.trim()), 350);
  });
  input.focus();

  async function doSearch(q) {
    const box = $("#sr");
    if (!box) return;
    if (!q) { box.innerHTML = ""; return; }
    try {
      const j = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (!box.isConnected) return;
      const follows = await ensureFollows();
      const ids = new Set(follows.shows.map((x) => x.id));
      box.innerHTML = j.results.length
        ? j.results.map((s) => `
          <div class="sr">
            <img src="${esc(s.image || "data:,")}" onerror="this.remove()">
            <div class="d"><b>${esc(s.name)}</b>
              <span>${esc(s.network || "—")} · ${esc(s.status || "")}${s.premiered ? " · " + esc(s.premiered.slice(0, 4)) : ""}</span></div>
            <button class="btn ${ids.has(s.id) ? "" : "primary"}" data-action="follow" data-id="${s.id}" data-on="${ids.has(s.id) ? 1 : 0}">
              ${ids.has(s.id) ? "✓ On list" : "+ Follow"}</button>
          </div>`).join("")
        : `<div class="empty"><span class="e">🔎</span>Nothing found for “${esc(q)}”</div>`;
    } catch {
      box.innerHTML = `<div class="empty"><span class="e">📡</span>Search hiccupped. Try again.</div>`;
    }
  }

  try {
    const j = await api(`/api/schedule?country=${encodeURIComponent(state.discCountry)}`);
    const sched = $("#sched");
    if (!sched) return;
    sched.innerHTML = j.listings.filter((r) => r.show).length
      ? j.listings.filter((r) => r.show).slice(0, 80).map((r) => `
        <div class="sr listing" data-action="open" data-id="${r.show_id}" title="Open ${esc(r.show)}">
          <img src="${esc(r.image || "data:,")}" loading="lazy" onerror="this.remove()">
          <div class="d"><b>${esc(r.show)}</b>
            <span>${esc(r.network || "—")}${r.number ? ` · S${String(r.season).padStart(2, "0")}E${String(r.number).padStart(2, "0")}` : ""}</span></div>
          <span class="rt">${esc(r.time || "")}</span>
        </div>`).join("")
      : `<div class="empty" style="padding:16px"><span class="e">📼</span>No broadcast listings returned for ${esc(j.country || state.discCountry)} today. Try another region.</div>`;
  } catch {
    const sched = $("#sched");
    if (sched) sched.innerHTML = `<div class="empty" style="padding:16px"><span class="e">📡</span>Schedule hiccupped. Try again.</div>`;
  }
}

/* ── profile (stats on top · your data + settings below, TV Time style) ── */
async function renderProfile(punch) {
  punch(`
    <h1 class="h-view">Profile</h1>
    <p class="h-sub">stats · your data · settings</p>
    <div class="sk skrow"></div><div class="sk skrow"></div>
  `);
  const j = await ensureFollows();
  const shows = j.shows;
  const watched = shows.reduce((n, s) => n + (s.watched || 0), 0);
  const epsAll = shows.reduce((n, s) => n + (s.ep_total || 0), 0);
  const pctAll = epsAll ? Math.min(100, Math.round((watched * 100) / epsAll)) : 0;

  // movie half of the clock (silently absent when the TMDB tab has no key)
  let mvWanted = 0, mvWatched = 0, mvMins = 0;
  try {
    const res = await fetch(`/api/movies?deviceId=${deviceId}`);
    const mj = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(mj.movies)) {
      for (const m of mj.movies) {
        if (m.state === "want") mvWanted++;
        else if (m.state === "watched") { mvWatched++; mvMins += m.runtime || 100; }
      }
    }
  } catch { /* movies stay optional */ }

  const mins = watched * 45 + mvMins; // shows ≈45 min/ep + film runtimes
  const h = Math.floor(mins / 60), m = mins % 60;

  const badges = [
    { e: "🌱", t: "First follow", ok: shows.length >= 1 },
    { e: "1️⃣", t: "Episode one", ok: watched >= 1 },
    { e: "🔟", t: "Ten club", ok: watched >= 10 },
    { e: "🏆", t: "Fifty club", ok: watched >= 50 },
    { e: "🌗", t: "Halfway hero", ok: shows.some((s) => s.ep_total > 0 && s.watched * 2 >= s.ep_total) },
    { e: "🏁", t: "Series finisher", ok: shows.some((s) => s.ep_total > 0 && s.watched >= s.ep_total) },
    { e: "🎬", t: "First film", ok: mvWatched >= 1 },
  ]
    .filter((b) => b.ok || mvWatched > 0 || watched > 0 || shows.length > 0) // hide the whole row on a fresh device
    .map((b) => `<span class="badge ${b.ok ? "" : "off"}">${b.e}${b.t}</span>`)
    .join("");

  const ics = `${location.origin}/calendar.ics?deviceId=${deviceId}`;
  punch(`
    <h1 class="h-view">Profile</h1>
    <p class="h-sub">stats · your data · settings</p>
    <div class="pcard">
      <span class="avatar big"><span>${esc(avLetter())}</span></span>
      <div style="min-width:0">
        <b>Your watch history, one device</b>
        <span class="mono" style="font-size:10px;color:var(--fg-faint)">${esc(deviceId.slice(0, 12))}… · local · wk1</span>
      </div>
    </div>
    <div class="pstat">
      <div class="st hl"><i class="k">TV TIME (EST)</i><b>${h ? h + " h " : ""}${m} m</b><span>shows ≈45 min/ep + film runtimes</span></div>
      <div class="st"><i class="k">EPISODES</i><b>${watched}</b><span>of ${epsAll} aired</span></div>
      <div class="st"><i class="k">SHOWS</i><b>${shows.length}</b><span>on your watch list</span></div>
      <div class="st"><i class="k">MOVIES</i><b>${mvWatched}</b><span>watched${mvWanted ? ` · ${mvWanted} queued` : ""}</span></div>
      <div class="st"><i class="k">COMPLETE</i><b>${pctAll}%</b><span>across series</span></div>
    </div>
    <div class="sectT">BADGES</div>
    <div class="badges">${badges}</div>
    <div class="sectT">YOUR DATA</div>
    <div class="card exportcard">
      <div class="h-sub" style="margin-bottom:2px">CALENDAR FEED (ICS)</div>
      <p class="note">Subscribes in Google Calendar (“From URL”), Apple Calendar, Outlook, anything. Auto-refreshes: past 7 days → next 180 days of airtimes.</p>
      <code id="icsurl">${esc(ics)}</code>
      <button class="btn primary" data-action="copy-ics">Copy feed URL</button>
    </div>
    <div class="card exportcard">
      <div class="h-sub" style="margin-bottom:2px">FULL JSON COPY</div>
      <p class="note">Shows, watch state with timestamps. Human-readable, machine-loadable — the anti-lock-in file.</p>
      <a class="btn primary" href="/export.json?deviceId=${encodeURIComponent(deviceId)}" download>Download seasonbook.json</a>
    </div>
    <p class="note" style="text-align:center;margin-top:14px">Accounts, TV Time GDPR import and airtime alerts arrive with weekend 3 — the export above never goes away. Schedule data by <a href="https://www.tvmaze.com/" target="_blank" rel="noopener">TVmaze</a>.</p>
  `);
}

function avLetter() {
  let sum = 0;
  for (const ch of deviceId) sum = (sum + ch.charCodeAt(0)) % 26;
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[sum];
}

/* ── interactions (event delegation) ─────────────────── */
$("#view").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  const a = t.dataset.action;

  if (a === "win") {
    state.tonightWin = Number(t.dataset.v);
    localStorage.setItem("sb_win", t.dataset.v);
    render();
  } else if (a === "mode") {
    state.posterMode = t.dataset.v;
    localStorage.setItem("sb_post", t.dataset.v);
    render();
  } else if (a === "disc-country") {
    state.discCountry = t.dataset.v;
    localStorage.setItem("sb_disc", t.dataset.v);
    render();
  } else if (a === "open-m") {
    location.hash = `#movie/${t.dataset.id}`;
  } else if (a === "render-again") {
    render();
  } else if (a === "mstate") {
    e.stopPropagation();
    await setMovieState(t);
  } else if (a === "open") {
    location.hash = `#show/${t.dataset.id}`;
  } else if (a === "toggle-reveal") {
    state.reveal = !state.reveal;
    if (state.show) renderShow(state.show.id, (html) => {
      const v = $("#view"); const seqAt = state.seq;
      if (seqAt === state.seq) v.innerHTML = `<div class="enter">${html}</div>`;
    });
  } else if (a === "watch") {
    e.stopPropagation();
    await toggleWatch(t);
  } else if (a === "follow") {
    e.preventDefault();
    const on = t.dataset.on === "1";
    if (on) {
      if (!confirm("Remove this show from your watch list?")) return;
      t.textContent = "…";
      await post("/api/follow", { deviceId, showId: Number(t.dataset.id), action: "remove" });
      state.follows = null;
      t.textContent = "+ Follow"; t.dataset.on = "0"; t.classList.add("primary");
      toast("Removed from watch list");
    } else {
      t.textContent = "Syncing…"; t.disabled = true;
      try {
        await post("/api/follow", { deviceId, showId: Number(t.dataset.id), action: "add" });
        state.follows = null;
        t.textContent = "✓ On list"; t.dataset.on = "1"; t.disabled = false; t.classList.remove("primary");
        toast("On your watch list — airtimes light up in Shows");
      } catch { t.textContent = "+ Follow"; t.disabled = false; }
    }
  } else if (a === "copy-ics") {
    const s = $("#icsurl").textContent;
    try { await navigator.clipboard.writeText(s); toast("Feed URL copied"); }
    catch { toast("Copy blocked by browser — select the URL manually", true); }
  }
});

async function setMovieState(btn) {
  const id = Number(btn.dataset.id);
  const v = btn.dataset.v; // want | watched | unwatched | remove
  // optimistic on trending/search rows: flip the button label before the roundtrip
  if (btn.textContent.includes("+ Want")) btn.textContent = "…";
  try {
    await post("/api/movie-state", { deviceId, movieId: id, state: v });
    if (v === "want") toast("On your film list");
    else if (v === "watched") toast("Marked watched — counted toward your stats");
    else if (v === "unwatched") toast("Back on the want list");
    else toast("Removed from tracking");
    render();
  } catch {
    if (btn.textContent === "…") btn.textContent = "+ Want";
  }
}

async function toggleWatch(btn) {
  const epId = Number(btn.dataset.ep);
  const was = btn.dataset.watched === "1";
  // optimistic
  btn.classList.toggle("done", !was);
  btn.dataset.watched = was ? "0" : "1";
  const row = btn.closest(".ev, .eprow");
  if (row) row.classList.toggle("watched", !was);
  // optimistic local cache
  if (state.episodes) { const r = state.episodes.find((x) => x.id === epId); if (r) r.watched = !was; }

  try {
    await post("/api/watched", { deviceId, episodeId: epId, state: was ? "remove" : "add" });
    state.follows = null; // progress changed
    if (!was) toast("Marked watched — more of the watch list lights up");
  } catch {
    btn.classList.toggle("done", was);
    btn.dataset.watched = was ? "1" : "0";
    if (row) row.classList.toggle("watched", was);
    if (state.episodes) { const r = state.episodes.find((x) => x.id === epId); if (r) r.watched = was; }
  }
}

/* ── countdown ticker ────────────────────────────────── */
setInterval(() => {
  document.querySelectorAll("[data-cd]").forEach((n) => {
    n.textContent = countdown(n.dataset.iso);
  });
}, 15000);

window.addEventListener("hashchange", render);

// topbar: bell lives outside #view, so it gets its own listener
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-action='alerts']")) {
    toast("Airtime alerts arrive with accounts (weekend 3)");
  }
});

$("#avletter").textContent = avLetter();
render();
