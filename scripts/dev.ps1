# TracePilot development scripts

Write-Host "TracePilot dev scripts - use from repo root" -ForegroundColor Cyan
Write-Host ""
Write-Host "  .\scripts\dev.ps1            - Show this help"
Write-Host "  .\scripts\build.ps1          - Build all targets"
Write-Host "  .\scripts\clean.ps1          - Clean build artifacts (reclaim disk space)"
Write-Host "  .\scripts\clean.ps1 -Deep    - Clean everything including node_modules"
Write-Host "  .\scripts\bump-version.ps1   - Bump project version"
Write-Host "  .\scripts\bench.ps1          - Run benchmarks"
Write-Host ""
Write-Host "  pnpm tauri build             - Build release installer"
