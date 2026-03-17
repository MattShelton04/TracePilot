#!/usr/bin/env pwsh
param(
    [string]$Baseline,
    [switch]$Save,
    [switch]$Compare
)

$benchCmd = "cargo bench -p tracepilot-bench"

if ($Save -and $Baseline) {
    Write-Host "Saving benchmark baseline: $Baseline" -ForegroundColor Cyan
    Invoke-Expression "$benchCmd -- --save-baseline $Baseline"
} elseif ($Compare -and $Baseline) {
    Write-Host "Comparing against baseline: $Baseline" -ForegroundColor Cyan
    Invoke-Expression "$benchCmd -- --baseline $Baseline"
} else {
    Write-Host "Running benchmarks..." -ForegroundColor Cyan
    Invoke-Expression $benchCmd
}

Write-Host "`nResults saved to target/criterion/" -ForegroundColor Green
Write-Host "Open target/criterion/report/index.html for HTML report" -ForegroundColor Green
