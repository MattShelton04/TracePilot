# Profile-Guided Optimization (PGO) build for TracePilot.
#
# PGO uses runtime profiling data from benchmarks to guide compiler optimizations,
# typically yielding 5-15% additional runtime speedup on hot paths.
#
# Prerequisites:
#   - Rust nightly or stable 1.83+ (PGO is stable since 1.83)
#   - llvm-profdata (comes with rustup component llvm-tools)
#
# Usage:
#   .\scripts\pgo-build.ps1              # Full PGO release build
#   .\scripts\pgo-build.ps1 -SkipBench   # Reuse existing profiles

param([switch]$SkipBench)

$ErrorActionPreference = 'Stop'

$ProfileDir = "target\pgo-profiles"
$MergedProfile = "$ProfileDir\merged.profdata"

# Ensure llvm-tools is installed
$installed = rustup component list --installed 2>$null | Select-String "llvm-tools"
if (-not $installed) {
    Write-Host "Installing llvm-tools component..."
    rustup component add llvm-tools
}

# Find llvm-profdata from active toolchain
$sysroot = rustc --print sysroot
$LlvmProfdata = Get-ChildItem "$sysroot\lib\rustlib\*\bin\llvm-profdata.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $LlvmProfdata) {
    Write-Error "llvm-profdata not found. Install with: rustup component add llvm-tools"
    exit 1
}

Write-Host "=== PGO Step 1: Instrumented build ===" -ForegroundColor Cyan
if (-not $SkipBench) {
    if (Test-Path $ProfileDir) { Remove-Item $ProfileDir -Recurse -Force }
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
} else {
    $existingProfiles = Get-ChildItem "$ProfileDir\*.profraw" -ErrorAction SilentlyContinue
    if (-not $existingProfiles) {
        Write-Error "-SkipBench requires existing profiles in $ProfileDir"
        exit 1
    }
    Write-Host "Reusing existing profiles in $ProfileDir"
}

$env:RUSTFLAGS = "-Cprofile-generate=$ProfileDir"
cargo build --release -p tracepilot-desktop

if (-not $SkipBench) {
    Write-Host "=== PGO Step 2: Collecting profiles via benchmarks ===" -ForegroundColor Cyan
    $env:RUSTFLAGS = "-Cprofile-generate=$ProfileDir"
    cargo bench -p tracepilot-bench -- --quick

    $profCount = (Get-ChildItem "$ProfileDir\*.profraw" -ErrorAction SilentlyContinue).Count
    Write-Host "Profiles collected: $profCount files"
}

Write-Host "=== PGO Step 3: Merging profiles ===" -ForegroundColor Cyan
$profrawFiles = Get-ChildItem "$ProfileDir\*.profraw"
& $LlvmProfdata.FullName merge -o $MergedProfile $profrawFiles.FullName
Write-Host "Merged profile: $((Get-Item $MergedProfile).Length / 1KB) KB"

Write-Host "=== PGO Step 4: Optimized build ===" -ForegroundColor Cyan
$env:RUSTFLAGS = "-Cprofile-use=$MergedProfile"
cargo build --release -p tracepilot-desktop

# Clean up RUSTFLAGS
Remove-Item Env:\RUSTFLAGS

Write-Host ""
Write-Host "=== PGO build complete ===" -ForegroundColor Green
$binary = Get-Item "target\release\tracepilot-desktop.exe" -ErrorAction SilentlyContinue
if ($binary) {
    Write-Host "Binary: $($binary.FullName) ($([math]::Round($binary.Length / 1MB, 1)) MB)"
}
