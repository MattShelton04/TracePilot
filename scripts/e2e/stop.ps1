# Compatibility entrypoint. Never discover/kill apps by process name or CDP port.
param([int]$Port = 0)
$statePath = Join-Path $PSScriptRoot '../../.tracepilot/automation/desktop.json'
if ($Port -and (Test-Path -LiteralPath $statePath)) {
    $state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    if (([Uri]$state.endpoint).Port -ne $Port) { throw "Port $Port is not owned by this checkout." }
}
& "$PSScriptRoot/../automation/app.ps1" stop
exit $LASTEXITCODE
