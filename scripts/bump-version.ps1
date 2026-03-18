# scripts/bump-version.ps1
# Usage: .\scripts\bump-version.ps1 -Version 0.2.0
# Prerequisite: cargo install cargo-edit

param(
    [Parameter(Mandatory)]
    [string]$Version
)

$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Error "Version must be X.Y.Z semver (e.g. 0.2.0)"
    exit 1
}

# Verify clean git working tree
$status = git status --porcelain
if ($status) {
    Write-Error "Working tree is dirty. Commit or stash changes first."
    exit 1
}

Write-Host "Bumping TracePilot to v$Version..." -ForegroundColor Cyan

# 1. Update Cargo workspace version (uses cargo-edit, understands TOML properly)
cargo set-version --workspace $Version
if ($LASTEXITCODE -ne 0) { Write-Error "cargo set-version failed. Install with: cargo install cargo-edit"; exit 1 }
Write-Host "  ✓ Cargo workspace version updated" -ForegroundColor Green

# 2. Update all package.json files (encode output as UTF-8 explicitly)
Get-ChildItem -Recurse -Filter package.json |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\target\\' } |
    ForEach-Object {
        $content = Get-Content $_.FullName -Raw -Encoding UTF8
        $json = $content | ConvertFrom-Json
        if ($null -ne $json.version) {
            $json.version = $Version
            $json | ConvertTo-Json -Depth 20 |
                Set-Content -Path $_.FullName -Encoding UTF8
            Write-Host "  ✓ $($_.FullName)" -ForegroundColor Green
        }
    }

# 3. Update Cargo.lock after version change
cargo check --workspace --quiet 2>$null
Write-Host "  ✓ Cargo.lock updated" -ForegroundColor Green

# 4. Show next steps (do NOT auto-commit — let developer review CHANGELOG first)
Write-Host ""
Write-Host "Version bumped to $Version. Next steps:" -ForegroundColor Yellow
Write-Host "  1. Update CHANGELOG.md: rename [Unreleased] -> [$Version] - $(Get-Date -Format 'yyyy-MM-dd')"
Write-Host "  2. Add a new empty [Unreleased] section at the top"
Write-Host "  3. Update apps/desktop/public/release-manifest.json with release notes"
Write-Host "  4. Run: git add -A && git commit -m 'chore: release v$Version'"
Write-Host "  5. Run: git tag -s v$Version -m 'Release v$Version'  (GPG signed)"
Write-Host "  6. Run: git push origin main --tags"
