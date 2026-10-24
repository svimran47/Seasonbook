# scripts/setup-firebase.ps1 - one-shot Firebase provisioning for the Seasonbook
# notification engine. Run AFTER `firebase login` succeeds (google browser flow).
#
# Does: find-or-create the GCP/Firebase project (reuses an existing seasonbook-tv-*
#       project and attaches Firebase features when the account is out of project
#       creation quota) -> register Android app (com.svimranmy.seasonbook) -> fetch
#       google-services.json into android/app/ -> create service account + grant
#       roles/firebasenotifications.admin -> mint private key -> wire FCM_SERVICE_ACCOUNT
#       into .dev.vars (preserves existing lines) -> `wrangler secret put` for prod.
#
# Idempotent: safe to re-run; every step detects what already exists.
# Never prints the private key. The key json lands in .fcm-service-account.json (gitignored).

#Requires -Version 5.1
param(
  [string]$PackageName = "com.svimranmy.seasonbook",
  [string]$DisplayName = "Seasonbook"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Info($m) { Write-Host $m -ForegroundColor DarkCyan }
function Ok($m)   { Write-Host $m  -ForegroundColor DarkGreen }
function Fail($m) { throw $m }

# -- 0. preconditions -------------------------------------------------------
Info "- checking firebase CLI auth -"
cmd /c "firebase projects:list 2>nul" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "not logged in; run: firebase login (browser flow), then re-run this script" }
Ok "authenticated"

# -- 0.5 bearer token + REST helper (cloud-platform scope comes with the CLI login) --
$authFile = Join-Path $env:USERPROFILE ".config\configstore\firebase-tools.json"
if (-not (Test-Path $authFile)) { Fail "no configstore at $authFile" }
$rawStore = Get-Content $authFile -Raw
$m = [regex]::Match($rawStore, "ya29\.[A-Za-z0-9_\-\.\[\]]+")
if (-not $m.Success) { Fail "no access token in configstore; try: firebase login --force" }
$token = $m.Value
Ok "bearer token acquired"

function REST([string]$method, [string]$url, $payload = $null) {
  $headers = @{ Authorization = "Bearer $token" }
  if ($payload) {
    Invoke-RestMethod -Method $method -Uri $url -Headers $headers -ContentType "application/json" -Body ($payload | ConvertTo-Json -Depth 5)
  } else {
    Invoke-RestMethod -Method $method -Uri $url -Headers $headers
  }
}

# -- 1. find (GCP-level, covers non-Firebase projects) or create the project --
Info "- looking for an existing Seasonbook GCP project -"
$gcp = "https://cloudresourcemanager.googleapis.com/v1"
$list = REST GET "$gcp/projects?pageSize=100"
$mine = @($list.projects | Where-Object { $_.projectId -like "seasonbook*" -and $_.lifecycleState -eq "ACTIVE" } | Sort-Object projectId)
if ($mine.Count -gt 0) {
  $ProjectId = $mine[0].projectId
  Ok "reusing project $ProjectId"
  if ($mine.Count -gt 1) {
    Info "- pruning $($mine.Count - 1) leftover dup project(s) from earlier failed attempts -"
    foreach ($extra in ($mine | Select-Object -Skip 1)) {
      try { $null = Invoke-RestMethod -Method DELETE -Uri "$gcp/projects/$($extra.projectId)" -Headers @{ Authorization = "Bearer $token" }; Ok "  soft-deleted $($extra.projectId)" }
      catch { Info "  could not delete $($extra.projectId): $($_.Exception.Message)" }
    }
  }
} else {
  $ProjectId = "seasonbook-tv-" + ((Get-Random -Maximum 12968).ToString("x4")) + ((Get-Random -Maximum 12968).ToString("x4"))
  Info "creating project $ProjectId"
  $attempt = 0
  while ($true) {
    $attempt++
    cmd /c "firebase projects:create $ProjectId --display-name $DisplayName 2>nul" | Out-Null
    $exists = $false
    try { $null = REST GET "$gcp/projects/$ProjectId"; $exists = $true } catch { }
    if ($LASTEXITCODE -eq 0 -and $exists) { break }
    if ($exists) { break }   # CLI sometimes reports failure after the project actually exists
    if ($attempt -ge 4) {
      Fail "project create failed after 4 attempts; if the error is project-quota, reuse/reclaim a project on the account or request a quota increase"
    }
    $ProjectId = "seasonbook-tv-" + ((Get-Random -Maximum 12968).ToString("x4")) + ((Get-Random -Maximum 12968).ToString("x4"))
    Info "  create failed; retrying with $ProjectId (attempt $attempt)"
  }
  Ok "project created: $ProjectId"
}

