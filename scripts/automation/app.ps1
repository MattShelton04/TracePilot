<# Starts/stops only this checkout's development processes. Browser interaction is
   handled by the upstream Playwright CLI, not by this lifecycle helper. #>
param(
    [ValidateSet('start', 'stop', 'status')][string]$Action = 'start',
    [ValidateSet('desktop', 'ui')][string]$Mode = 'desktop',
    [ValidateSet('development', 'production')][string]$Runtime = 'development',
    [string]$DataRoot = '',
    [string]$Executable = '',
    [string]$StateDirectory = '',
    [switch]$SkipBuild,
    [ValidateRange(0, 65535)][int]$Port = 0,
    [ValidateRange(1, 3600)][int]$TimeoutSeconds = 600
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtimeDir = Join-Path $repoRoot '.tracepilot/automation'
if ($StateDirectory) {
    if (-not [IO.Path]::IsPathRooted($StateDirectory)) { throw '-StateDirectory must be absolute.' }
    $runtimeDir = [IO.Path]::GetFullPath($StateDirectory)
}
$statePath = Join-Path $runtimeDir "$Mode.json"
$session = "tracepilot-$Mode"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
if ($Action -eq 'start' -and $SkipBuild -and $Runtime -ne 'production') {
    throw "-SkipBuild is valid only with -Runtime production."
}
if ($Action -eq 'start' -and $Executable) {
    if ($Mode -ne 'desktop' -or $Runtime -ne 'production' -or -not $SkipBuild -or -not $DataRoot) {
        throw '-Executable requires desktop production mode, -SkipBuild, and an isolated -DataRoot.'
    }
    if (-not [IO.Path]::IsPathRooted($Executable) -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
        throw '-Executable must name an existing absolute executable path.'
    }
    $Executable = [IO.Path]::GetFullPath($Executable)
}

function Resolve-DataRoot([string]$RequestedRoot) {
    if ([string]::IsNullOrWhiteSpace($RequestedRoot)) { return $null }
    $isDriveAbsolute = $RequestedRoot -match '^[A-Za-z]:[\\/]'
    $isUncAbsolute = $RequestedRoot -match '^\\\\[^\\/]+[\\/][^\\/]+'
    if (-not ($isDriveAbsolute -or $isUncAbsolute)) {
        throw "TRACEPILOT_DATA_ROOT must be an absolute path: $RequestedRoot"
    }
    $candidate = $RequestedRoot
    $full = [IO.Path]::GetFullPath($candidate).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    if ([string]::IsNullOrWhiteSpace($full) -or $full -eq [IO.Path]::GetPathRoot($full)) {
        throw "TRACEPILOT_DATA_ROOT must not be a filesystem root: $candidate"
    }
    if ($full -eq $repoRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) -or
        ($env:USERPROFILE -and $full -eq [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd([IO.Path]::DirectorySeparatorChar))) {
        throw "TRACEPILOT_DATA_ROOT must be a dedicated directory, not the repository or user profile: $full"
    }
    New-Item -ItemType Directory -Force -Path $full | Out-Null
    $item = Get-Item -LiteralPath $full
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "TRACEPILOT_DATA_ROOT must not be a reparse point: $full"
    }
    foreach ($container in @($full, (Join-Path $full 'copilot'), (Join-Path $full 'tracepilot'))) {
        if (-not (Test-Path -LiteralPath $container -PathType Container)) { continue }
        foreach ($entry in Get-ChildItem -LiteralPath $container -Force) {
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "TRACEPILOT_DATA_ROOT must not contain redirected state paths: $($entry.FullName)"
            }
        }
    }
    return $item.FullName.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Get-ResolvedPaths([string]$Root) {
    $copilot = Join-Path $Root 'copilot'
    $tracepilot = Join-Path $Root 'tracepilot'
    return @{
        copilotHome = $copilot
        sessionState = Join-Path $copilot 'session-state'
        tracepilotHome = $tracepilot
        config = Join-Path $tracepilot 'config.toml'
        index = Join-Path $tracepilot 'index.db'
        webviewProfile = Join-Path $Root 'webview-profile'
        logs = Join-Path $Root 'logs'
    }
}

function Write-Json($Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
}

