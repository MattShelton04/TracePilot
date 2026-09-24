<# Repeatable native integration suite. The installer has its own app identity. #>
param([switch]$Install, [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $repo
$results = Join-Path $repo '.tracepilot/e2e-results'
New-Item -ItemType Directory -Path $results -Force | Out-Null
$executable = Join-Path $repo 'target/release/tracepilot-desktop.exe'
$installDir = Join-Path $repo ('.tracepilot/e2e-install/' + [Guid]::NewGuid().ToString('N'))
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\TracePilot E2E'
$report = @{ status = 'building'; sourceRevision = (& git rev-parse HEAD); skippedBuild = [bool]$SkipBuild; installDirectory = $installDir }
$reportPath = Join-Path $results 'installation.json'
$oldExecutable = $env:TRACEPILOT_E2E_EXECUTABLE
$oldGenerator = $env:TRACEPILOT_E2E_GENERATOR
$exitCode = 1
$installed = $false
$frontendBuild = $null

function Write-Report {
    [IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
}

function Get-Sha256([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

function Run-Installer([string]$Path, [string]$Arguments) {
    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    $null = $process.Handle # Retain the handle so Windows PowerShell can read ExitCode after exit.
    if (-not $process.WaitForExit(120000)) {
        # This exact Process object was created above, not selected by name.
        $process.Kill()
        throw "Installer timed out: $Path"
    }
    if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode): $Path" }
    return $process.ExitCode
}

try {
    Write-Report
    if ($Install -and (Test-Path -LiteralPath $registry)) {
        throw 'An existing TracePilot E2E installation is registered. Uninstall it before running this suite.'
    }
    if (-not $SkipBuild) {
        # The frontend bundle and the fixture generator are independent, so the
        # bundle builds while Cargo compiles the generator. Tauri's
        # beforeBuildCommand is disabled below because dist/ is already built.
        # Type checking is `pnpm typecheck`'s job (CI runs it separately).
        $frontendLog = Join-Path $results 'frontend-build.log'
        $frontendErrorLog = Join-Path $results 'frontend-build.err.log'
        $frontendBuild = Start-Process -FilePath 'node' -ArgumentList @('node_modules/vite/bin/vite.js', 'build') `
            -WorkingDirectory (Join-Path $repo 'apps/desktop') -NoNewWindow -PassThru `
            -RedirectStandardOutput $frontendLog -RedirectStandardError $frontendErrorLog
        $null = $frontendBuild.Handle # Retain the handle so Windows PowerShell can read ExitCode after exit.
        & cargo build --locked --release -p tracepilot-bench --example e2e_fixture
        if ($LASTEXITCODE -ne 0) { throw 'Fixture generator build failed.' }
        $frontendBuild.WaitForExit()
        Get-Content -LiteralPath $frontendLog, $frontendErrorLog | Write-Host
        if ($frontendBuild.ExitCode -ne 0) { throw "Frontend build exited with $($frontendBuild.ExitCode)." }
        $tauriArgs = @('tauri', 'build', '--features', 'automation-devtools',
            '--config', (Join-Path $repo 'tests/e2e/tauri.prebuilt-frontend.conf.json'))
        if ($Install) { $tauriArgs += @('--bundles', 'nsis', '--config', (Join-Path $repo 'tests/e2e/tauri.e2e.conf.json')) }
        else { $tauriArgs += '--no-bundle' }
        & pnpm @tauriArgs
        if ($LASTEXITCODE -ne 0) { throw 'Native app build failed.' }
    }
    # Tauri renames its output when building the separate installer identity.
    if ($SkipBuild -and -not (Test-Path -LiteralPath $executable)) {
        $executable = Join-Path $repo 'target/release/tracepilot-e2e.exe'
    }
    $env:TRACEPILOT_E2E_GENERATOR = Join-Path $repo 'target/release/examples/e2e_fixture.exe'
    if (-not (Test-Path -LiteralPath $env:TRACEPILOT_E2E_GENERATOR)) { throw 'Missing release fixture generator. Run without -SkipBuild first.' }
    if ($Install) {
        $version = (Get-Content -Raw package.json | ConvertFrom-Json).version
        $installer = Join-Path $repo "target/release/bundle/nsis/TracePilot E2E_${version}_x64-setup.exe"
        $report.installerSha256 = Get-Sha256 $installer
        $report.status = 'installing'
        Write-Report
        # /D must be the final argument and is not quoted, including paths with spaces.
        $report.installExitCode = Run-Installer $installer "/S /D=$installDir"
        $installed = $true
        $executable = Join-Path $installDir 'tracepilot-e2e.exe'
        if (-not (Test-Path -LiteralPath $executable)) { throw 'Installer did not install the desktop executable.' }
        # Tauri patches bundle-type metadata in the packaged binary, then restores
        # the unbundled output. Their hashes intentionally differ.
        $metadata = [Diagnostics.FileVersionInfo]::GetVersionInfo($executable)
        if ($metadata.ProductVersion -ne $version -or $metadata.ProductName -ne 'TracePilot E2E') {
            throw 'Installed executable has the wrong product identity or version.'
        }
        $report.installedVersion = $metadata.ProductVersion
        if (-not (Test-Path -LiteralPath $registry)) { throw 'Installer did not register an uninstall entry.' }
    }
    $report.executable = $executable
    $report.executableSha256 = Get-Sha256 $executable
    $report.status = 'testing'
    Write-Report
    $env:TRACEPILOT_E2E_EXECUTABLE = $executable
    & node (Join-Path $repo 'node_modules/@playwright/test/cli.js') test --config tests/e2e/playwright.config.mjs
    $exitCode = $LASTEXITCODE
    $report.testExitCode = $exitCode
    $report.status = if ($exitCode -eq 0) { 'passed' } else { 'failed' }
} catch {
    $report.status = 'failed'
    $report.error = $_.ToString()
    Write-Error $_ -ErrorAction Continue
} finally {
    # Only reached early when the fixture build fails; this exact process was started above.
    if ($frontendBuild -and -not $frontendBuild.HasExited) { $frontendBuild.Kill() }
    try {
        $uninstaller = Join-Path $installDir 'uninstall.exe'
        if ($Install -and (Test-Path -LiteralPath $uninstaller)) {
            # Unique, harness-created path; never run an uninstaller from registry lookup.
            $report.uninstallExitCode = Run-Installer $uninstaller "/S _?=$installDir"
            if ((Test-Path -LiteralPath (Join-Path $installDir 'tracepilot-e2e.exe')) -or
                (Test-Path -LiteralPath $registry)) { throw 'Uninstall left the executable or registry entry behind.' }
        } elseif ($installed) { throw 'Installed app is missing its uninstaller.' }
    } catch {
        $exitCode = 1
        $report.status = 'failed'
        $report.cleanupError = $_.ToString()
        Write-Error $_ -ErrorAction Continue
    }
    Write-Report
    $env:TRACEPILOT_E2E_EXECUTABLE = $oldExecutable
    $env:TRACEPILOT_E2E_GENERATOR = $oldGenerator
}
exit $exitCode
