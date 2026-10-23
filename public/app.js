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
async function render() {
  state.reveal = state.reveal || false;
  const hash = location.hash || "#tonight";
  const seq = ++state.seq;
  const view = $("#view");
  view.firstRenderDone = view.firstRenderDone || false;

  const punch = (html) => { if (seq === state.seq) { view.innerHTML = `<div class="enter">${html}</div>`; window.scrollTo(0, 0); } };

  // nav active state
  const section = hash.startsWith("#show/") ? "shelf" : hash.replace("#", "");
  document.querySelectorAll(".bottom a").forEach((a) => a.classList.toggle("on", a.dataset.view === section));

  try {
    if (hash.startsWith("#show/")) {
      const id = Number(hash.split("/")[1]);
      await renderShow(id, punch);
    } else if (hash === "#shelf") {
      await renderShelf(punch);
    } else if (hash === "#search") {
      await renderSearch(punch);
    } else if (hash === "#export") {
      await renderExport(punch);
    } else {
      if (hash !== "#tonight") location.hash = "#tonight";
      await renderTonight(punch);
    }
  } catch {
    punch(`<div class="empty"><span class="e">📕</span>Something unhinged itself.<br><button class="btn quiet" onclick="location.reload()">Reload</button></div>`);
  }
}

async function ensureFollows() {
  if (!state.follows) state.follows = await api(`/api/follows?deviceId=${deviceId}`);
  return state.follows;
}

/* ── tonight ─────────────────────────────────────────── */
async function renderTonight(punch) {
  punch(`
    <h1 class="h-view">Tonight</h1>
    <p class="h-sub">${esc(fmtDay(new Date().toISOString()))} · your shelf's airing schedule</p>
    <div class="chips">
      <button class="chip ${state.tonightWin === 24 ? "on" : ""}" data-action="win" data-v="24">Next 24 h</button>
      <button class="chip ${state.tonightWin === 168 ? "on" : ""}" data-action="win" data-v="168">Next 7 days</button>
    </div>
    <div class="sk skrow"></div><div class="sk skrow"></div><div class="sk skrow"></div>
    <p class="note" style="text-align:center;margin-top:18px">Schedule data by <a href="https://www.tvmaze.com/" target="_blank" rel="noopener">TVmaze</a></p>
  `);
  const j = await api(`/api/tonight?deviceId=${deviceId}&window=${state.tonightWin}`);
  const eps = j.episodes;
  state.tonight = eps;
  state.onAir = {};
  for (const e of eps) if (!e.watched) state.onAir[e.show_id] = true;

  let hero = "";
  const next = eps.find((e) => !e.watched && new Date(e.air_utc).getTime() >= Date.now());
  if (next) {
    const mins = (new Date(next.air_utc).getTime() - Date.now()) / 60000;
    hero = `<div class="next">
      <div style="flex:1;min-width:0">
        <div class="k">NEXT UP</div>
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

  const empty = `
    <div class="empty"><span class="e">🌙</span>
      Nothing airing ${state.tonightWin === 24 ? "in the next 24 hours" : "this week"} on your shelf.<br><br>
      <a class="btn primary" href="#search">Find shows to follow</a></div>`;

  punch(`
    <h1 class="h-view">Tonight</h1>
    <p class="h-sub">${esc(fmtDay(new Date().toISOString()))} · ${eps.length} airing</p>
    <div class="chips">
      <button class="chip ${state.tonightWin === 24 ? "on" : ""}" data-action="win" data-v="24">Next 24 h</button>
      <button class="chip ${state.tonightWin === 168 ? "on" : ""}" data-action="win" data-v="168">Next 7 days</button>
    </div>
    ${hero || ""}
    ${eps.length ? rows : empty}
    ${eps.length ? '<p class="note" style="text-align:center;margin-top:16px">Schedule data by <a href="https://www.tvmaze.com/" target="_blank" rel="noopener">TVmaze</a></p>' : "Data by <span class='note'><a href='https://www.tvmaze.com/' target='_blank' rel='noopener'>TVmaze</a></span>"}
  `);
}

/* ── shelf ───────────────────────────────────────────── */
async function renderShelf(punch) {
  punch(`
    <h1 class="h-view">Shelf</h1>
    <p class="h-sub">your shows — history owned, exportable, never deleted</p>
    <div class="sk skrow"></div><div class="sk skrow"></div><div class="sk skrow"></div>
  `);
  const j = await ensureFollows();
  const shows = j.shows;

  if (!shows.length) {
    punch(`
      <h1 class="h-view">Shelf</h1><p class="h-sub">your shows — history owned, exportable, never deleted</p>
      <div class="empty"><span class="e">🪴</span>The shelf is empty.<br>
      Follow your first series and tonight's schedule appears here.<br><br>
      <a class="btn primary" href="#search">Find shows</a></div>
      <p class="note" style="margin-top:14px;text-align:center">TV Time GDPR import arrives with accounts (weekend 3). Nothing here is throwaway — export anytime.</p>
    `);
    return;
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

  punch(`
    <h1 class="h-view">Shelf</h1>
    <p class="h-sub">${shows.length} show${shows.length === 1 ? "" : "s"} · history owned, exportable, never deleted</p>
    <div class="chips">
      <button class="chip ${state.posterMode === "posters" ? "on" : ""}" data-action="mode" data-v="posters">Poster view</button>
      <button class="chip ${state.posterMode === "spines" ? "on" : ""}" data-action="mode" data-v="spines">Spine view</button>
    </div>
    ${body}
    <p class="note" style="text-align:center;margin-top:18px">TV Time GDPR import arrives with accounts (weekend 3) — export anytime meanwhile.</p>
  `);
}

/* ── show detail ─────────────────────────────────────── */
async function renderShow(id, punch) {
  punch(`
    <button class="crumb" onclick="location.hash='#shelf'">← shelf</button>
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
    <button class="crumb" onclick="location.hash='#shelf'">← shelf</button>
    <h1 class="heroT">${esc(s.name)}</h1>
    <p class="heroS">${esc(s.network || "")}${s.network ? " · " : ""}${esc(s.status || "")}${s.schedule ? " · " + esc(s.schedule) : ""}</p>
    ${nextCard}
    ${ladder}${ladlbl}
    ${spoilerBlock}
    ${seasonRows}
    <p class="note" style="margin:16px 0 0;text-align:center">Episode + airtime data by <a href="https://www.tvmaze.com/" target="_blank" rel="noopener">TVmaze</a></p>
  `);
}

/* ── search ──────────────────────────────────────────── */
async function renderSearch(punch) {
  punch(`
    <h1 class="h-view">Search</h1>
    <p class="h-sub">find shows by name — follow puts them on your shelf</p>
    <div class="searchrow"><input id="q" placeholder="Try: Breaking Bad, Arcane, Game of Thrones…" autocomplete="off"></div>
    <div id="sr"></div>
    <p class="note" style="text-align:center;margin-top:16px">Catalog data by <a href="https://www.tvmaze.com/" target="_blank" rel="noopener">TVmaze</a></p>
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
    if (!q) { box.innerHTML = ""; return; }
    try {
      const j = await api(`/api/search?q=${encodeURIComponent(q)}`);
      const follows = await ensureFollows();
      const ids = new Set(follows.shows.map((x) => x.id));
      box.innerHTML = j.results.length
        ? j.results.map((s) => `
          <div class="sr">
            <img src="${esc(s.image || "data:,")}" onerror="this.remove()">
            <div class="d"><b>${esc(s.name)}</b>
              <span>${esc(s.network || "—")} · ${esc(s.status || "")}${s.premiered ? " · " + esc(s.premiered.slice(0, 4)) : ""}</span></div>
            <button class="btn ${ids.has(s.id) ? "" : "primary"}" data-action="follow" data-id="${s.id}" data-on="${ids.has(s.id) ? 1 : 0}">
              ${ids.has(s.id) ? "✓ On shelf" : "+ Follow"}</button>
          </div>`).join("")
        : `<div class="empty"><span class="e">🔎</span>Nothing found for “${esc(q)}”</div>`;
    } catch {
      box.innerHTML = `<div class="empty"><span class="e">📡</span>Search hiccupped. Try again.</div>`;
    }
  }
}