# -- 1b. ensure Firebase features on the project ------------------------------
Info "- ensuring Firebase features on $ProjectId -"
try {
  $op = REST POST "https://firebase.googleapis.com/v1beta1/projects/$ProjectId`:addFirebase" $null
  $tries = 0
  while (-not $op.done -and $tries -lt 30) {
    Start-Sleep -Seconds 4
    $tries++
    $op = REST GET "https://firebase.googleapis.com/v1beta1/$($op.name)"
  }
  if ($op.error) { Fail "addFirebase failed: $($op.error.message)" }
  Ok "firebase features attached"
} catch {
  $code = 0
  try { $code = [int]$_.Exception.Response.StatusCode } catch { }
  if ($code -eq 409) { Ok "project already Firebase-enabled (409)" }
  else {
    $fbList = (cmd /c "firebase projects:list --json 2>nul" | ConvertFrom-Json).result
    $fb = $fbList | Where-Object { $_.projectId -eq $ProjectId }
    if ($fb) { Ok "project already Firebase-enabled" }
    else { Fail "addFirebase failed ($($_.Exception.Message)) and the project is not Firebase-visible" }
  }
}
Start-Sleep -Seconds 3   # let the CLI's project cache settle

# -- 2. register the Android app --------------------------------------------
Info "- registering Android app $PackageName -"
$appsListRaw = (cmd /c "firebase apps:list ANDROID --project $ProjectId --json 2>nul" | ConvertFrom-Json)
$appsJson = if ($appsListRaw.result) { $appsListRaw.result } else { $appsListRaw.results }
$app = $appsJson | Where-Object { $_.packageName -eq $PackageName } | Select-Object -First 1
if ($app) {
  $AppId = $app.appId
  Ok "app already registered: $AppId"
} else {
  cmd /c "firebase apps:create ANDROID $DisplayName -a $PackageName --project $ProjectId 2>nul" | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "apps:create failed" }
  $appsListRaw = (cmd /c "firebase apps:list ANDROID --project $ProjectId --json 2>nul" | ConvertFrom-Json)
  $appsJson = if ($appsListRaw.result) { $appsListRaw.result } else { $appsListRaw.results }
  $AppId = ($appsJson | Where-Object { $_.packageName -eq $PackageName } | Select-Object -First 1).appId
  if (-not $AppId) { Fail "app created but appId not found" }
  Ok "app registered: $AppId"
}

# -- 3. google-services.json into android/app/ -------------------------------
Info "- fetching google-services.json -"
$gsDest = Join-Path $root "android\app\google-services.json"
$sdkOut = (cmd /c "firebase apps:sdkconfig ANDROID $AppId --project $ProjectId 2>nul") -join ""
$m = [regex]::Match($sdkOut, "\{.*\}", "Singleline")   # CLI may print banners around the JSON
if (-not $m.Success) { Fail "could not read sdkconfig; print it manually with: firebase apps:sdkconfig ANDROID $AppId --project $ProjectId" }
$cfg = $m.Value | ConvertFrom-Json
$msAppId = $cfg.mobilesdk_app_id
if (-not $msAppId -and $cfg.client) { $msAppId = (@($cfg.client)[0]).client_info.mobilesdk_app_id }
if (-not $msAppId) { Fail "sdkconfig json missing mobilesdk_app_id" }
if (-not (Test-Path $gsDest)) {
  $cfg | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $gsDest
}
Ok "google-services.json at android/app/ (appId $msAppId)"

