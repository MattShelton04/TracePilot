<# Starts/stops only this checkout's development processes. Browser interaction is
   handled by the upstream Playwright CLI, not by this lifecycle helper. #>
param(
    [ValidateSet('start', 'stop', 'status', 'wait')][string]$Action = 'start',
    [ValidateSet('desktop', 'ui')][string]$Mode = 'desktop',
    [ValidateSet('development', 'production')][string]$Runtime = 'development',
    [string]$DataRoot = '',
    [string]$Executable = '',
    [string]$StateDirectory = '',
    [switch]$SkipBuild,
    [ValidateRange(0, 65535)][int]$Port = 0,
    [ValidateRange(0, 65535)][int]$UiPort = 0,
    [ValidateRange(1, 3600)][int]$TimeoutSeconds = 600,
    [string]$Instance = '',
    [switch]$Fixtures,
    [switch]$RealData,
    [switch]$FirstRun,
    [switch]$All,
    [string]$ExpectedInstanceId = ''
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $PSScriptRoot 'registry.ps1')
$runtimeDir = Join-Path $repoRoot '.tracepilot/automation'
$explicitDataRoot = [bool]$DataRoot
if ($Action -eq 'start' -and $RealData) {
    if (-not $Instance -or $Mode -ne 'desktop') { throw '-RealData requires desktop mode and a named instance: pnpm app:start -Instance <slug> -RealData' }
    if ($Fixtures -or $explicitDataRoot -or $StateDirectory) { throw '-RealData uses the instance''s own data root; do not combine it with -Fixtures, -DataRoot or -StateDirectory.' }
}
if ($Instance) {
    # A named instance owns its lifecycle state, default data root and CLI session,
    # so several agents can run side by side without hand-picked paths.
    if ($Instance -cnotmatch '^[a-z0-9][a-z0-9-]{0,31}$') {
        throw '-Instance must be 1-32 lowercase letters, digits or hyphens, starting with a letter or digit.'
    }
    if ($StateDirectory) { throw 'Use either -Instance or -StateDirectory, not both.' }
    $runtimeDir = Join-Path $repoRoot ".tracepilot/instances/$Instance"
    if (-not $DataRoot -and $Mode -eq 'desktop') { $DataRoot = Join-Path $runtimeDir 'data' }
}
if ($StateDirectory) {
    if (-not [IO.Path]::IsPathRooted($StateDirectory)) { throw '-StateDirectory must be absolute.' }
    $runtimeDir = [IO.Path]::GetFullPath($StateDirectory)
}
$statePath = Join-Path $runtimeDir "$Mode.json"
# Agents must not run on the maintainer's real TracePilot data or take the
# human's default ports: outside a named or explicitly isolated instance, refuse.
$agentEnvironment = $env:CLAUDECODE -or $env:AI_AGENT -or @(Get-ChildItem Env: | Where-Object { $_.Name -like 'CODEX_*' }).Count -gt 0
if ($Action -eq 'start' -and $agentEnvironment -and -not $Instance -and
    (($Mode -eq 'desktop' -and -not $DataRoot) -or ($Mode -eq 'ui' -and -not $StateDirectory))) {
    $hint = if ($Mode -eq 'ui') { '  pnpm app:ui -Instance <slug>' } else { "  pnpm app:start -Instance <slug> -Fixtures   # synthetic sessions`n  pnpm app:start -Instance <slug> -RealData   # read-only snapshot of your real sessions" }
    throw "Agent environment detected (CLAUDECODE, CODEX_* or AI_AGENT): the default instance uses the real TracePilot data and ports. Start a named instance:`n$hint"
}
$session = if (-not $Instance) { "tracepilot-$Mode" } elseif ($Mode -eq 'ui') { "tracepilot-$Instance-ui" } else { "tracepilot-$Instance" }
if ($Action -eq 'start' -and $Fixtures -and ($Mode -ne 'desktop' -or -not $DataRoot)) {
    throw '-Fixtures requires desktop mode with -Instance or an isolated -DataRoot.'
}
if ($Action -eq 'start' -and $FirstRun -and -not $Fixtures) {
    throw '-FirstRun requires -Fixtures; a data root without fixtures already opens the setup wizard.'
}
# wait only reads; it must not create a directory for an instance that never started.
if ($Action -ne 'wait') { New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null }
if ($Action -eq 'start' -and $SkipBuild -and $Runtime -ne 'production') {
    throw "-SkipBuild is valid only with -Runtime production."
}
if ($Action -eq 'start' -and $Runtime -eq 'production' -and $UiPort) {
    throw '-UiPort is valid only with -Runtime development.'
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

# Marks setup complete for a fixture data root so the app opens on its sessions,
# with the Claude Code source on so its synthetic sessions are indexed too.
# An existing config is kept, so settings changed in the app survive restarts.
function Write-CompletedSetupConfig($Paths) {
    if (Test-Path -LiteralPath $Paths.config) { return }
    New-Item -ItemType Directory -Force -Path $Paths.tracepilotHome | Out-Null
    $quote = { param($Value) ConvertTo-Json ([string]$Value) }
    $toml = @(
        'version = 11'
        '[paths]'
        "copilotHome = $(& $quote $Paths.copilotHome)"
        "tracepilotHome = $(& $quote $Paths.tracepilotHome)"
        "sessionStateDir = $(& $quote $Paths.sessionState)"
        "indexDbPath = $(& $quote $Paths.index)"
        '[general]'
        'setupComplete = true'
        '[features]'
        'claudeCodeSessions = true'
        ''
    ) -join "`n"
    [IO.File]::WriteAllText($Paths.config, $toml, [Text.UTF8Encoding]::new($false))
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

# taskkill reports children that are already exiting on stderr. Under
# ErrorActionPreference=Stop, Windows PowerShell turns that into a terminating error
# that would abandon the rest of the cleanup, so callers check the result instead.
function Invoke-TaskKill([int]$Id) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & taskkill.exe /PID $Id /T /F 2>&1 | Out-Null; return $LASTEXITCODE -eq 0 }
    finally { $ErrorActionPreference = $previous }
}

