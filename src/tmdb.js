// TMDB helpers — the movie data spine (title/poster/overview metadata, watch-state lives in D1).
// One free key covers it all: v3 api_key string or a v4 Bearer token pasted whole.
// Etiquette: detail cache TTL 12h lives in index.js cacheMovie(); search/trending pass straight through.

const API = "https://api.themoviedb.org/3";
export const TMDB_IMG = "https://image.tmdb.org/t/p/w342";

// Shared error so routes can answer 501 with setup instructions instead of a raw 500.
export function tmdbMissing() {
  const e = new Error("tmdb-token-missing");
  e.setup = true;
  return e;
}

async function get(env, path, params = {}) {
  const token = env.TMDB_TOKEN;
  if (!token) throw tmdbMissing();
  const url = new URL(API + path);
  const headers = {};
  if (token.startsWith("ey")) headers.authorization = `Bearer ${token}`;
  else url.searchParams.set("api_key", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("language", "en-US");
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const e = new Error(`tmdb ${path} failed (${res.status})`);
    if (res.status === 401) e.setup = true; // rejected key == bad token in place
    throw e;
  }
  return res.json();
}

export async function searchMovies(env, q) {
  const j = await get(env, "/search/movie", { query: q });
  return (j.results || []).map(compactMovie);
}

export async function trendingMovies(env) {
  const j = await get(env, "/trending/movie/week");
  return (j.results || []).map(compactMovie);
}

export async function fetchMovie(env, id) {
  try {
    return await get(env, `/movie/${id}`);
  } catch (e) {
    if (String(e.message).includes("(404)")) return null;
    throw e;
  }
}

export function compactMovie(m) {
  return {
    id: m.id,
    title: m.title,
    year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    release_date: m.release_date || null,
    runtime: m.runtime ?? null,
    poster: m.poster_path ? TMDB_IMG + m.poster_path : null,
    overview: m.overview || null,
    status: m.status || null,
  };
}
