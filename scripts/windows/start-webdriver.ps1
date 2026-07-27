<#
.SYNOPSIS
  Starts the WebDriver stack that lets WSL (or any LAN host) drive xsterm.

.DESCRIPTION
  Architecture:
      WSL selenium client --> relay (0.0.0.0:4446) --> tauri-driver (127.0.0.1:4444)
                                                      --> msedgedriver (4445) --> xsterm.exe

  tauri-driver only binds 127.0.0.1 (no --bind option), so a small Node TCP
  relay (scripts/windows/webdriver-relay.mjs) exposes it for WSL.

  The script:
    1. Ensures tauri-driver is installed (cargo install, pinned version).
    2. Ensures msedgedriver is installed and version-matched with Edge
       (first three version components must match, per Microsoft docs).
    3. Starts tauri-driver and the relay in the background.
    4. Prints the URL that WSL clients should use.
  Press Ctrl+C to stop both processes.

.PARAMETER TauriDriverVersion
  Pinned tauri-driver crate version installed when missing.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\start-webdriver.ps1
#>
[CmdletBinding()]
param(
  [string]$TauriDriverVersion = "2.0.6",
  [int]$TauriDriverPort = 4444,
  [int]$RelayPort = 4446
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

# --- 0. Prerequisites -------------------------------------------------------

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw "cargo not found. Install Rust via https://rustup.rs/ first."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node not found. Node.js is required for the TCP relay."
}

$CargoBin = Join-Path $HOME ".cargo\bin"
if ($env:Path -notlike "*$CargoBin*") {
  $env:Path = "$CargoBin;$env:Path"
}

# --- 1. tauri-driver ---------------------------------------------------------

if (-not (Get-Command tauri-driver -ErrorAction SilentlyContinue)) {
  Write-Step "Installing tauri-driver $TauriDriverVersion (this compiles from source, may take a few minutes)..."
  cargo install tauri-driver --version $TauriDriverVersion --locked
} else {
  Write-Step "tauri-driver found: $((Get-Command tauri-driver).Source)"
}

# --- 2. msedgedriver (must match installed Edge, first 3 version parts) -----

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
  Write-Warning "Microsoft Edge not found in the default locations. Cannot verify msedgedriver compatibility."
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

# --- 3. Start tauri-driver + relay ------------------------------------------

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$RelayScript = Join-Path $RepoRoot "scripts\windows\webdriver-relay.mjs"

Write-Step "Starting tauri-driver on 127.0.0.1:$TauriDriverPort ..."
$tauriDriver = Start-Process -PassThru -NoNewWindow `
  -FilePath "tauri-driver" `
  -ArgumentList "--port $TauriDriverPort"

Write-Step "Starting TCP relay on 0.0.0.0:$RelayPort -> 127.0.0.1:$TauriDriverPort ..."
$relay = Start-Process -PassThru -NoNewWindow `
  -FilePath "node" `
  -ArgumentList "`"$RelayScript`"" `
  -WorkingDirectory $RepoRoot

Start-Sleep -Seconds 2
if ($tauriDriver.HasExited) { throw "tauri-driver exited immediately with code $($tauriDriver.ExitCode)." }
if ($relay.HasExited) { throw "relay exited immediately with code $($relay.ExitCode). Is port $RelayPort already in use?" }

# --- 4. Report ---------------------------------------------------------------

$lanIp = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254.*" } |
  Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "WebDriver stack is running:" -ForegroundColor Green
Write-Host "  tauri-driver : http://127.0.0.1:$TauriDriverPort  (Windows-local)"
Write-Host "  relay        : http://${lanIp}:$RelayPort  (use this from WSL)"
Write-Host ""
Write-Host "From WSL, verify with:"
Write-Host "  npm run test:remote:check"
Write-Host ""
Write-Host "If Windows Firewall blocks the relay port, run once in an ADMIN shell:"
Write-Host "  New-NetFirewallRule -DisplayName 'xsterm webdriver relay' -Direction Inbound -Protocol TCP -LocalPort $RelayPort -Action Allow"
Write-Host ""
Write-Host "Press Ctrl+C to stop both processes."

try {
  while ($true) { Start-Sleep -Seconds 1 }
} finally {
  Write-Host "`nStopping tauri-driver and relay..."
  Stop-Process -Id $tauriDriver.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $relay.Id -Force -ErrorAction SilentlyContinue
}
