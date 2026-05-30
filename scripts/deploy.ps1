# Deploy Operation Oland to Unraid.
#
# Mirrors the WeatherCompare deploy flow:
#   1. Stops any local `node` process so PowerShell can clean files
#   2. Removes build artefacts so SCP does not ship hundreds of MB
#   3. SCPs the project (including dot-files) to Unraid
#   4. SSHs in, rebuilds the Docker image, restarts the container
#   5. Runs a few smoke tests against the live container
#
# Usage:
#   npm run deploy
#   pwsh scripts/deploy.ps1
#   pwsh scripts/deploy.ps1 -SkipClean     # keep node_modules / dist
#   pwsh scripts/deploy.ps1 -SkipBuild     # only re-run container, no rebuild
#
# ASCII-only — Windows PowerShell 5.1 chokes on UTF-8 special characters.

[CmdletBinding()]
param(
    [switch]$SkipClean,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

# --- Edit these once for your environment -----------------------------------
$UnraidHost     = "root@192.168.0.6"
$RemotePath     = "/mnt/user/appdata/operationoland"
$ContainerName  = "operationoland"
$SyncContainer  = "operationoland-sync"
$SpaImage       = "operationoland:latest"
$SyncImage      = "operationoland-sync:latest"
$SyncVolume     = "operationoland_sync-data"
$Network        = "authentik_network"
$HostPort       = "8091"
# ----------------------------------------------------------------------------

$ProjectRoot = Split-Path -Parent $PSScriptRoot

function Step([string]$msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Ok([string]$msg)     { Write-Host "    [ok]   $msg" -ForegroundColor Green }
function Warn([string]$msg)   { Write-Host "    [warn] $msg" -ForegroundColor Yellow }
function Failed([string]$msg) { Write-Host "    [FAIL] $msg" -ForegroundColor Red }

function Invoke-Ssh([string]$cmd) {
    & ssh $UnraidHost $cmd
    if ($LASTEXITCODE -ne 0) {
        throw "Remote command failed (exit $LASTEXITCODE): $cmd"
    }
}

# --- Resolve VITE_ORS_API_KEY -----------------------------------------------
# Priority: existing env var > .env.local in project root.
$OrsKey = $env:VITE_ORS_API_KEY
if (-not $OrsKey) {
    $envLocal = Join-Path $ProjectRoot ".env.local"
    if (Test-Path $envLocal) {
        $line = Select-String -Path $envLocal -Pattern "^\s*VITE_ORS_API_KEY\s*=" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($line) {
            $OrsKey = ($line.Line -replace "^\s*VITE_ORS_API_KEY\s*=\s*", "").Trim('"').Trim("'")
        }
    }
}
if (-not $OrsKey) {
    Warn "VITE_ORS_API_KEY not set in env or .env.local — road routes will fall back to straight lines."
}

# --- Resolve ADMIN_TOKEN ----------------------------------------------------
# Without it the sync service runs in OPEN MODE (any client can mutate admin
# state). Generate with `openssl rand -hex 24` and put it in .env.local as
# ADMIN_TOKEN=... — same place as VITE_ORS_API_KEY.
$AdminToken = $env:ADMIN_TOKEN
if (-not $AdminToken) {
    $envLocal = Join-Path $ProjectRoot ".env.local"
    if (Test-Path $envLocal) {
        $line = Select-String -Path $envLocal -Pattern "^\s*ADMIN_TOKEN\s*=" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($line) {
            $AdminToken = ($line.Line -replace "^\s*ADMIN_TOKEN\s*=\s*", "").Trim('"').Trim("'")
        }
    }
}
if (-not $AdminToken) {
    Warn "ADMIN_TOKEN not set — sync server starts in OPEN MODE (no admin auth)."
}

# --- 1. Kill local node processes that may be holding file locks ------------
Step "Stopping local node processes (release file locks)"
Get-Process node -ErrorAction SilentlyContinue | ForEach-Object {
    $pidToKill = $_.Id
    try {
        Stop-Process -Id $pidToKill -Force -ErrorAction Stop
        Ok "killed node PID $pidToKill"
    } catch [Microsoft.PowerShell.Commands.ProcessCommandException] {
        # Process already exited (likely a child of one we just killed).
    }
}
Start-Sleep -Milliseconds 500

# --- 2. Clean local build artefacts -----------------------------------------
if (-not $SkipClean) {
    Step "Cleaning local build artefacts"
    $toRemove = @(
        "node_modules",
        "dist"
    )
    foreach ($p in $toRemove) {
        $full = Join-Path $ProjectRoot $p
        if (Test-Path $full) {
            Remove-Item -Recurse -Force $full
            Ok "removed $p"
        }
    }
} else {
    Warn "skipping clean (SkipClean)"
}

# --- 3. SCP to Unraid -------------------------------------------------------
Step "SCP project -> ${UnraidHost}:${RemotePath}"
Invoke-Ssh "mkdir -p $RemotePath"
Push-Location $ProjectRoot
try {
    & scp -r * "${UnraidHost}:${RemotePath}/"
    if ($LASTEXITCODE -ne 0) { throw "scp (main) failed (exit $LASTEXITCODE)" }
    Ok "main tree copied"

    $dotFiles = @(".dockerignore", ".gitignore") | Where-Object { Test-Path $_ }
    if ($dotFiles.Count -gt 0) {
        & scp @dotFiles "${UnraidHost}:${RemotePath}/"
        if ($LASTEXITCODE -ne 0) { throw "scp (dot-files) failed (exit $LASTEXITCODE)" }
        Ok "dot-files copied: $($dotFiles -join ', ')"
    }
} finally {
    Pop-Location
}

# --- 4. Build + run on Unraid -----------------------------------------------
# Two containers: the nginx SPA and the Node sync server. We use plain
# `docker run` rather than `docker compose` because the Compose CLI plugin
# isn't installed on the Unraid host. The docker-compose.yml in the repo
# is kept around for local development only.

Step "Stopping current containers (if any)"
Invoke-Ssh "docker stop $ContainerName 2>/dev/null; docker rm $ContainerName 2>/dev/null; true"
Invoke-Ssh "docker stop $SyncContainer 2>/dev/null; docker rm $SyncContainer 2>/dev/null; true"
Ok "stopped"

Step "Ensuring sync data volume exists"
Invoke-Ssh "docker volume inspect $SyncVolume >/dev/null 2>&1 || docker volume create $SyncVolume"
Ok "volume ready"

if (-not $SkipBuild) {
    Step "Building sync image on Unraid"
    Invoke-Ssh "cd $RemotePath && docker build -t $SyncImage ./server"
    Ok "sync image built"

    Step "Building SPA image on Unraid (2-4 min)"
    $buildArg = if ($OrsKey) { "--build-arg VITE_ORS_API_KEY=$OrsKey" } else { "" }
    Invoke-Ssh "cd $RemotePath && docker build $buildArg -t $SpaImage ."
    Ok "SPA image built"
} else {
    Warn "skipping build (SkipBuild)"
}

Step "Starting sync container"
$syncEnv = ""
if ($AdminToken) { $syncEnv = "-e ADMIN_TOKEN='$AdminToken'" }
$syncRun = @"
docker run -d \
  --name $SyncContainer \
  --restart unless-stopped \
  --network $Network \
  -e PORT=8090 \
  -e DB_PATH=/app/data/state.db \
  $syncEnv \
  -v ${SyncVolume}:/app/data \
  $SyncImage
"@
Invoke-Ssh $syncRun
Ok "sync container started"

Step "Starting SPA container"
$spaRun = @"
docker run -d \
  --name $ContainerName \
  --restart unless-stopped \
  --network $Network \
  -p ${HostPort}:80 \
  $SpaImage
"@
Invoke-Ssh $spaRun
Ok "SPA container started"

Start-Sleep -Seconds 3

# --- 5. Smoke tests ---------------------------------------------------------
Step "Smoke testing http://localhost:${HostPort}/"
$tests = @(
    "/",
    "/admin",
    "/index.html",
    "/api/health",
    "/api/state"
)
$failed = @()
foreach ($t in $tests) {
    $code = & ssh $UnraidHost "curl -s -o /dev/null -w '%{http_code}' 'http://localhost:${HostPort}${t}'" 2>$null
    if ($code -match "^2\d\d$") {
        Ok "$t -> $code"
    } else {
        Failed "$t -> $code"
        $failed += $t
    }
}

# --- 6. Final report --------------------------------------------------------
Write-Host ""
if ($failed.Count -eq 0) {
    Write-Host "Deploy succeeded - all smoke tests passed." -ForegroundColor Green
    Write-Host "  Container: http://192.168.0.6:${HostPort}/" -ForegroundColor Gray
} else {
    Write-Host "Deploy completed but some smoke tests failed:" -ForegroundColor Yellow
    foreach ($t in $failed) { Write-Host "    - $t" -ForegroundColor Yellow }
    Write-Host "  Check container logs:" -ForegroundColor Yellow
    Write-Host "    ssh $UnraidHost docker logs $ContainerName" -ForegroundColor Gray
    exit 1
}
