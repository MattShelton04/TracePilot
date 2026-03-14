# Build all TracePilot targets

Write-Host "Building Rust crates..." -ForegroundColor Cyan
cargo build --workspace
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Building TypeScript packages..." -ForegroundColor Cyan
pnpm -r build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Build complete!" -ForegroundColor Green