function Stop-OwnedProcesses($State) {
    $records = @($State.processes)
    [array]::Reverse($records)
    foreach ($record in $records) {
        # PID + creation time + executable must match before stopping its tree.
        for ($attempt = 0; $attempt -lt 3 -and ($owned = Get-OwnedProcess $record); $attempt++) {
            if ($attempt) { Start-Sleep -Milliseconds 500 }
            [void](Invoke-TaskKill $owned.Id)
        }
        if (Get-OwnedProcess $record) {
            throw "Could not stop owned PID $($record.pid). State was retained for retry."
        }
    }
}

# Finds desktop processes this launcher no longer tracks (a broken process tree, an
# interrupted start, or a state file already removed) through their WebView2 children,
# whose --user-data-dir is this instance's own profile. Nothing else is matched.
function Stop-StrayDesktop([string]$WebviewProfile) {
    if (-not $WebviewProfile -or $Mode -ne 'desktop') { return }
    $needle = [IO.Path]::GetFullPath($WebviewProfile).TrimEnd('\', '/')
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe' OR Name='tracepilot-desktop.exe'" -ErrorAction SilentlyContinue)
    $webviews = @($processes | Where-Object {
        $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -and $_.CommandLine.Contains('--user-data-dir=') -and
        $_.CommandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    if ($webviews.Count -eq 0) { return }
    $matched = @($webviews | ForEach-Object { $_.ProcessId })
    $targets = @()
    foreach ($webview in $webviews) {
        # The parent must still be the app that started this webview, not a reused PID.
        $parent = $processes | Where-Object {
            $_.ProcessId -eq $webview.ParentProcessId -and $_.Name -eq 'tracepilot-desktop.exe' -and $_.CreationDate -le $webview.CreationDate
        } | Select-Object -First 1
        if ($parent) { $targets += $parent.ProcessId }
        elseif ($matched -notcontains $webview.ParentProcessId) { $targets += $webview.ProcessId }
    }
    $stopped = 0
    foreach ($target in @($targets | Select-Object -Unique)) {
        if ((Invoke-TaskKill $target) -or -not (Get-Process -Id $target -ErrorAction SilentlyContinue)) { $stopped++ }
    }
    if ($stopped) { Write-Host "Stopped $stopped untracked desktop process tree(s) using this instance's WebView profile." }
}

function Get-WebviewProfile($State) {
    if ($State -and $State.paths -and $State.paths.webviewProfile) { return $State.paths.webviewProfile }
    if ($DataRoot) { return Join-Path ([IO.Path]::GetFullPath($DataRoot)) 'webview-profile' }
    return Join-Path $runtimeDir 'webview-profile'
}

function Get-FreePort([int]$First, [int]$Last, [int]$Exclude = 0, [int[]]$Reserved = @()) {
    for ($candidate = $First; $candidate -le $Last; $candidate++) {
        if ($candidate -eq $Exclude -or $Reserved -contains $candidate) { continue }
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
        try { $listener.Start(); return $candidate } catch { } finally { $listener.Stop() }
    }
    throw "No free loopback port in $First-$Last. No existing process was stopped."
}

function Save-OwnedProcesses {
    Write-Json $statePath $script:state
    # The machine-wide claim stays alive through these records after this launcher exits.
    if ($script:claim) {
        $script:claim.processes = $script:state.processes
        $registryLock = Enter-RegistryLock
        try { Save-Claim $script:claim } finally { $registryLock.Dispose() }
    }
}

function Invoke-Readiness($Endpoint, $InstanceId) {
    $arguments = @((Join-Path $PSScriptRoot 'ready.mjs'), $Endpoint)
    if ($InstanceId) { $arguments += $InstanceId }
    & node @arguments | Out-Host
    return $LASTEXITCODE -eq 0
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
    Save-OwnedProcesses
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
    Save-OwnedProcesses
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
    if ($State.instanceName) { Write-Host "Instance: $($State.instanceName) | stop with: pnpm app:stop -Instance $($State.instanceName)$(if ($Mode -eq 'ui') { ' -Mode ui' })" }
    if ($Mode -eq 'desktop') {
        if ($State.dataRoot) {
            if ($State.realData) {
                Write-Host "Real Tauri backend on a read-only snapshot of your real sessions (refreshed at each start), with isolated config, index and app state. Never commit or publish what it shows."
            } else {
                Write-Host "Real Tauri backend with isolated application data."
            }
            Write-Host "Data root: $($State.dataRoot)"
            Write-Host "Config: $($State.paths.config)"
            Write-Host "Sessions: $($State.paths.sessionState)"
            Write-Host "Database/index: $($State.paths.index)"
        } else {
            Write-Host "Real Tauri backend; uses your configured sessions and database."
        }
        Write-Host "Build: frontend=$($State.build.frontend), Rust=$($State.build.rustProfile), automationDevtools=$($State.build.automationDevtools)"
        Write-Host "Raw CLI: pnpm exec playwright-cli -s=$session attach --cdp=$($State.endpoint)"
    } else {
        Write-Host "Frontend only; client mock data, no Rust IPC."
        Write-Host "Raw CLI: pnpm exec playwright-cli -s=$session open $($State.url) --browser=msedge"
    }
    $target = "$(if ($Instance) { $Instance } else { 'default' })$(if ($Mode -eq 'ui') { ':ui' })"
    Write-Host "Drive it (attaches on first use): pnpm pw $target snapshot --filename=.playwright-cli/current.yml"
}

function Show-StartLogs {
    $logs = @(Get-ChildItem -LiteralPath $runtimeDir -Filter "$Mode-*.log" -File -ErrorAction SilentlyContinue | Sort-Object Name)
    if ($logs.Count -eq 0) { Write-Host "No launcher logs under $runtimeDir; the start command's own output has the error."; return }
    Write-Host 'Logs (compiler and app errors are in the .err.log files):'
    foreach ($log in $logs) { Write-Host "  $($log.FullName)" }
}

# The registry claims for this state file. A claim exists from port allocation until
# the start fails or the instance is stopped, and its launcher record is the start's
# own PowerShell process, so a live launcher means that start is still running. The
# registry lock is held only for this read; starts retry it rather than failing.
function Get-StartClaims {
    $claimsDir = Join-Path (Get-RegistryDirectory) 'claims'
    $registryLock = Enter-RegistryLock
    try {
        foreach ($file in Get-ChildItem -LiteralPath $claimsDir -Filter '*.json' -File) {
            $claim = $null
            try { $claim = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json } catch { }
            if ($claim -and (Test-SamePath $claim.statePath $statePath)) { $claim }
        }
    } finally { $registryLock.Dispose() }
}

# Shares write and delete so a start rewriting or removing the state is never blocked.
function Read-StateFile {
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    try {
        $stream = [IO.File]::Open($statePath, 'Open', 'Read', 'ReadWrite, Delete')
        try { $text = [IO.StreamReader]::new($stream).ReadToEnd() } finally { $stream.Dispose() }
        return $text | ConvertFrom-Json
    } catch { return $null }
}

# Blocks until a start running elsewhere (an agent's background `pnpm app:start`)
# finishes. Read-only: it never opens the per-mode lifecycle lock, which a start holds
# for its whole run and which fails fast for any other opener. Exit 0 ready, 1 failed
# or not started, 2 still starting at the timeout.
function Wait-ForStart([int]$Seconds) {
    $name = if ($Instance) { $Instance } else { 'default' }
    $target = "$name$(if ($Mode -eq 'ui') { ':ui' })"
    $label = "$name ($Mode)"
    $instanceArgs = "$(if ($Instance) { " -Instance $Instance" })$(if ($Mode -eq 'ui') { ' -Mode ui' })"
    $begin = [DateTime]::UtcNow
    $deadline = $begin.AddSeconds($Seconds)
    # pnpm and PowerShell take a few seconds before a just-launched start registers.
    $graceEnd = $begin.AddSeconds([Math]::Min(10, $Seconds))
    $nextProgress = $begin.AddSeconds(60)
    $sawStart = $false
    while ($true) {
        $claims = @(Get-StartClaims)
        $starting = @($claims | Where-Object { $_.launcher -and (Get-OwnedProcess $_.launcher) }).Count -gt 0
        if ($starting) {
            if (-not $sawStart) { Write-Host "Waiting for the start of $label to finish. Logs: $runtimeDir" }
            $sawStart = $true
        } else {
            $state = Read-StateFile
            if ($state) {
                $records = @($state.processes)
                $alive = @($records | Where-Object { Get-OwnedProcess $_ })
                if ($records.Count -eq 0 -or $alive.Count -ne $records.Count) {
                    Write-Host "A tracked $label process has exited. Run pnpm app:stop$instanceArgs, then start again."
                    Show-StartLogs
                    exit 1
                }
                $ready = if ($Mode -eq 'desktop') { Invoke-Readiness $state.endpoint $state.instanceId } else {
                    try { (Invoke-WebRequest -UseBasicParsing -Uri $state.url -TimeoutSec 5).StatusCode -eq 200 } catch { $false }
                }
                if (-not $ready) {
                    Write-Host "$label is running but not ready, and no start is in progress (was the start interrupted?). Run pnpm app:stop$instanceArgs, then start again."
                    Show-StartLogs
                    exit 1
                }
                Show-Connection $state
                Write-Host "Ready: $label - attach with pnpm pw $target <command>"
                exit 0
            }
            if ($sawStart) {
                Write-Host "The start of $label failed: it ended without a running instance. Its own output has the error."
                Show-StartLogs
                exit 1
            }
            if ([DateTime]::UtcNow -ge $graceEnd) {
                Write-Host "No start is in progress for $label and it is not running. Start it with $(if ($Mode -eq 'ui') { "pnpm app:ui -Instance $name" } else { "pnpm app:start -Instance $name -Fixtures" })."
                exit 1
            }
        }
        if ([DateTime]::UtcNow -ge $deadline) {
            Write-Host "Still starting: $label after ${Seconds}s; run pnpm app:wait$instanceArgs again. Logs: $runtimeDir"
            exit 2
        }
        if ($sawStart -and [DateTime]::UtcNow -ge $nextProgress) {
            Write-Host "Still starting ($([int]([DateTime]::UtcNow - $begin).TotalSeconds)s). Logs: $runtimeDir"
            $nextProgress = [DateTime]::UtcNow.AddSeconds(60)
        }
        Start-Sleep -Seconds 2
    }
}

if ($Action -eq 'wait') {
    # 540s fits one 10-minute agent tool call; -TimeoutSeconds still applies when given.
    Wait-ForStart $(if ($PSBoundParameters.ContainsKey('TimeoutSeconds')) { $TimeoutSeconds } else { 540 })
}
if ($Action -eq 'status' -and $All) { Show-AllInstances; exit 0 }

# Serialize start/stop/status for this mode, including slow first builds.
try { $lock = [IO.File]::Open((Join-Path $runtimeDir "$Mode.lock"), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { throw "Another $Mode lifecycle command is running. Logs: $runtimeDir" }
try {
    $state = if (Test-Path -LiteralPath $statePath) { Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json } else { $null }
    if ($Action -eq 'stop') {
        if ($ExpectedInstanceId -and (-not $state -or $state.instanceId -cne $ExpectedInstanceId)) {
            throw 'The selected desktop instance has changed since connection. No processes were stopped.'
        }
        if ($state) {
            Stop-OwnedProcesses $state
            Remove-Claim $state.instanceId
            Remove-Item -LiteralPath $statePath -Force
        }
        Stop-StrayDesktop (Get-WebviewProfile $state)
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
                if ($UiPort -and ([Uri]$state.url).Port -ne $UiPort) {
                    throw "A healthy $Mode instance is tracked with different launch options (UI port=$(([Uri]$state.url).Port)). Stop it before changing UI port."
                }
                if ($Mode -eq 'desktop') {
                    $requestedDataRoot = Resolve-DataRoot $DataRoot
                    $endpointPort = ([Uri]$state.endpoint).Port
                    if ($state.dataRoot -ne $requestedDataRoot -or ($Port -and $endpointPort -ne $Port)) {
                        throw "A healthy desktop instance is tracked with different launch options (runtime=$($state.runtime), dataRoot=$($state.dataRoot), port=$endpointPort). Stop it before changing runtime, data root, or port."
                    }
                    if ([bool]$state.realData -ne [bool]$RealData) {
                        throw "A healthy desktop instance is tracked with different launch options (realData=$([bool]$state.realData)). Stop it before changing -RealData."
                    }
                    if ($Executable -and $state.build.executable -ne $Executable) {
                        throw 'A healthy desktop instance uses a different executable. Stop it before changing executable.'
                    }
                }
            }
            if ($Mode -eq 'desktop') {
                if (-not (Invoke-Readiness $state.endpoint $state.instanceId)) { throw "Tracked desktop is not ready. Inspect logs or run pnpm app:stop." }
            } else {
                Invoke-WebRequest -UseBasicParsing -Uri $state.url -TimeoutSec 5 | Out-Null
            }
            Show-Connection $state
            exit 0
        }
        if ($Action -eq 'status') { throw "Tracked $Mode process has exited. Run pnpm app:stop$(if ($Mode -eq 'ui') { ' -Mode ui' })." }
        Stop-OwnedProcesses $state
        Remove-Claim $state.instanceId
        Remove-Item -LiteralPath $statePath -Force
    }
    if ($Action -eq 'status') { Write-Host "No tracked $Mode instance."; exit 0 }
    Stop-StrayDesktop (Get-WebviewProfile $state)

    if ($Mode -eq 'ui' -and $Runtime -ne 'development') {
        throw "Frontend-only UI mode supports only -Runtime development."
    }

    $resolvedDataRoot = if ($Mode -eq 'desktop') { Resolve-DataRoot $DataRoot } else { $null }
    $resolvedPaths = if ($resolvedDataRoot) { Get-ResolvedPaths $resolvedDataRoot } else { $null }
    # Named and isolated instances use their own ranges so agents never take the
    # ports a developer's own `pnpm tauri dev` (1420) or default launcher expects.
    $isolatedRange = [bool]($Instance -or $resolvedDataRoot)
    $instanceId = [guid]::NewGuid().ToString('N')
    $registryLock = Enter-RegistryLock
    try {
        $live = @(Get-LiveClaims)
        if ($Mode -eq 'desktop' -and $Runtime -eq 'development') {
            $sibling = $live | Where-Object {
                $_.mode -eq 'desktop' -and $_.runtime -eq 'development' -and (Test-SamePath $_.repoRoot $repoRoot) -and -not (Test-SamePath $_.statePath $statePath)
            } | Select-Object -First 1
            if ($sibling) {
                throw "Another desktop development instance from this checkout is running (state: $($sibling.statePath)). Both would rebuild and run the same target/debug executable; start a parallel instance from its own worktree (git worktree add .agent/worktrees/<name> -b <branch> origin/main)."
            }
        }
        $reserved = [int[]]@($live | ForEach-Object { $_.uiPort; $_.cdpPort } | Where-Object { $_ })
        $uiPort = if ($Runtime -eq 'development' -or $Mode -eq 'ui') {
            if ($UiPort) { Get-FreePort $UiPort $UiPort 0 $reserved }
            elseif ($isolatedRange) { Get-FreePort 1440 1479 0 $reserved }
            else { Get-FreePort 1420 1430 0 $reserved }
        } else { 0 }
        $cdpPort = if ($Mode -eq 'desktop') {
            if ($Port) { Get-FreePort $Port $Port $uiPort $reserved }
            elseif ($isolatedRange) { Get-FreePort 9240 9279 $uiPort $reserved }
            else { Get-FreePort 9222 9232 $uiPort $reserved }
        } else { 0 }
        $claim = @{
            id = $instanceId
            instanceName = $Instance
            repoRoot = $repoRoot
            statePath = $statePath
            mode = $Mode
            runtime = $Runtime
            uiPort = $uiPort
            cdpPort = $cdpPort
            dataRoot = $resolvedDataRoot
            realData = [bool]$RealData
            launcher = Get-LauncherRecord
            processes = @()
        }
        Save-Claim $claim
    } finally { $registryLock.Dispose() }
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
        instanceId = $instanceId
        instanceName = $Instance
        realData = [bool]$RealData
        processes = @()
    }
    $savedArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    $savedProfile = $env:WEBVIEW2_USER_DATA_FOLDER
    $savedAutomationPort = $env:TRACEPILOT_AUTOMATION_PORT
    $savedAutomationProfile = $env:TRACEPILOT_AUTOMATION_PROFILE
    $savedDataRoot = $env:TRACEPILOT_DATA_ROOT
    $savedInstance = $env:TRACEPILOT_AUTOMATION_INSTANCE
    Write-Host "Starting $Mode. Logs: $runtimeDir"
    try {
        if ($Fixtures -and (Test-Path -LiteralPath (Join-Path $resolvedDataRoot 'real-data.json'))) {
            throw "$resolvedDataRoot holds a real-data snapshot. Use a fresh -Instance name for -Fixtures."
        }
        if ($RealData) {
            # Hard links (or copies) of the real session folders; TracePilot's own
            # config, index and app state stay in this data root.
            $snapshotOutput = & node (Join-Path $repoRoot 'scripts/automation/real-data.mjs') "--root=$resolvedDataRoot"
            if ($LASTEXITCODE -ne 0) { throw "Real-data snapshot failed for $resolvedDataRoot." }
            $snapshot = $snapshotOutput -join "`n" | ConvertFrom-Json
            Write-Host "Real sessions, read-only snapshot: $($snapshot.copilotSessions) Copilot sessions and $($snapshot.claudeProjects) Claude Code projects ($($snapshot.linked) linked, $($snapshot.copied) copied, $($snapshot.kept) unchanged, $($snapshot.removed) removed)."
            Write-CompletedSetupConfig $resolvedPaths
        }
        if ($Fixtures) {
            if ($FirstRun -and (Test-Path -LiteralPath $resolvedPaths.config)) {
                throw "-FirstRun needs a data root that has not completed setup, but $($resolvedPaths.config) exists. Use a fresh -Instance name."
            }
            # The generator owns its manifest and refuses edited or foreign roots.
            $fixtureOutput = & node (Join-Path $repoRoot 'scripts/fixtures/session-fixtures.mjs') "--root=$resolvedDataRoot"
            if ($LASTEXITCODE -ne 0) { throw "Fixture generation failed for $resolvedDataRoot. Use a fresh -Instance or -DataRoot." }
            $manifest = $fixtureOutput -join "`n" | ConvertFrom-Json
            Write-Host "Synthetic fixtures: $(@($manifest.sessions).Count) Copilot and $(@($manifest.claudeSessions).Count) Claude Code sessions ($(if ($manifest.reused) { 'reused' } else { 'generated' }))."
            if (-not $FirstRun) { Write-CompletedSetupConfig $resolvedPaths }
        }
        if ($Runtime -eq 'development' -or $Mode -eq 'ui') {
            Start-Node (Join-Path $repoRoot 'apps/desktop/node_modules/vite/bin/vite.js') @('--host', '127.0.0.1', '--port', $uiPort, '--strictPort') 'vite'
        }
        if ($Mode -eq 'desktop') {
            $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$cdpPort --remote-debugging-address=127.0.0.1"
            $env:WEBVIEW2_USER_DATA_FOLDER = if ($resolvedPaths) { $resolvedPaths.webviewProfile } else { Join-Path $runtimeDir 'webview-profile' }
            $env:TRACEPILOT_AUTOMATION_PORT = "$cdpPort"
            $env:TRACEPILOT_AUTOMATION_PROFILE = $env:WEBVIEW2_USER_DATA_FOLDER
            # The webview exposes this nonce so readiness can prove it reached this instance.
            $env:TRACEPILOT_AUTOMATION_INSTANCE = $instanceId
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
            if (-not (Invoke-Readiness $state.endpoint $instanceId)) { throw "Desktop readiness failed. Logs: $runtimeDir" }
        }
        Show-Connection $state
    } catch {
        Stop-OwnedProcesses $state
        Stop-StrayDesktop (Get-WebviewProfile $state)
        Remove-Claim $instanceId
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
        throw
    } finally {
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $savedArgs
        $env:WEBVIEW2_USER_DATA_FOLDER = $savedProfile
        $env:TRACEPILOT_AUTOMATION_PORT = $savedAutomationPort
        $env:TRACEPILOT_AUTOMATION_PROFILE = $savedAutomationProfile
        $env:TRACEPILOT_DATA_ROOT = $savedDataRoot
        $env:TRACEPILOT_AUTOMATION_INSTANCE = $savedInstance
    }
} finally { $lock.Dispose() }
