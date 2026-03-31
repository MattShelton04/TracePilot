<#
.SYNOPSIS
  Stop a TracePilot instance launched with launch.ps1.

.DESCRIPTION
  Stops a specific instance by port or the most recent instance.
  Uses per-port PID tracking files and CDP port listener walk for reliable cleanup.

.PARAMETER Port
  Stop the instance on a specific CDP port. If omitted, stops the most recent
  instance (from .tracepilot-cdp.port).

.PARAMETER All
  Clean up all tracked PID files and any stale TracePilot processes.

.EXAMPLE
  .\scripts\e2e\stop.ps1
  .\scripts\e2e\stop.ps1 -Port 9222
  .\scripts\e2e\stop.ps1 -All
#>

param(
    [int]$Port = 0,
    [switch]$All
)

$ErrorActionPreference = "Stop"
$portFile = "$PSScriptRoot\.tracepilot-cdp.port"

function Get-PidFile([int]$p) { return "$PSScriptRoot\.tracepilot-cdp.$p.pid" }

function Stop-TracePilotInstance {
    param([int]$InstancePort)
    $pidFile = Get-PidFile $InstancePort
    if (-not (Test-Path $pidFile)) {
        Write-Host "[stop] No PID file for port $InstancePort." -ForegroundColor DarkGray
        return
    }
    $storedPid = [int](Get-Content $pidFile -ErrorAction SilentlyContinue)
    if ($storedPid) {
        $proc = Get-Process -Id $storedPid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "[stop] Stopping port $InstancePort launcher (PID $storedPid, $($proc.ProcessName))..." -ForegroundColor Yellow
            Stop-Process -Id $storedPid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 500
        } else {
            Write-Host "[stop] Launcher PID $storedPid already gone." -ForegroundColor DarkGray
        }
    }

    # The PID file holds the launcher (powershell/cmd), not the tracepilot binary.
    # Find and kill the actual tracepilot-desktop process by its CDP port.
    $cdpListener = Get-NetTCPConnection -LocalPort $InstancePort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cdpListener) {
        # The CDP listener is a msedgewebview2 child. Walk up to find tracepilot-desktop.
        $wv2Pid = $cdpListener.OwningProcess
        $wv2Proc = Get-CimInstance Win32_Process -Filter "ProcessId=$wv2Pid" -ErrorAction SilentlyContinue
        if ($wv2Proc) {
            $parentPid = $wv2Proc.ParentProcessId
            $parentProc = Get-Process -Id $parentPid -ErrorAction SilentlyContinue
            if ($parentProc -and $parentProc.ProcessName -eq 'tracepilot-desktop') {
                Write-Host "[stop] Killing tracepilot-desktop (PID $parentPid)..." -ForegroundColor Yellow
                Stop-Process -Id $parentPid -Force -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 500
                Write-Host "[stop] Stopped." -ForegroundColor Green
            } else {
                # Fallback: kill the CDP listener directly
                Write-Host "[stop] Killing CDP listener (PID $wv2Pid)..." -ForegroundColor Yellow
                Stop-Process -Id $wv2Pid -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if ($All) {
    # Stop all tracked instances
    $pidFiles = Get-ChildItem "$PSScriptRoot\.tracepilot-cdp.*.pid" -ErrorAction SilentlyContinue
    if ($pidFiles.Count -eq 0) {
        Write-Host "[stop] No tracked instances found." -ForegroundColor DarkGray
    } else {
        foreach ($f in $pidFiles) {
            if ($f.Name -match '\.tracepilot-cdp\.(\d+)\.pid$') {
                Stop-TracePilotInstance -InstancePort ([int]$Matches[1])
            }
        }
    }
} elseif ($Port -gt 0) {
    Stop-TracePilotInstance -InstancePort $Port
} elseif (Test-Path $portFile) {
    # Use the last-launched port
    $lastPort = [int](Get-Content $portFile -ErrorAction SilentlyContinue)
    if ($lastPort) {
        Stop-TracePilotInstance -InstancePort $lastPort
    }
} else {
    # Fallback: find any tracepilot-desktop process
    $tp = Get-Process -Name "tracepilot-desktop" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($tp) {
        Write-Host "[stop] Found tracepilot-desktop (PID $($tp.Id))" -ForegroundColor Yellow
        Stop-Process -Id $tp.Id -Force -ErrorAction SilentlyContinue
        Write-Host "[stop] Stopped." -ForegroundColor Green
    } else {
        Write-Host "[stop] No running TracePilot instance found." -ForegroundColor DarkGray
    }
}

# Clean up the last-port file if no more instances are tracked
$remaining = Get-ChildItem "$PSScriptRoot\.tracepilot-cdp.*.pid" -ErrorAction SilentlyContinue
if ($remaining.Count -eq 0) {
    Remove-Item $portFile -Force -ErrorAction SilentlyContinue
}

Write-Host "[stop] Done." -ForegroundColor DarkGray
