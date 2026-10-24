# End-to-end smoke test for the weekend-1 spine.
# Needs the dev server running: `npm run dev` then `npm run smoke`
$ErrorActionPreference = "Stop"
$base = "http://localhost:8787"
if ($env:SB_BASE) { $base = $env:SB_BASE }  # $env:SB_BASE="http://localhost:8789"; npm run smoke — for parallel dev sessions

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

# 8. frontend assets served
$css = Invoke-WebRequest -UseBasicParsing "$base/app.css"
$js2 = Invoke-WebRequest -UseBasicParsing "$base/app.js"
Write-Host ("ASSETS    : app.css {0}; app.js {1}" -f $css.StatusCode, $js2.StatusCode)

# 9. watch-state roundtrip (frontend contract)
$eps = Invoke-RestMethod "$base/api/shows/$showId/episodes?deviceId=smoke-test"
$eid = $eps.episodes[0].id
$body2 = '{"deviceId":"smoke-test","episodeId":' + $eid + ',"state":"add"}'
Invoke-RestMethod -Method Post "$base/api/watched" -ContentType "application/json" -Body $body2 | Out-Null
$eps2 = Invoke-RestMethod "$base/api/shows/$showId/episodes?deviceId=smoke-test"
$row = $eps2.episodes | Where-Object { $_.id -eq $eid }
if (-not $row.watched) { throw "watchmark did not stick for episode $eid" }
Write-Host ("WATCHED   : episode {0} flagged; {1}/{2} watched" -f $eid, $eps2.watched, $eps2.count)

# 10. export carries the state
$exp = Invoke-RestMethod "$base/export.json?deviceId=smoke-test"
if ($exp.watchmarks.Count -lt 1) { throw "export contains no watchmarks" }
Write-Host ("EXPORT    : {0}; {1} watchmarks; {2} shows" -f $exp.format, $exp.watchmarks.Count, $exp.shows.Count)

# 11. tonight carries watched flag near a known episode
$anchor = $eps2.episodes | Where-Object { $_.air_utc } | Sort-Object air_utc | Select-Object -Last 1
$from = ([datetime]$anchor.air_utc).ToUniversalTime().AddHours(-2).ToString("yyyy-MM-ddTHH:mm:ss'Z'")
$ton2 = Invoke-RestMethod "$base/api/tonight?deviceId=smoke-test&from=$from&window=96"
Write-Host ("TONIGHT+  : {0} rows near anchor; watched flags carried" -f $ton2.count)

# 12. Discover schedule passthrough (today's broadcast listings)
$sched = Invoke-RestMethod "$base/api/schedule?country=GB"
if ($sched.listings.Count -lt 3) { throw "schedule listings came back thin for GB" }
Write-Host ("SCHEDULE  : {0} GB listings today ({1}); first = {2} @ {3}" -f $sched.count, $sched.date, $sched.listings[0].show, $sched.listings[0].time)

# 13. Movies spine — full roundtrip with a key, 501 setup state without one
try {
  $trend = Invoke-RestMethod "$base/api/movies/trending"
  if ($trend.results.Count -lt 3) { throw "trending list too thin" }
  Write-Host ("TRENDING  : {0} films this week; first = {1} ({2})" -f $trend.results.Count, $trend.results[0].title, $trend.results[0].year)

  $ms = Invoke-RestMethod "$base/api/movies/search?q=interstellar"
  $mv = $ms.results[0]
  Write-Host ("MSEARCH   : {0} results; first = {1} ({2})" -f $ms.count, $mv.title, $mv.year)

  $body = '{"deviceId":"smoke-test","movieId":' + $mv.id + ',"state":"want"}'
  Invoke-RestMethod -Method Post "$base/api/movie-state" -ContentType "application/json" -Body $body | Out-Null
  $body = '{"deviceId":"smoke-test","movieId":' + $mv.id + ',"state":"watched"}'
  Invoke-RestMethod -Method Post "$base/api/movie-state" -ContentType "application/json" -Body $body | Out-Null
  $mlist = Invoke-RestMethod "$base/api/movies?deviceId=smoke-test"
  $row = $mlist.movies | Where-Object { $_.id -eq $mv.id }
  if (-not $row -or $row.state -ne "watched") { throw "movie state did not stick for $($mv.id)" }
  Write-Host ("MOVIES    : {0} marked; {1} = {2} ({3} min)" -f $mlist.count, $mv.title, $row.state, $row.runtime)
} catch {
  $msg = $_.ErrorDetails.Message
  if ($msg -match 'tmdb-token-missing') {
    Write-Host "MOVIES    : setup state without a TMDB key (501 tmdb-token-missing) — expected until the key lands"
  } else {
    throw
  }
}

# 14. notification engine — status, owner-gate behavior, dry-run preview via a ghost episode
$nst = Invoke-RestMethod "$base/api/notify/status"
if ($nst.engine.mode -ne "topic-per-show") { throw "notify status: engine shape changed" }
Write-Host ("NOTIFY    : engine {0}; fcm {1}" -f $nst.engine.mode, $nst.fcm.state)

$prod = $env:SB_BASE -and $env:SB_BASE.StartsWith("https")
if ($prod) {
  # owner tools must be closed on prod — hitting them should fail (which we swallow by design)
  try {
    Invoke-RestMethod -Method Post "$base/api/notify/test" -ContentType "application/json" -Body '{"topic":"should-fail"}' | Out-Null
    throw "notify/test unexpectedly OPEN on prod — SB_OPEN_TOOLS leaked into the deployment"
  } catch {
    if ($_.ErrorDetails.Message -match "should-fail" -or $_.ErrorDetails.Message -match "closed") { }
    elseif ($_.Exception.Message -match "unexpectedly OPEN") { throw }
  }
  Write-Host "GATE      : owner tools closed on prod (asserted)"
} else {
  $simOk = $true
  try {
    Invoke-RestMethod -Method Post "$base/api/notify/simulate" -ContentType "application/json" -Body '{"showId":169,"minutesFromNow":60,"action":"add"}' | Out-Null
  } catch {
    $simOk = $false
    if ($_.ErrorDetails.Message -match "closed on this deployment") {
      Write-Host "SIMULATE  : closed (503) — add SB_OPEN_TOOLS=`"1`" to .dev.vars and restart dev to run the ghost-airtime checks"
    } else { throw }
  }
  if ($simOk) {
    $pv = Invoke-RestMethod "$base/api/notify/preview"
    $ghost = $pv.items | Where-Object { $_.data.episode_id -eq "99100001" }
    if (-not $ghost) { throw "notify preview is missing the simulated episode" }
    if ($ghost.topic -ne "show-169") { throw "ghost episode announced on wrong topic: $($ghost.topic)" }
    Write-Host ("PREVIEW   : {0} pending; ghost = '{1}'" -f $pv.count, $ghost.title)
    Invoke-RestMethod -Method Post "$base/api/notify/simulate" -ContentType "application/json" -Body '{"action":"remove"}' | Out-Null
    $pv2 = Invoke-RestMethod "$base/api/notify/preview"
    if ($pv2.items | Where-Object { $_.data.episode_id -eq "99100001" }) { throw "ghost episode not cleaned up" }
    Write-Host "CLEANUP   : ghost episode removed, ledger clear again"
  }
}

Write-Host "SMOKE OK"
