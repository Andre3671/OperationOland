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

# --- 4. Bring up the stack via docker compose -------------------------------
# Two services: the nginx SPA container and the Node sync server. The compose
# file reads VITE_ORS_API_KEY and ADMIN_TOKEN from the shell env on the
# remote host, so we prefix the command with them.
$composeEnv = ""
if ($OrsKey)     { $composeEnv += "VITE_ORS_API_KEY='$OrsKey' " }
if ($AdminToken) { $composeEnv += "ADMIN_TOKEN='$AdminToken' " }

Step "Stopping current stack (if any)"
Invoke-Ssh "cd $RemotePath && (docker compose down 2>/dev/null; true)"
Ok "stopped"

if (-not $SkipBuild) {
    Step "Building + starting stack on Unraid (2-4 min)"
    Invoke-Ssh "cd $RemotePath && ${composeEnv}docker compose up -d --build"
    Ok "stack up"
} else {
    Warn "skipping build (SkipBuild)"
    Invoke-Ssh "cd $RemotePath && ${composeEnv}docker compose up -d"
    Ok "stack started (no rebuild)"
}

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
