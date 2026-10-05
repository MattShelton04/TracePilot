<# Machine-wide registry of automation instances, dot-sourced by app.ps1.

   Each running instance from any checkout records a claim containing its ports and
   owned process identities. Port selection holds a short exclusive lock while it reads
   live claims and writes its own, so simultaneous starts in different worktrees cannot
   pick the same port and later attach to each other's webview. Claims whose processes
   (and launching PowerShell) have exited are pruned. Set TRACEPILOT_AUTOMATION_REGISTRY
   to use another directory (tests do). #>

function Get-RegistryDirectory {
    $base = if ($env:TRACEPILOT_AUTOMATION_REGISTRY) { $env:TRACEPILOT_AUTOMATION_REGISTRY }
    elseif ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'TracePilot/automation-registry' }
    else { throw 'LOCALAPPDATA is not set; set TRACEPILOT_AUTOMATION_REGISTRY to an absolute directory.' }
    if (-not [IO.Path]::IsPathRooted($base)) { throw 'TRACEPILOT_AUTOMATION_REGISTRY must be absolute.' }
    $claims = Join-Path $base 'claims'
    New-Item -ItemType Directory -Force -Path $claims | Out-Null
    return [IO.Path]::GetFullPath($base)
}

function Enter-RegistryLock([int]$TimeoutSeconds = 60) {
    $path = Join-Path (Get-RegistryDirectory) 'allocate.lock'
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ($true) {
        try { return [IO.File]::Open($path, 'OpenOrCreate', 'ReadWrite', 'None') }
        catch {
            if ([DateTime]::UtcNow -ge $deadline) { throw "Timed out waiting for the automation port registry lock: $path" }
            Start-Sleep -Milliseconds 150
        }
    }
}

function Get-LauncherRecord {
    $self = Get-Process -Id $PID
    return @{ pid = $self.Id; started = $self.StartTime.ToUniversalTime().Ticks.ToString(); executable = $self.Path }
}

function Test-ClaimAlive($Claim) {
    foreach ($record in @($Claim.processes) + @($Claim.launcher)) {
        if ($record -and (Get-OwnedProcess $record)) { return $true }
    }
    return $false
}

# Returns live claims and deletes stale ones. Call while holding the registry lock
# when the result is used to allocate ports.
function Get-LiveClaims {
    $claims = Join-Path (Get-RegistryDirectory) 'claims'
    foreach ($file in Get-ChildItem -LiteralPath $claims -Filter '*.json' -File) {
        $claim = $null
        try { $claim = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json } catch { }
        if ($claim -and (Test-ClaimAlive $claim)) { $claim }
        else { Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue }
    }
}

function Get-ClaimPath([string]$Id) {
    if ($Id -notmatch '^[a-f0-9]{32}$') { throw "Invalid automation instance id: $Id" }
    return Join-Path (Join-Path (Get-RegistryDirectory) 'claims') "$Id.json"
}

function Save-Claim($Claim) { Write-Json (Get-ClaimPath $Claim.id) $Claim }

function Remove-Claim([string]$Id) {
    if (-not $Id) { return }
    Remove-Item -LiteralPath (Get-ClaimPath $Id) -Force -ErrorAction SilentlyContinue
}

function Test-SamePath([string]$Left, [string]$Right) {
    if (-not $Left -or -not $Right) { return $false }
    $trim = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    return [IO.Path]::GetFullPath($Left).TrimEnd($trim) -eq [IO.Path]::GetFullPath($Right).TrimEnd($trim)
}

function Show-AllInstances {
    $lock = Enter-RegistryLock
    try { $live = @(Get-LiveClaims) } finally { $lock.Dispose() }
    if ($live.Count -eq 0) { Write-Host 'No live TracePilot automation instances.'; return }
    foreach ($claim in $live) {
        $ui = if ($claim.uiPort) { $claim.uiPort } else { '-' }
        $cdp = if ($claim.cdpPort) { $claim.cdpPort } else { '-' }
        $name = if ($claim.instanceName) { $claim.instanceName } else { '(default)' }
        $data = if ($claim.dataRoot) { $claim.dataRoot } else { 'configured user data' }
        Write-Host "$name | $($claim.mode)/$($claim.runtime) | UI $ui | CDP $cdp | checkout $($claim.repoRoot) | data $data"
    }
}
