# Bench flamegraph runner for Windows (FU-07).
#
# Usage: .\scripts\bench-flamegraph.ps1 <bench_name>
#
# Wraps `cargo flamegraph` if installed, otherwise prints a helpful message.
# `cargo flamegraph` on Windows requires a perf-equivalent profiler; native
# Windows support is experimental upstream. If you hit issues, consider
# `cargo install cargo-instruments` (macOS) or `samply`
# (https://github.com/mstange/samply) as cross-platform alternatives.

param(
    [Parameter(Position = 0, Mandatory = $false)]
    [string]$BenchName
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrEmpty($BenchName)) {
    Write-Host "usage: bench-flamegraph <bench_name>"
    Write-Host "  e.g. bench-flamegraph ipc_hot_path"
    exit 2
}

$tool = Get-Command cargo-flamegraph -ErrorAction SilentlyContinue
if ($null -eq $tool) {
    Write-Host "cargo-flamegraph is not installed."
    Write-Host "  install with: cargo install flamegraph"
    Write-Host "  note: Linux needs 'perf', macOS needs 'dtrace'."
    Write-Host "  on Windows, 'samply' (https://github.com/mstange/samply) is a"
    Write-Host "  cross-platform alternative: cargo install samply"
    exit 0
}

$outDir = Join-Path (Get-Location) "target\flamegraphs"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir "$BenchName.svg"

Write-Host "running flamegraph for bench '$BenchName' → $outFile"
cargo flamegraph --bench $BenchName -p tracepilot-bench -o $outFile -- --bench
