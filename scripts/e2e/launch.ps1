<#
.SYNOPSIS
  Launch TracePilot with Chrome DevTools Protocol (CDP) enabled for automation.

.DESCRIPTION
  Starts TracePilot in dev mode with a CDP remote debugging port exposed on localhost.
  Auto-selects an available port from 9222-9232 to avoid conflicts.
  Uses per-port PID tracking to avoid collisions with other debugging sessions.

.PARAMETER Port
  Specific port to use (default: auto-select from 9222-9232).

.PARAMETER Build
  If set, launches a built binary instead of `tauri dev`.

.PARAMETER NoWatch
  If set, disables Vite HMR file watching (more stable for automation).

.EXAMPLE
  .\scripts\e2e\launch.ps1
  .\scripts\e2e\launch.ps1 -Port 9225
  .\scripts\e2e\launch.ps1 -NoWatch
#>

param(
    [int]$Port = 0,
    [switch]$Build,
    [switch]$NoWatch
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path "$PSScriptRoot\..\.."

# PID/port files are per-port to support sequential sessions on different ports.
# .tracepilot-cdp.port   — last-used port (for auto-discovery by connect.mjs)
# .tracepilot-cdp.<port>.pid — PID for that specific port instance
# Note: Only one TracePilot instance can run at a time (WebView2 user-data-dir lock).
$portFile = "$PSScriptRoot\.tracepilot-cdp.port"

function Get-PidFile([int]$p) { return "$PSScriptRoot\.tracepilot-cdp.$p.pid" }

# --- Port selection ---
function Test-PortAvailable {
    param([int]$TestPort)
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $TestPort)
        $listener.Start()
        $listener.Stop()
        return $true
    } catch {
        return $false
    }
}

if ($Port -eq 0) {
    for ($p = 9222; $p -le 9232; $p++) {
        if (Test-PortAvailable $p) {
            $Port = $p
            break
        }
    }
    if ($Port -eq 0) {
        Write-Error "[launch] No available CDP port in range 9222-9232. Close other debugging sessions."
        exit 1
    }
    Write-Host "[launch] Auto-selected CDP port: $Port" -ForegroundColor Cyan
} else {
    if (-not (Test-PortAvailable $Port)) {
        Write-Error "[launch] Port $Port is already in use."
        exit 1
    }
    Write-Host "[launch] Using requested CDP port: $Port" -ForegroundColor Cyan
}

$pidFile = Get-PidFile $Port

# --- Cleanup stale instance on this port ---
if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($oldPid) {
        $oldProc = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
        if ($oldProc) {
            Write-Host "[launch] Stopping stale process on port $Port (PID $oldPid)..." -ForegroundColor Yellow
            Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# --- Set CDP environment variable ---
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port --remote-debugging-address=127.0.0.1"

Write-Host "[launch] CDP will be available at http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host "[launch] Starting TracePilot..." -ForegroundColor Cyan

# --- Launch ---
Set-Location $repoRoot

if ($Build) {
    $exePath = "$repoRoot\target\debug\tracepilot-desktop.exe"
    if (-not (Test-Path $exePath)) {
        Write-Host "[launch] Building debug binary..." -ForegroundColor Yellow
        cargo build -p tracepilot-desktop
    }
    $proc = Start-Process -FilePath $exePath -PassThru
} else {
    # pnpm may be .cmd or .ps1 depending on the installation. Detect and handle both.
    $pnpmCmd = Get-Command pnpm -ErrorAction Stop
    $pnpmExt = [System.IO.Path]::GetExtension($pnpmCmd.Source).ToLower()

    if ($pnpmExt -eq ".ps1") {
        # pnpm is a PowerShell script — launch via powershell.exe
        $proc = Start-Process -FilePath "powershell.exe" `
            -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"Set-Location '$repoRoot'; `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='$($env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS)'; & '$($pnpmCmd.Source)' tauri dev`"" `
            -PassThru -WindowStyle Normal
    } else {
        # pnpm is a .cmd — use cmd.exe as host
        $proc = Start-Process -FilePath "cmd.exe" `
            -ArgumentList "/c `"cd /d $repoRoot && set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=$($env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS) && `"$($pnpmCmd.Source)`" tauri dev`"" `
            -PassThru -WindowStyle Normal
    }
}

# --- Record PID and port ---
$proc.Id | Set-Content $pidFile
$Port | Set-Content $portFile

Write-Host "[launch] TracePilot PID: $($proc.Id)" -ForegroundColor Green
Write-Host "[launch] PID file: $pidFile" -ForegroundColor DarkGray
Write-Host "[launch] Port file: $portFile" -ForegroundColor DarkGray

# --- Wait for CDP to become available ---
# Incremental builds: ~4s. With code changes: 30-90s. From scratch: up to 5 min.
# The 120s timeout covers incremental + moderate rebuild. First-ever build may need
# a manual `cargo build -p tracepilot-desktop` beforehand.
Write-Host "[launch] Waiting for CDP endpoint..." -ForegroundColor Yellow
$maxWait = 120
$waited = 0
$cdpReady = $false

while ($waited -lt $maxWait) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $cdpReady = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 2
    $waited += 2
    if ($waited % 10 -eq 0) {
        Write-Host "[launch] Still waiting... ($waited/$maxWait seconds)" -ForegroundColor DarkGray
    }
}

if (-not $cdpReady) {
    Write-Error "[launch] CDP endpoint did not become available within ${maxWait}s. Check if the app started correctly."
    exit 1
}

$versionInfo = (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 5).Content | ConvertFrom-Json
Write-Host ""
Write-Host "===== TracePilot CDP Ready =====" -ForegroundColor Green
Write-Host "  CDP endpoint:  http://127.0.0.1:$Port" -ForegroundColor White
Write-Host "  Browser:       $($versionInfo.Browser)" -ForegroundColor White
Write-Host "  WebSocket:     $($versionInfo.webSocketDebuggerUrl)" -ForegroundColor White
Write-Host "  PID:           $($proc.Id)" -ForegroundColor White
Write-Host "================================" -ForegroundColor Green
Write-Host ""
Write-Host "Connect with Playwright:" -ForegroundColor Cyan
Write-Host "  const browser = await chromium.connectOverCDP('http://127.0.0.1:$Port');" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "To stop:  .\scripts\e2e\stop.ps1 -Port $Port" -ForegroundColor DarkGray
