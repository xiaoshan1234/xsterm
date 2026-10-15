#!/usr/bin/env bash
# scripts/xsterm.sh — 从 WSL 调 Windows 侧构建(参考 ref/xsterm/test/tauri-launcher.ts)。
#
# 用法:
#   ./scripts/xsterm.sh setup     # 首次 / 切 OS 后跑一次,补全 optional native deps
#   ./scripts/xsterm.sh dev       # 启 tauri dev 完整 app
#   ./scripts/xsterm.sh build     # 出 release bundle
#   ./scripts/xsterm.sh check     # tsc + cargo check
#   ./scripts/xsterm.sh tsc       # 仅 tsc --noEmit
#   ./scripts/xsterm.sh cargo     # 仅 cargo check
#   ./scripts/xsterm.sh format    # prettier + cargo fmt
#   ./scripts/xsterm.sh format-check
#
# 要求:Windows 侧已装 Node + Rust,且 powershell.exe 在 WSL PATH 里。

set -euo pipefail

WINDOWS_PROJECT='C:\Users\LONER\1111\prj\xsterm'

run_ps() {
  local cmd="$1"
  powershell.exe -NoProfile -Command "Set-Location '${WINDOWS_PROJECT}'; ${cmd}"
}

run_ps_cargo() {
  local cmd="$1"
  powershell.exe -NoProfile -Command "Set-Location '${WINDOWS_PROJECT}\src-tauri'; ${cmd}"
}

case "${1:-}" in
  setup)
    # 切 OS 后 npm 4828 bug 会让 @tauri-apps/cli 的 native binding 缺失。
    run_ps "npm install --include=optional"
    ;;
  dev)
    run_ps "npm run tauri dev"
    ;;
  build)
    run_ps "npm run tauri build"
    ;;
  check)
    run_ps "npx tsc --noEmit"
    run_ps_cargo "cargo check"
    ;;
  tsc)
    run_ps "npx tsc --noEmit"
    ;;
  cargo)
    run_ps_cargo "cargo check"
    ;;
  format)
    run_ps "npx prettier --write \"src/**/*.{ts,tsx,css,json,md}\" \"doc/**/*.md\""
    run_ps_cargo "cargo fmt"
    ;;
  format-check)
    run_ps "npx prettier --check \"src/**/*.{ts,tsx,css,json,md}\" \"doc/**/*.md\""
    run_ps_cargo "cargo fmt --check"
    ;;
  *)
    cat <<EOF
Usage: $0 <command>

Commands:
  setup            Reinstall optional native deps (npm 4828 fix)
  dev              Run tauri dev (full app, Windows binary)
  build            Build release bundle
  check            tsc --noEmit + cargo check
  tsc              TypeScript only
  cargo            Rust only
  format           Prettier + cargo fmt (write)
  format-check     Prettier + cargo fmt (check)
EOF
    exit 1
    ;;
esac
