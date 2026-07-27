<#
.SYNOPSIS
  Starts the WebDriver stack that lets WSL (or any LAN host) drive xsterm.

.DESCRIPTION
  Architecture (WSL2 NAT mode):
      WSL selenium client -> 127.0.0.1:4444 (forwarded by WSL)
                       -> tauri-driver (127.0.0.1:4444)
                       -> msedgedriver (4445) -> xsterm.exe (WebView2)

  No TCP relay is needed: WSL2 NAT mode automatically proxies Windows
  loopback ports to WSL, so a WSL process can talk to tauri-driver on
  http://127.0.0.1:4444 directly.

  The script:
    1. Ensures tauri-driver is installed (cargo install, pinned version).
    2. Ensures msedgedriver is installed and version-matched with Edge
       (first three version components must match, per Microsoft docs).
    3. Starts tauri-driver and keeps it alive until Ctrl+C.
  Press Ctrl+C to stop the driver.

  IMPORTANT: this script does NOT start the Vite dev server. xsterm.exe
  resolves `localhost:1420` against the Windows host's network namespace,
  so Vite must also be running on Windows (e.g. `npm run dev` in a
  Windows shell). See test/README.md for the full workflow.

.PARAMETER TauriDriverVersion
  Pinned tauri-driver crate version installed when missing.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\start-webdriver.ps1
#>
[CmdletBinding()]
param(
  [string]$TauriDriverVersion = "2.0.6",
  [int]$TauriDriverPort = 4444
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "cargo not found. Install Rust via https://rustup.rs/ first."
}

$CargoBin = Join-Path $HOME ".cargo\bin"
if ($env:Path -notlike "*$CargoBin*") {
  $env:Path = "$CargoBin;$env:Path"
}

if (-not (Get-Command tauri-driver -ErrorAction SilentlyContinue)) {
  Write-Step "Installing tauri-driver $TauriDriverVersion (compiles from source, may take several minutes)..."
  cargo install tauri-driver --version $TauriDriverVersion --locked
} else {
  Write-Step "tauri-driver found: $((Get-Command tauri-driver).Source)"
}

function Get-EdgeVersion {
  $edgeExe = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  if (-not (Test-Path $edgeExe)) {
    $edgeExe = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
  }
  if (Test-Path $edgeExe) {
    return (Get-Item $edgeExe).VersionInfo.ProductVersion
  }
  return $null
}

function Get-MsEdgeDriverVersion {
  $out = & msedgedriver --version 2>$null
  if ($out -match "(\d+\.\d+\.\d+\.\d+)") { return $Matches[1] }
  return $null
}

$edgeVersion = Get-EdgeVersion
if (-not $edgeVersion) {
  Write-Warning "Microsoft Edge not found in default locations. Cannot verify msedgedriver compatibility."
}

$needDriver = $true
if (Get-Command msedgedriver -ErrorAction SilentlyContinue) {
  $driverVersion = Get-MsEdgeDriverVersion
  if ($edgeVersion -and $driverVersion) {
    $edgePrefix = ($edgeVersion -split "\.")[0..2] -join "."
    $driverPrefix = ($driverVersion -split "\.")[0..2] -join "."
    if ($edgePrefix -eq $driverPrefix) {
      $needDriver = $false
      Write-Step "msedgedriver $driverVersion matches Edge $edgeVersion."
    } else {
      Write-Warning "msedgedriver $driverVersion does NOT match Edge $edgeVersion - reinstalling."
    }
  } else {
    $needDriver = $false
    Write-Step "msedgedriver found (version check skipped)."
  }
}

if ($needDriver) {
  Write-Step "Installing msedgedriver-tool and downloading a matching msedgedriver..."
  if (-not (Get-Command msedgedriver-tool -ErrorAction SilentlyContinue)) {
    cargo install --git https://github.com/chippers/msedgedriver-tool
  }
  & (Join-Path $CargoBin "msedgedriver-tool.exe")
  if (-not (Get-Command msedgedriver -ErrorAction SilentlyContinue)) {
    throw "msedgedriver is still not on PATH after msedgedriver-tool. Check the tool output above."
  }
}

Write-Step "Starting tauri-driver on 127.0.0.1:$TauriDriverPort ..."
$tauriDriver = Start-Process -PassThru -NoNewWindow `
  -FilePath "tauri-driver" `
  -ArgumentList "--port $TauriDriverPort"

Start-Sleep -Seconds 2
if ($tauriDriver.HasExited) {
  throw "tauri-driver exited immediately with code $($tauriDriver.ExitCode)."
}

Write-Host ""
Write-Host "WebDriver stack is running." -ForegroundColor Green
Write-Host "  tauri-driver : http://127.0.0.1:$TauriDriverPort"
Write-Host ""
Write-Host "From WSL, verify with:"
Write-Host "  npm run test:remote:check"
Write-Host ""
Write-Host "Press Ctrl+C to stop tauri-driver."

try {
  while ($true) { Start-Sleep -Seconds 1 }
} finally {
  Write-Host "`nStopping tauri-driver..."
  Stop-Process -Id $tauriDriver.Id -Force -ErrorAction SilentlyContinue
}