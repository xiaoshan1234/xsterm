<#
.SYNOPSIS
  Kills leftover dev/test processes that hold TCP ports 1420 (Vite) and 4444 (tauri-driver).

.DESCRIPTION
  After running system tests (test:ui, test:remote:*) the Vite dev server or tauri-driver
  sometimes does not exit cleanly. Because vite.config.ts uses strictPort=true, the
  next `npm run dev` or `npm run tauri dev` then hangs for ~180 s before failing.

  This script:
    1. Looks for LISTENING sockets on the configured ports.
    2. Identifies the owning PID and process name.
    3. Stops the process with -Force if its name matches a known dev/test runner
       (whitelist, to avoid killing unrelated processes that might happen to grab the port).
    4. Exits 0 on clean or all-killed, 2 if some processes were skipped (unrelated port holders).

.PARAMETER Ports
  TCP ports to scan. Defaults to 1420 (Vite) and 4444 (tauri-driver).

.PARAMETER AllowedProcessNames
  Process names that may be killed. Anything else is reported and skipped.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\cleanup-test-env.ps1
.EXAMPLE
  npm run test:cleanup
#>
[CmdletBinding()]
param(
  [int[]]$Ports = @(1420, 4444),
  [string[]]$AllowedProcessNames = @(
    "node.exe", "tauri-driver.exe", "msedgedriver.exe", "chromedriver.exe", "geckodriver.exe"
  )
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Find-PortOwners {
  param([int[]]$PortList)
  $hits = @()
  foreach ($port in $PortList) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
      $name = if ($proc) { $proc.Name } else { "<unknown>" }
      $hits += [PSCustomObject]@{
        Port        = $port
        Pid         = $c.OwningProcess
        ProcessName = $name
      }
    }
  }
  # Deduplicate by Pid (one process can hold multiple ports).
  $hits | Sort-Object Port, Pid -Unique
}

$found = Find-PortOwners -PortList $Ports
if (-not $found -or $found.Count -eq 0) {
  Write-Step "No leftover processes on ports $($Ports -join ', '). Done."
  exit 0
}

Write-Step "Found leftover processes:"
$found | Format-Table -AutoSize | Out-String | Write-Host

$killed = @()
$skipped = @()
foreach ($row in $found) {
  if ($AllowedProcessNames -notcontains $row.ProcessName) {
    Write-Warning "Skipping PID $($row.Pid) ($($row.ProcessName)) on port $($row.Port) - not in whitelist."
    $skipped += $row
    continue
  }
  Write-Host "  Killing PID $($row.Pid) ($($row.ProcessName)) on port $($row.Port)..." -ForegroundColor Red
  Stop-Process -Id $row.Pid -Force -ErrorAction SilentlyContinue
  # Stop-Process is asynchronous on Windows: the process object may still be
  # queryable for a few ms after the kill signal. The only reliable check is
  # whether the port is still being listened on by THIS PID.
  $portFreed = $false
  for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 200
    $still = Get-NetTCPConnection -LocalPort $row.Port -State Listen -ErrorAction SilentlyContinue `
      | Where-Object { $_.OwningProcess -eq $row.Pid }
    if (-not $still) { $portFreed = $true; break }
  }
  if ($portFreed) {
    $killed += $row
  } else {
    Write-Host "  Failed to kill PID $($row.Pid) (port $($row.Port) still held after 2 s)." -ForegroundColor Red
    $skipped += $row
  }
}

Write-Host ""
$killed  | ForEach-Object { Write-Host "  killed  $($_.ProcessName) (PID $($_.Pid)) :$($_.Port)" -ForegroundColor Green }
$skipped | ForEach-Object { Write-Host "  skipped $($_.ProcessName) (PID $($_.Pid)) :$($_.Port)" -ForegroundColor DarkGray }

$uniqueKilled = ($killed  | Select-Object -ExpandProperty Pid -Unique).Count
$uniqueSkip   = ($skipped | Select-Object -ExpandProperty Pid -Unique).Count
Write-Host ""
Write-Host "Summary: $uniqueKilled killed, $uniqueSkip skipped." -ForegroundColor Cyan

if ($skipped.Count -gt 0) {
  exit 2
}