function Get-Sha256([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try {
        return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

function Get-OwnedProcess($Record) {
    $process = Get-Process -Id $Record.pid -ErrorAction SilentlyContinue
    # A reused PID can belong to a protected process whose StartTime is
    # unreadable; that process is not ours.
    if ($process -and $process.StartTime -and
        $process.StartTime.ToUniversalTime().Ticks.ToString() -eq $Record.started -and
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
            if ($LASTEXITCODE -ne 0 -and (Get-OwnedProcess $record)) {
                throw "Could not stop owned PID $($owned.Id). State was retained for retry."
            }
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
    # Start-Process -Redirect* creates the child with handle inheritance, so the
    # long-lived dev server holds this script's stdout pipe open and callers
    # (pnpm, agents) never see app:start finish. Launching without -Redirect*
    # uses ShellExecute, which inherits no handles; cmd redirects to the logs.
    $node = (Get-Command node -ErrorAction Stop).Source
    $log = Join-Path $runtimeDir "$Mode-$Name.log"
    $errLog = Join-Path $runtimeDir "$Mode-$Name.err.log"
    $command = ((@('"' + $node + '"', '"' + $Entry + '"') + $Arguments) -join ' ') + " > `"$log`" 2> `"$errLog`""
    $process = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/s', '/c', "`"$command`"") `
        -WorkingDirectory (Join-Path $repoRoot 'apps/desktop') -WindowStyle Hidden -PassThru
    $process = Get-Process -Id $process.Id
    $record = @{ pid = $process.Id; started = $process.StartTime.ToUniversalTime().Ticks.ToString(); executable = $process.Path }
    $script:state.processes += $record
    Write-Json $statePath $script:state
}

function Start-NativeApp($Executable, $Name) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
        throw "Missing production executable $Executable. The release build did not complete."
    }
    # ShellExecute without redirected handles lets app:start return while
    # retaining PID/start-time/executable ownership of the actual release app.
    $process = Start-Process -FilePath $Executable `
        -WorkingDirectory (Join-Path $repoRoot 'apps/desktop') -WindowStyle Hidden -PassThru
    $process = Get-Process -Id $process.Id
    $record = @{ pid = $process.Id; started = $process.StartTime.ToUniversalTime().Ticks.ToString(); executable = $process.Path }
    $script:state.processes += $record
    Write-Json $statePath $script:state
}

function Build-ProductionApp {
    $tauri = Join-Path $repoRoot 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js'
    if (-not (Test-Path -LiteralPath $tauri)) { throw "Missing $tauri. Run pnpm install first." }
    Write-Host "Building production frontend and release Rust executable (excluded from startup timing)."
    Push-Location (Join-Path $repoRoot 'apps/desktop')
    try {
        & node $tauri build --no-bundle --features automation-devtools
        if ($LASTEXITCODE -ne 0) { throw "Production build failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
}

function Show-Connection($State) {
    Write-Host "Mode: $Mode | Runtime: $($State.runtime) | UI: $($State.url) | Logs: $runtimeDir"
    if ($Mode -eq 'desktop') {
        if ($State.dataRoot) {
            Write-Host "Real Tauri backend with isolated application data."
            Write-Host "Data root: $($State.dataRoot)"
            Write-Host "Config: $($State.paths.config)"
            Write-Host "Sessions: $($State.paths.sessionState)"
            Write-Host "Database/index: $($State.paths.index)"
        } else {
            Write-Host "Real Tauri backend; uses your configured sessions and database."
        }
        Write-Host "Build: frontend=$($State.build.frontend), Rust=$($State.build.rustProfile), automationDevtools=$($State.build.automationDevtools)"
        Write-Host "pnpm exec playwright-cli -s=$session attach --cdp=$($State.endpoint)"
    } else {
        Write-Host "Frontend only; client mock data, no Rust IPC."
        Write-Host "pnpm exec playwright-cli -s=$session open $($State.url) --browser=msedge"
    }
    Write-Host "pnpm exec playwright-cli -s=$session snapshot --filename=.playwright-cli/current.yml"
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
            if ($Action -eq 'start') {
                if ($state.runtime -ne $Runtime) {
                    throw "A healthy $Mode instance is tracked with different launch options (runtime=$($state.runtime)). Stop it before changing runtime."
                }
                if ($Mode -eq 'desktop') {
                    $requestedDataRoot = Resolve-DataRoot $DataRoot
                    $endpointPort = ([Uri]$state.endpoint).Port
                    if ($state.dataRoot -ne $requestedDataRoot -or ($Port -and $endpointPort -ne $Port)) {
                        throw "A healthy desktop instance is tracked with different launch options (runtime=$($state.runtime), dataRoot=$($state.dataRoot), port=$endpointPort). Stop it before changing runtime, data root, or port."
                    }
                    if ($Executable -and $state.build.executable -ne $Executable) {
                        throw 'A healthy desktop instance uses a different executable. Stop it before changing executable.'
                    }
                }
            }
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

    if ($Mode -eq 'ui' -and $Runtime -ne 'development') {
        throw "Frontend-only UI mode supports only -Runtime development."
    }

    $uiPort = if ($Runtime -eq 'development' -or $Mode -eq 'ui') { Get-FreePort 1420 1430 } else { 0 }
    $cdpPort = if ($Mode -eq 'desktop') {
        if ($Port) { Get-FreePort $Port $Port } else { Get-FreePort 9222 9232 }
    } else { 0 }
    $resolvedDataRoot = if ($Mode -eq 'desktop') { Resolve-DataRoot $DataRoot } else { $null }
    $resolvedPaths = if ($resolvedDataRoot) { Get-ResolvedPaths $resolvedDataRoot } else { $null }
    $uiUrl = if ($Runtime -eq 'development' -or $Mode -eq 'ui') { "http://127.0.0.1:$uiPort" } else { 'built frontend assets' }
    $buildMetadata = if ($Runtime -eq 'production') {
        @{
            frontend = 'built'
            rustProfile = 'release'
            automationDevtools = $true
            skipped = [bool]$SkipBuild
            executable = $null
            executableSha256 = $null
            executableLastWriteUtc = $null
            executableLength = $null
            sourceRevision = $null
            sourceDirty = $null
        }
    } else {
        @{ frontend = 'vite-hmr'; rustProfile = 'debug'; automationDevtools = $true; skipped = $false; executable = $null; executableSha256 = $null; executableLastWriteUtc = $null; executableLength = $null; sourceRevision = $null; sourceDirty = $null }
    }
    $state = @{
        mode = $Mode
        runtime = $Runtime
        dataRoot = $resolvedDataRoot
        paths = $resolvedPaths
        build = $buildMetadata
        url = $uiUrl
        endpoint = "http://127.0.0.1:$cdpPort"
        processes = @()
    }
    $savedArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    $savedProfile = $env:WEBVIEW2_USER_DATA_FOLDER
    $savedAutomationPort = $env:TRACEPILOT_AUTOMATION_PORT
    $savedAutomationProfile = $env:TRACEPILOT_AUTOMATION_PROFILE
    $savedDataRoot = $env:TRACEPILOT_DATA_ROOT
    Write-Host "Starting $Mode. Logs: $runtimeDir"
    try {
        if ($Runtime -eq 'development' -or $Mode -eq 'ui') {
            Start-Node (Join-Path $repoRoot 'apps/desktop/node_modules/vite/bin/vite.js') @('--host', '127.0.0.1', '--port', $uiPort, '--strictPort') 'vite'
        }
        if ($Mode -eq 'desktop') {
            $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$cdpPort --remote-debugging-address=127.0.0.1"
            $env:WEBVIEW2_USER_DATA_FOLDER = if ($resolvedPaths) { $resolvedPaths.webviewProfile } else { Join-Path $runtimeDir 'webview-profile' }
            $env:TRACEPILOT_AUTOMATION_PORT = "$cdpPort"
            $env:TRACEPILOT_AUTOMATION_PROFILE = $env:WEBVIEW2_USER_DATA_FOLDER
            if ($resolvedDataRoot) { $env:TRACEPILOT_DATA_ROOT = $resolvedDataRoot } else { Remove-Item Env:TRACEPILOT_DATA_ROOT -ErrorAction SilentlyContinue }
            if ($Runtime -eq 'development') {
                $configPath = Join-Path $runtimeDir 'tauri.dev.json'
                Write-Json $configPath @{ build = @{ beforeDevCommand = ''; devUrl = $state.url } }
                Start-Node (Join-Path $repoRoot 'apps/desktop/node_modules/@tauri-apps/cli/tauri.js') @('dev', '--config', ('"' + $configPath + '"')) 'tauri'
            } else {
                if (-not $SkipBuild) {
                    Build-ProductionApp
                } else {
                    Write-Host "Using the existing production executable; build was explicitly skipped."
                }
                $releaseExecutable = Join-Path $repoRoot 'target/release/tracepilot-desktop.exe'
                if ($Executable) { $releaseExecutable = $Executable }
                if (-not (Test-Path -LiteralPath $releaseExecutable -PathType Leaf)) {
                    throw "-SkipBuild requires an existing production executable: $releaseExecutable"
                }
                $releaseItem = Get-Item -LiteralPath $releaseExecutable
                $state.build.executable = $releaseItem.FullName
                $state.build.executableSha256 = Get-Sha256 $releaseExecutable
                $state.build.executableLastWriteUtc = $releaseItem.LastWriteTimeUtc.ToString('o')
                $state.build.executableLength = $releaseItem.Length
                $state.build.sourceRevision = (& git -C $repoRoot rev-parse HEAD).Trim()
                if ($LASTEXITCODE -ne 0) { throw "Could not resolve the source revision for build metadata." }
                $state.build.sourceDirty = [bool](& git -C $repoRoot status --porcelain)
                if ($LASTEXITCODE -ne 0) { throw "Could not resolve source status for build metadata." }
                Start-NativeApp $releaseExecutable 'release'
            }
        }
        $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
        $nextProgress = [DateTime]::UtcNow.AddSeconds(15)
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
            if (-not $ready -and [DateTime]::UtcNow -ge $nextProgress) {
                Write-Host "Waiting for $Mode startup. Logs: $runtimeDir"
                $nextProgress = [DateTime]::UtcNow.AddSeconds(15)
            }
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
        $env:TRACEPILOT_AUTOMATION_PORT = $savedAutomationPort
        $env:TRACEPILOT_AUTOMATION_PROFILE = $savedAutomationProfile
        $env:TRACEPILOT_DATA_ROOT = $savedDataRoot
    }
} finally { $lock.Dispose() }
