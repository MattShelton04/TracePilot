<# Starts/stops only this checkout's development processes. Browser interaction is
   handled by the upstream Playwright CLI, not by this lifecycle helper. #>
param(
    [ValidateSet('start', 'stop', 'status')][string]$Action = 'start',
    [ValidateSet('desktop', 'ui')][string]$Mode = 'desktop',
    [ValidateRange(0, 65535)][int]$Port = 0,
    [ValidateRange(1, 3600)][int]$TimeoutSeconds = 600
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtimeDir = Join-Path $repoRoot '.tracepilot/automation'
$statePath = Join-Path $runtimeDir "$Mode.json"
$session = "tracepilot-$Mode"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

function Write-Json($Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
}

function Get-OwnedProcess($Record) {
    $process = Get-Process -Id $Record.pid -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime.ToUniversalTime().Ticks.ToString() -eq $Record.started -and
        $process.Path -eq $Record.executable) { return $process }
    return $null
}

function Stop-OwnedProcesses($State) {
    $records = @($State.processes)
    [array]::Reverse($records)
    foreach ($record in $records) {
        $owned = Get-OwnedProcess $record
        if ($owned) {
            # PID + creation time + executable must match before stopping its tree.
            & taskkill.exe /PID $owned.Id /T /F 2>&1 | Out-Null
        }
    }
}

function Get-FreePort([int]$First, [int]$Last) {
    for ($candidate = $First; $candidate -le $Last; $candidate++) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
        try { $listener.Start(); return $candidate } catch { } finally { $listener.Stop() }
    }
    throw "No free loopback port in $First-$Last. No existing process was stopped."
}

function Start-Node($Entry, $Arguments, $Name) {
    if (-not (Test-Path -LiteralPath $Entry)) { throw "Missing $Entry. Run pnpm install first." }
    $process = Start-Process -FilePath (Get-Command node -ErrorAction Stop).Source `
        -ArgumentList (@('"' + $Entry + '"') + $Arguments) `
        -WorkingDirectory (Join-Path $repoRoot 'apps/desktop') -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDir "$Mode-$Name.log") `
        -RedirectStandardError (Join-Path $runtimeDir "$Mode-$Name.err.log")
    $process = Get-Process -Id $process.Id
    $record = @{ pid = $process.Id; started = $process.StartTime.ToUniversalTime().Ticks.ToString(); executable = $process.Path }
    $script:state.processes += $record
    Write-Json $statePath $script:state
}

function Show-Connection($State) {
    Write-Host "Mode: $Mode | UI: $($State.url) | Logs: $runtimeDir"
    if ($Mode -eq 'desktop') {
        Write-Host "Real Tauri backend; uses your configured sessions and database."
        Write-Host "pnpm exec playwright-cli -s=$session attach --cdp=$($State.endpoint)"
    } else {
        Write-Host "Frontend only; client mock data, no Rust IPC."
        Write-Host "pnpm exec playwright-cli -s=$session open $($State.url) --browser=msedge"
    }
    Write-Host "pnpm exec playwright-cli -s=$session snapshot"
}

# Serialize start/stop/status for this mode, including slow first builds.
try { $lock = [IO.File]::Open((Join-Path $runtimeDir "$Mode.lock"), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { throw "Another $Mode lifecycle command is running. Logs: $runtimeDir" }
try {
    $state = if (Test-Path -LiteralPath $statePath) { Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json } else { $null }
    if ($Action -eq 'stop') {
        if ($state) {
            Stop-OwnedProcesses $state
            Remove-Item -LiteralPath $statePath -Force
        }
        Write-Host "Stopped tracked $Mode processes. Browser sessions can be detached/closed separately."
        exit 0
    }
    if ($state) {
        $alive = @($state.processes | Where-Object { Get-OwnedProcess $_ })
        if ($alive.Count -eq @($state.processes).Count -and $alive.Count -gt 0) {
            if ($Mode -eq 'desktop') {
                & node (Join-Path $PSScriptRoot 'ready.mjs') $state.endpoint
                if ($LASTEXITCODE -ne 0) { throw "Tracked desktop is not ready. Inspect logs or run pnpm app:stop." }
            } else {
                Invoke-WebRequest -UseBasicParsing -Uri $state.url -TimeoutSec 5 | Out-Null
            }
            Show-Connection $state
            exit 0
        }
        if ($Action -eq 'status') { throw "Tracked $Mode process has exited. Run pnpm app:stop$(if ($Mode -eq 'ui') { ' -Mode ui' })." }
        Stop-OwnedProcesses $state
        Remove-Item -LiteralPath $statePath -Force
    }
    if ($Action -eq 'status') { Write-Host "No tracked $Mode instance."; exit 0 }

    $uiPort = Get-FreePort 1420 1430
    $cdpPort = if ($Mode -eq 'desktop') {
        if ($Port) { Get-FreePort $Port $Port } else { Get-FreePort 9222 9232 }
    } else { 0 }
    $state = @{ mode = $Mode; url = "http://127.0.0.1:$uiPort"; endpoint = "http://127.0.0.1:$cdpPort"; processes = @() }
    $savedArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    $savedProfile = $env:WEBVIEW2_USER_DATA_FOLDER
    try {
        Start-Node (Join-Path $repoRoot 'apps/desktop/node_modules/vite/bin/vite.js') @('--host', '127.0.0.1', '--port', $uiPort, '--strictPort') 'vite'
        if ($Mode -eq 'desktop') {
            $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$cdpPort --remote-debugging-address=127.0.0.1"
            $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $runtimeDir 'webview-profile'
            $configPath = Join-Path $runtimeDir 'tauri.dev.json'
            Write-Json $configPath @{ build = @{ beforeDevCommand = ''; devUrl = $state.url } }
            Start-Node (Join-Path $repoRoot 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js') @('dev', '--config', ('"' + $configPath + '"')) 'tauri'
        }
        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        $ready = $false
        do {
            foreach ($record in $state.processes) {
                if (-not (Get-OwnedProcess $record)) { throw "A $Mode process exited during startup. Logs: $runtimeDir" }
            }
            try {
                $probe = if ($Mode -eq 'desktop') { "$($state.endpoint)/json/list" } else { $state.url }
                $response = Invoke-WebRequest -UseBasicParsing -Uri $probe -TimeoutSec 2
                $ready = $response.StatusCode -eq 200
            } catch { }
            if (-not $ready) { Start-Sleep -Seconds 2 }
        } until ($ready -or [DateTime]::UtcNow -ge $deadline)
        if (-not $ready) { throw "Startup timed out after ${TimeoutSeconds}s. Logs: $runtimeDir" }
        if ($Mode -eq 'desktop') {
            & node (Join-Path $PSScriptRoot 'ready.mjs') $state.endpoint
            if ($LASTEXITCODE -ne 0) { throw "Desktop readiness failed. Logs: $runtimeDir" }
        }
        Show-Connection $state
    } catch {
        Stop-OwnedProcesses $state
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
        throw
    } finally {
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $savedArgs
        $env:WEBVIEW2_USER_DATA_FOLDER = $savedProfile
    }
} finally { $lock.Dispose() }
