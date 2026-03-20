# TracePilot cleanup script
# Removes build artifacts to reclaim disk space
#
# Usage:
#   .\scripts\clean.ps1             - Smart clean: remove stale caches, keep compiled deps
#   .\scripts\clean.ps1 -Full       - Remove entire target/ folder (full rebuild next time)
#   .\scripts\clean.ps1 -Frontend   - Clean only frontend dist/ folders
#   .\scripts\clean.ps1 -Deep       - Clean everything including node_modules

param(
    [switch]$Full,
    [switch]$Frontend,
    [switch]$Deep
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Get-FolderSizeMB($path) {
    if (Test-Path $path) {
        $size = (Get-ChildItem $path -Recurse -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum).Sum
        return [math]::Round($size / 1MB, 1)
    }
    return 0
}

$totalReclaimed = 0

# Default (no flags) = smart clean
$smartClean = -not ($Full -or $Frontend -or $Deep)
if ($Deep) { $Full = $true; $Frontend = $true }

# --- Smart clean: remove space hogs but preserve compiled deps ---
if ($smartClean) {
    Write-Host "Smart clean: removing caches while preserving compiled dependencies..." -ForegroundColor Cyan
    $targetPath = Join-Path $repoRoot "target"

    # Remove incremental compilation caches (biggest space hog, rebuilds quickly)
    foreach ($profile in @("debug", "release")) {
        $incPath = Join-Path $targetPath "$profile\incremental"
        if (Test-Path $incPath) {
            $sizeMB = Get-FolderSizeMB $incPath
            Remove-Item $incPath -Recurse -Force -ErrorAction SilentlyContinue
            $totalReclaimed += $sizeMB
            Write-Host "  Removed $profile\incremental ($sizeMB MB)" -ForegroundColor Green
        }
    }

    # Remove debug symbols (.pdb files) — large, only needed for debugging
    $pdbFiles = Get-ChildItem $targetPath -Filter "*.pdb" -Recurse -ErrorAction SilentlyContinue
    if ($pdbFiles) {
        $pdbSize = [math]::Round(($pdbFiles | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
        $pdbFiles | Remove-Item -Force -ErrorAction SilentlyContinue
        $totalReclaimed += $pdbSize
        Write-Host "  Removed .pdb debug symbols ($pdbSize MB)" -ForegroundColor Green
    }

    # Remove build script output caches
    foreach ($profile in @("debug", "release")) {
        $buildPath = Join-Path $targetPath "$profile\build"
        if (Test-Path $buildPath) {
            $sizeMB = Get-FolderSizeMB $buildPath
            Remove-Item $buildPath -Recurse -Force -ErrorAction SilentlyContinue
            $totalReclaimed += $sizeMB
            Write-Host "  Removed $profile\build ($sizeMB MB)" -ForegroundColor Green
        }
    }

    # Clean frontend dist too
    Write-Host "Cleaning frontend dist/ folders..." -ForegroundColor Cyan
    Push-Location $repoRoot
    pnpm -r clean 2>$null
    Pop-Location
    Write-Host "  Frontend dist folders cleaned" -ForegroundColor Green

    Write-Host ""
    Write-Host "Smart clean complete! ~$totalReclaimed MB reclaimed." -ForegroundColor Green
    Write-Host "Compiled dependencies preserved — next build will be fast." -ForegroundColor DarkGray
    Write-Host "Tip: Use -Full to remove everything (forces full rebuild)." -ForegroundColor DarkGray
    exit 0
}

# --- Full Rust clean ---
if ($Full) {
    $targetPath = Join-Path $repoRoot "target"
    if (Test-Path $targetPath) {
        $sizeMB = Get-FolderSizeMB $targetPath
        Write-Host "Cleaning entire Rust target/ ($sizeMB MB)..." -ForegroundColor Cyan
        Push-Location $repoRoot
        cargo clean 2>$null
        Pop-Location
        if ($LASTEXITCODE -eq 0) {
            $totalReclaimed += $sizeMB
            Write-Host "  Removed $sizeMB MB" -ForegroundColor Green
        } else {
            Write-Host "  cargo clean failed, removing manually..." -ForegroundColor Yellow
            Remove-Item $targetPath -Recurse -Force -ErrorAction SilentlyContinue
            $totalReclaimed += $sizeMB
            Write-Host "  Removed $sizeMB MB" -ForegroundColor Green
        }
    } else {
        Write-Host "Rust target/ not found, skipping" -ForegroundColor DarkGray
    }
}

# --- Frontend dist folders ---
if ($Frontend -or $Full) {
    Write-Host "Cleaning frontend dist/ folders..." -ForegroundColor Cyan
    Push-Location $repoRoot
    pnpm -r clean 2>$null
    Pop-Location
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Frontend dist folders cleaned" -ForegroundColor Green
    } else {
        Write-Host "  pnpm clean failed" -ForegroundColor Yellow
    }
}

# --- Deep clean: node_modules ---
if ($Deep) {
    $nmPath = Join-Path $repoRoot "node_modules"
    if (Test-Path $nmPath) {
        $sizeMB = Get-FolderSizeMB $nmPath
        Write-Host "Cleaning node_modules/ ($sizeMB MB)..." -ForegroundColor Cyan
        Remove-Item $nmPath -Recurse -Force -ErrorAction SilentlyContinue
        $totalReclaimed += $sizeMB
        Write-Host "  Removed $sizeMB MB" -ForegroundColor Green
        Write-Host "  Run 'pnpm install' to restore dependencies" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Cleanup complete! ~$totalReclaimed MB reclaimed." -ForegroundColor Green
if (-not $Deep) {
    Write-Host "Tip: Run with -Deep to also remove node_modules/" -ForegroundColor DarkGray
}