# -- 4. service account + role + private key --------------------------------
$saEmail = "seasonbook-fcm@$ProjectId.iam.gserviceaccount.com"
$base = "https://iam.googleapis.com/v1/projects/$ProjectId/serviceAccounts"

Info "- ensuring service account $saEmail -"
try { $null = REST GET "$base/$saEmail"; Ok "service account exists" }
catch {
  REST POST $base @{ accountId = "seasonbook-fcm"; serviceAccount = @{ displayName = "Seasonbook FCM engine" } } | Out-Null
  Ok "service account created"
}

Info "- granting roles/firebase.admin (project-level; this carries the FCM-send permission set) -"
$crm = "https://cloudresourcemanager.googleapis.com/v1/projects/$ProjectId"
$ppolicy = REST POST "${crm}:getIamPolicy" @{ }
$existingBindings = @()
if ($ppolicy.PSObject.Properties['bindings']) { $existingBindings = @($ppolicy.bindings) }
$binding = $existingBindings | Where-Object { $_.role -eq "roles/firebase.admin" -and $_.members -contains "serviceAccount:$saEmail" }
if (-not $binding) {
  $newBindings = $existingBindings + @{ role = "roles/firebase.admin"; members = @("serviceAccount:$saEmail") }
  $ppolicy | Add-Member -NotePropertyName bindings -NotePropertyValue $newBindings -Force
  $body = @{ policy = $ppolicy } | ConvertTo-Json -Depth 6
  Invoke-RestMethod -Method POST -Uri "${crm}:setIamPolicy" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $body | Out-Null
  Ok "role granted"
} else { Ok "role already present" }

Info "- minting a private key -"
$keyJson = REST POST "$base/$saEmail/keys" $null
$plain = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($keyJson.privateKeyData))
$sa = $plain | ConvertFrom-Json
if (-not ($sa.private_key -and $sa.client_email -and $sa.project_id)) { Fail "key minted but malformed" }
$keyPath = Join-Path $root ".fcm-service-account.json"
$plain | Set-Content -Encoding UTF8 $keyPath
Ok "private key written to $(Split-Path -Leaf $keyPath) (gitignored)"

# -- 5. wire FCM_SERVICE_ACCOUNT into .dev.vars (preserve existing lines) ----
# stored as BASE64 of the key json: dotenv-safe (single line, no quotes/newlines/hash-chars);
# src/fcm.js decodes base64 or takes raw JSON transparently.
Info "- updating .dev.vars (base64 form) -"
$dvPath = Join-Path $root ".dev.vars"
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain))
$lines = @([IO.File]::ReadAllLines($dvPath) | Where-Object { $_ -notmatch "^FCM_SERVICE_ACCOUNT=" })
$lines += "FCM_SERVICE_ACCOUNT=$b64"
[IO.File]::WriteAllLines($dvPath, $lines)
Ok ".dev.vars updated (TMDB + switches untouched)"

# -- 6. prod secret ----------------------------------------------------------
Info "- pushing prod secret (wrangler, base64 form) -"
$b64 | npx wrangler secret put FCM_SERVICE_ACCOUNT 2>&1 | Select-Object -Last 2
if ($LASTEXITCODE -ne 0) { Fail "wrangler secret put failed; run it manually and redeploy" }

# -- 7. summary ----------------------------------------------------------------
Write-Host ""
Write-Host "SUMMARY:" -ForegroundColor Yellow
Write-Host "  project             : $ProjectId"
Write-Host "  android app         : $AppId ($PackageName)"
Write-Host "  google-services.json: android/app/ (commit it; gradle activates FCM automatically)"
Write-Host "  local  (.dev.vars)  : FCM_SERVICE_ACCOUNT set"
Write-Host "  prod   (secret)     : FCM_SERVICE_ACCOUNT pushed"
Write-Host "next: restart npm run dev (local check) and npx wrangler deploy (binds the prod secret)"
