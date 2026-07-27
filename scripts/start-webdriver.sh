#!/usr/bin/env bash
#
# Start the xsterm WebDriver stack from WSL, with no need to open a
# PowerShell window manually. The script:
#   1. Launches scripts/windows/start-webdriver.ps1 detached inside
#      PowerShell.exe via Start-Process, so it survives this script exiting.
#   2. Polls http://127.0.0.1:4444/sessions until tauri-driver responds.
#   3. Prints connection info for npm run test:remote:check / :drive.
#
# In WSL2 NAT mode, Windows loopback ports are auto-forwarded, so the
# WSL client can talk directly to tauri-driver on 127.0.0.1:4444 — no
# relay or IP detection required.
#
# Stop with:  powershell.exe -NoProfile -Command "Get-Process tauri-driver -ErrorAction SilentlyContinue | Stop-Process -Force"
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PS_SCRIPT="scripts/windows/start-webdriver.ps1"
TAURI_DRIVER_PORT=4444
READY_TIMEOUT_S=30

if ! command -v powershell.exe >/dev/null; then
  echo "ERROR: powershell.exe not in PATH. Are you running inside WSL?" >&2
  exit 1
fi

WIN_PS_PATH=$(wslpath -w "$REPO_ROOT/$PS_SCRIPT")
if [ ! -f "$REPO_ROOT/$PS_SCRIPT" ]; then
  echo "ERROR: $PS_SCRIPT not found at $REPO_ROOT." >&2
  exit 1
fi

echo "==> Launching $PS_SCRIPT in a detached PowerShell window..."
powershell.exe -NoProfile -Command "
  Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','$WIN_PS_PATH' -WindowStyle Hidden
" >/dev/null

echo "==> Waiting for tauri-driver at http://127.0.0.1:$TAURI_DRIVER_PORT (up to ${READY_TIMEOUT_S}s)..."

deadline=$((SECONDS + READY_TIMEOUT_S))
while [ $SECONDS -lt $deadline ]; do
  # tauri-driver has no /status endpoint; GET /sessions returns 200 with {"sessions":[]} when ready.
  if curl -sf -m 2 "http://127.0.0.1:$TAURI_DRIVER_PORT/sessions" >/dev/null 2>&1; then
    echo "==> tauri-driver is responding."
    echo
    echo "Connect from WSL:  REMOTE_WEBDRIVER_URL=http://127.0.0.1:$TAURI_DRIVER_PORT npm run test:remote:check"
    echo "Then drive:        npm run test:remote:drive"
    echo
    echo "Stop with:         powershell.exe -NoProfile -Command \"Get-Process tauri-driver -ErrorAction SilentlyContinue | Stop-Process -Force\""
    exit 0
  fi
  sleep 1
done

echo "ERROR: tauri-driver did not become ready within ${READY_TIMEOUT_S}s." >&2
echo "The hidden PowerShell window (or 'Get-Process powershell') may show diagnostics." >&2
echo "Common cause: first-run cargo install is still compiling in the background." >&2
exit 1