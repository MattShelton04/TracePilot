# Compatibility entrypoint. Interactive agents should use pnpm app:start.
param([int]$Port = 0, [int]$TimeoutSeconds = 600)
& "$PSScriptRoot/../automation/app.ps1" start -Port $Port -TimeoutSeconds $TimeoutSeconds
exit $LASTEXITCODE
