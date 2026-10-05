# Compatibility entrypoint. Never discover/kill apps by process name or CDP port.
param(
    [ValidateRange(0, 65535)][int]$Port = 0,
    [string]$Instance = '',
    [string]$InstanceId = ''
)
$ErrorActionPreference = 'Stop'
if ($Instance -and $Instance -cnotmatch '^[a-z0-9][a-z0-9-]{0,31}$') {
    throw '-Instance must be 1-32 lowercase letters, digits or hyphens, starting with a letter or digit.'
}
$statePath = if ($Instance) {
    Join-Path $PSScriptRoot "../../.tracepilot/instances/$Instance/desktop.json"
} else {
    Join-Path $PSScriptRoot '../../.tracepilot/automation/desktop.json'
}
$state = if (Test-Path -LiteralPath $statePath) { Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json } else { $null }
if (-not $state -and ($Port -or $Instance -or $InstanceId)) { throw 'No tracked desktop for the requested cleanup target.' }
if ($Port -and ([Uri]$state.endpoint).Port -ne $Port) { throw "Port $Port is not owned by the selected instance in this checkout." }
if ($InstanceId -and $state.instanceId -cne $InstanceId) { throw 'The selected desktop instance has changed since connection.' }
$arguments = @{}
if ($Instance) { $arguments.Instance = $Instance }
# The launcher checks this again while holding its lifecycle lock, closing the
# gap between this wrapper's state validation and process cleanup.
if ($state.instanceId) { $arguments.ExpectedInstanceId = $state.instanceId }
& "$PSScriptRoot/../automation/app.ps1" stop @arguments
exit $LASTEXITCODE
