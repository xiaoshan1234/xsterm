#!/usr/bin/env bash
#
# Kills leftover dev/test processes that hold TCP ports 1420 (Vite) and 4444 (tauri-driver).
#
# After running system tests (test:ui, test:remote:*) the Vite dev server or tauri-driver
# sometimes does not exit cleanly. Because vite.config.ts uses strictPort=true, the next
# `npm run dev` or `npm run tauri dev` then hangs for ~180 s before failing.
#
# Usage:
#   bash scripts/cleanup-test-env.sh
#   npm run test:cleanup
#
# POSIX-only (Linux, macOS, WSL). Windows users should call
# scripts/windows/cleanup-test-env.ps1 instead.

set -euo pipefail

PORTS=(1420 4444)
ALLOWED_REGEX='^(node|tauri-driver|msedgedriver|chromedriver|geckodriver)(-bin)?(\.exe)?$'

print_step() { printf '\033[36m==> %s\033[0m\n' "$*"; }
print_red()  { printf '\033[31m  %s\033[0m\n' "$*"; }
print_green(){ printf '\033[32m  %s\033[0m\n' "$*"; }
print_gray() { printf '\033[90m  %s\033[0m\n' "$*"; }

# Returns PIDs (one per line) that are LISTENING on the given TCP port.
# Tries lsof > ss > fuser until one of them works.
find_pids_for_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u
  elif command -v ss >/dev/null 2>&1; then
    ss -tlnpH "sport = :$port" 2>/dev/null \
      | grep -oE 'pid=[0-9]+' \
      | cut -d= -f2 | sort -u
  elif command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$port" 2>/dev/null \
      | tr -s ' ' '\n' | grep -E '^[0-9]+$' | sort -u
  else
    print_red "Cannot scan port $port: none of lsof/ss/fuser found."
    return 1
  fi
}

# Returns the process name for a PID. Returns "<unknown>" on failure.
process_name() {
  local pid="$1"
  if [ -r "/proc/$pid/comm" ]; then
    cat "/proc/$pid/comm" 2>/dev/null || echo "<unknown>"
  else
    ps -p "$pid" -o comm= 2>/dev/null | tr -d ' ' || echo "<unknown>"
  fi
}

killed_count=0
skipped_count=0
any_found=0

for port in "${PORTS[@]}"; do
  pids="$(find_pids_for_port "$port" || true)"
  [ -z "$pids" ] && continue
  any_found=1
  for pid in $pids; do
    name="$(process_name "$pid")"
    if [[ ! "$name" =~ $ALLOWED_REGEX ]]; then
      print_red "Skipping PID $pid ($name) on port $port - not in whitelist."
      skipped_count=$((skipped_count + 1))
      continue
    fi
    print_red "Killing PID $pid ($name) on port $port..."
    kill -TERM "$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    # Confirm the port is actually released by THIS pid (kill only delivers the
    # signal; the kernel may take a few ms to fully reap the process).
    port_freed=0
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 0.2
      remaining_pids="$(find_pids_for_port "$port" || true)"
      if ! printf '%s\n' "$remaining_pids" | grep -qx "$pid"; then
        port_freed=1
        break
      fi
    done
    if [ "$port_freed" -eq 1 ]; then
      print_green "killed $name (PID $pid) :$port"
      killed_count=$((killed_count + 1))
    else
      print_red "Failed to kill PID $pid (port $port still held after 2 s)."
      skipped_count=$((skipped_count + 1))
    fi
  done
done

if [ "$any_found" -eq 0 ]; then
  print_step "No leftover processes on ports ${PORTS[*]}. Done."
  exit 0
fi

echo
print_step "Summary: $killed_count killed, $skipped_count skipped."

if [ "$skipped_count" -gt 0 ]; then
  exit 2
fi
