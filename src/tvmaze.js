// TVmaze helpers — free API, attribution required (shown in PWA footer).
// Ettiquette: 12h cache TTL lives in index.js syncShow(); never fetch per-request for hot paths.

const API = "https://api.tvmaze.com";

export async function searchShows(q) {
  const res = await fetch(`${API}/search/shows?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`tvmaze search failed (${res.status})`);
  return res.json(); // [{ score, show }]
}

export async function fetchShow(id) {
  const res = await fetch(`${API}/shows/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`tvmaze show ${id} failed (${res.status})`);
  return res.json();
}

export async function fetchEpisodes(id) {
  const res = await fetch(`${API}/shows/${id}/episodes`);
  if (!res.ok) throw new Error(`tvmaze episodes ${id} failed (${res.status})`);
  return res.json();
}

export function compactShow(show) {
  const schedule = [
    (show.schedule?.days || []).map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", "),
    show.schedule?.time,
  ].filter(Boolean).join(" ");
  return {
    id: show.id,
    name: show.name,
    premiered: show.premiered,
    status: show.status,
    network: show.network?.name || show.webChannel?.name || null,
    timezone: show.network?.country?.timezone || null,
    schedule: schedule || null,
    runtime: show.averageRuntime,
    image: show.image?.medium || show.image?.original || null,
  };
}
