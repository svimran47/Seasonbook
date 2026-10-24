// FCM HTTP v1 from a Worker — the Seasonbook notification relay (weekend 2).
// Contract (design/BRIEF.md): FCM topic-per-show ("show-<tvmazeId>"), one message per episode,
// notification = "show · SxxEyy" title + one fact + time offset, device lane (Android) reschedules independently.
// Same philosophy as TMDB: nothing here is fatal without credentials — callers answer 501
// {error:"fcm-service-account-missing"} to routes, the cron skips announcing, everything else keeps running.

import { SignJWT, importPKCS8 } from "jose";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = (projectId) =>
  `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

const tokenCache = { held: null, until: 0 }; // per-isolate cache; Google tokens live 1 h

export function fcmConfigured(env) {
  return !!env.FCM_SERVICE_ACCOUNT;
}

function serviceAccount(env) {
  if (!env.FCM_SERVICE_ACCOUNT) {
    const e = new Error("fcm-service-account-missing");
    e.setup = true;
    throw e;
  }
  let sa;
  try {
    sa = JSON.parse(env.FCM_SERVICE_ACCOUNT);
  } catch {
    throw new Error("FCM_SERVICE_ACCOUNT is not valid JSON — paste the whole service-account key file");
  }
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new Error("service-account JSON is missing project_id / client_email / private_key");
  }
  return sa;
}

async function accessToken(env) {
  const sa = serviceAccount(env);
  if (tokenCache.held && tokenCache.until > Date.now() + 120000) return tokenCache.held;
  const iat = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(sa.private_key, "RS256");
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(key);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`google oauth failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  if (!out.access_token) throw new Error("google oauth returned no access_token");
  tokenCache.held = out.access_token;
  tokenCache.until = Date.now() + 60 * 60 * 1000;
  return tokenCache.held;
}

export function topicFor(showId) {
  return `show-${Number(showId)}`;
}

export function airtimeTitle(showName, season, number) {
  const code = number
    ? `S${String(season ?? 0).padStart(2, "0")}E${String(number).padStart(2, "0")}`
    : `S${season} special`;
  return `${showName} · ${code}`;
}

export function leadLabel(minutes) {
  if (minutes <= 0) return "starts now";
  if (minutes >= 110) return "starts in ~2 h";
  if (minutes >= 55) return "starts in ~1 h";
  return `starts in ${Math.max(minutes, 1)} min`;
}

export function airtimeMessage(row) {
  const minutes = Math.round((new Date(row.air_utc).getTime() - Date.now()) / 60000);
  const fact = row.episode_name ? `“${row.episode_name}” — ` : "New episode — ";
  const where = row.network ? ` on ${row.network}` : "";
  return {
    topic: topicFor(row.show_id),
    title: airtimeTitle(row.show_name, row.season, row.number),
    body: `New episode: ${fact}${leadLabel(minutes)}${where}.`,
    data: { type: "airtime", show_id: String(row.show_id), episode_id: String(row.id), air_utc: row.air_utc },
  };
}

export async function sendToTopic(env, { topic, title, body, data = {} }) {
  const sa = serviceAccount(env);
  const token = await accessToken(env);
  const res = await fetch(SEND_URL(sa.project_id), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        topic,
        notification: { title, body },
        data,
        android: { priority: "high", notification: { channel_id: "airtime" } },
      },
    }),
  });
  if (!res.ok) throw new Error(`fcm send failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
