// Minimal RFC 5545 ICS builder (UTC timestamps — calendar clients handle local conversion).

function esc(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsUTC(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}$/, "Z");
}

// RFC 5545 says lines should not exceed ~75 octets; fold with CRLF + space.
function fold(line) {
  if (line.length <= 73) return line;
  let out = "";
  for (let i = 0; i < line.length; i += 73) {
    out += (i === 0 ? "" : "\r\n ") + line.slice(i, i + 73);
  }
  return out;
}

// rows: [{ ep_id, show_id, show_name, network, season, number, episode_name, air_utc, runtime }]
export function buildICS(rows, calName = "Seasonbook") {
  const out = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Seasonbook//Weekend 1//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calName)}`,
    "X-WR-TIMEZONE:UTC",
  ];
  for (const row of rows) {
    if (!row.air_utc) continue;
    const start = new Date(row.air_utc);
    if (isNaN(start.getTime())) continue;
    const end = new Date(start.getTime() + (row.runtime || 45) * 60000);
    const code = row.number
      ? `S${String(row.season).padStart(2, "0")}E${String(row.number).padStart(2, "0")}`
      : `S${row.season} special`;
    out.push(
      "BEGIN:VEVENT",
      `UID:seasonbook-${row.ep_id}-${row.show_id}@seasonbook`,
      `DTSTAMP:${icsUTC(new Date())}`,
      `DTSTART:${icsUTC(start)}`,
      `DTEND:${icsUTC(end)}`,
      `SUMMARY:${esc(`${row.show_name} — ${code}`)}`,
      `DESCRIPTION:${esc(`${row.show_name} · ${row.episode_name || "Untitled"} (${code})${row.network ? " · " + row.network : ""}`)}`,
      ...(row.network ? [`LOCATION:${esc(row.network)}`] : []),
      "END:VEVENT"
    );
  }
  out.push("END:VCALENDAR");
  return out.map(fold).join("\r\n") + "\r\n";
}
