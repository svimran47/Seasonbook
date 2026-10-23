# End-to-end smoke test for the weekend-1 spine.
# Needs the dev server running: `npm run dev` then `npm run smoke`
$ErrorActionPreference = "Stop"
$base = "http://localhost:8787"

# 0. wait for the local server (up to ~30s)
$up = $false
for ($i = 0; $i -lt 40; $i++) {
  try { Invoke-RestMethod "$base/api" | Out-Null; $up = $true; break }
  catch { Start-Sleep -Milliseconds 700 }
}
if (-not $up) { throw ('server did not answer on ' + $base + ' — run `npm run dev` in another terminal first') }

# 1. PWA shell served
$root = Invoke-WebRequest -UseBasicParsing "$base/"
Write-Host ("ROOT      : HTTP {0}; PWA shell present: {1}" -f $root.StatusCode, ($root.Content -match 'Seasonbook'))

# 2. TVmaze search passthrough
$search = Invoke-RestMethod "$base/api/search?q=breaking+bad"
$showId = $search.results[0].id
Write-Host ("SEARCH    : {0} results; first = {1} (id {2})" -f $search.count, $search.results[0].name, $showId)

# 3. follow = sync into D1 + follow row
$body = '{"deviceId":"smoke-test","showId":' + $showId + ',"action":"add"}'
$follow = Invoke-RestMethod -Method Post "$base/api/follow" -ContentType "application/json" -Body $body
Write-Host ("FOLLOW    : following {0}; synced_episodes = {1}" -f $follow.following, $follow.sync.episodes)

# 4. cached show detail with next/last episode
$show = Invoke-RestMethod "$base/api/shows/$showId"
Write-Host ("SHOW      : {0} ({1}); last_episode air_utc = {2}" -f $show.show.name, $show.show.status, $show.last_episode.air_utc)

# 5. upcoming query against real cached data — anchor 48h before a dated episode so the window must contain it
$anchor = if ($show.next_episode) { $show.next_episode.air_utc } elseif ($show.last_episode) { $show.last_episode.air_utc } else { $null }
if ($anchor) {
  $from = ([datetime]$anchor).ToUniversalTime().AddHours(-48).ToString("yyyy-MM-ddTHH:mm:ss'Z'")
  $tonight = Invoke-RestMethod "$base/api/tonight?deviceId=smoke-test&from=$from&window=300"
  if ($tonight.count -lt 1) { throw "upcoming query empty inside a window that must contain an episode" }
  $first = $tonight.episodes[0]
  $code = if ($first.number) { 'S{0:d2}E{1:d2}' -f $first.season, $first.number } else { ('S' + $first.season + ' special') }
  Write-Host ("EPISODES  : {0} rows anchored near known episode; first = {1} {2} @ {3}" -f $tonight.count, $first.show_name, $code, $first.air_utc)
} else {
  Write-Host "EPISODES  : skip (no dated episodes cached)"
}

# 6. ICS feed parseable, has events, right content type
$ics = Invoke-WebRequest -UseBasicParsing "$base/calendar.ics?deviceId=smoke-test&past_days=20000&future_days=3"
$events = ($ics.Content -split 'BEGIN:VEVENT').Count - 1
$summary = ($ics.Content -split "`r`n" | Select-String '^SUMMARY:' | Select-Object -First 1).Line
Write-Host ("ICS       : {0} events; type = {1}; sample: {2}" -f $events, $ics.Headers['Content-Type'], $summary.Trim())

# 7. true next-24h window (ended show → 0 is correct)
$next24 = Invoke-RestMethod "$base/api/tonight?deviceId=smoke-test"
Write-Host ("NEXT-24H  : {0} upcoming episodes" -f $next24.count)

Write-Host "SMOKE OK"