/* ── export ──────────────────────────────────────────── */
async function renderExport(punch) {
  const ics = `${location.origin}/calendar.ics?deviceId=${deviceId}`;
  punch(`
    <h1 class="h-view">Export</h1>
    <p class="h-sub">your data leaves any time you say so — the brand promise</p>
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
    <p class="note" style="text-align:center;margin-top:14px">CSV + one-click TV Time GDPR import arrive with accounts (weekend 3). Schedule data by <a href="https://www.tvmaze.com/" target="_blank" rel="noopener">TVmaze</a>.</p>
  `);
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
      if (!confirm("Remove this show from your shelf?")) return;
      t.textContent = "…";
      await post("/api/follow", { deviceId, showId: Number(t.dataset.id), action: "remove" });
      state.follows = null;
      t.textContent = "+ Follow"; t.dataset.on = "0"; t.classList.add("primary");
      toast("Removed from shelf");
    } else {
      t.textContent = "Syncing…"; t.disabled = true;
      try {
        await post("/api/follow", { deviceId, showId: Number(t.dataset.id), action: "add" });
        state.follows = null;
        t.textContent = "✓ On shelf"; t.dataset.on = "1"; t.disabled = false; t.classList.remove("primary");
        toast("On the shelf — tonight updates automatically");
      } catch { t.textContent = "+ Follow"; t.disabled = false; }
    }
  } else if (a === "copy-ics") {
    const s = $("#icsurl").textContent;
    try { await navigator.clipboard.writeText(s); toast("Feed URL copied"); }
    catch { toast("Copy blocked by browser — select the URL manually", true); }
  }
});

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
    if (!was) toast("Marked watched — more of the shelf lights up");
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
render();
