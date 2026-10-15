# scripts/build-windows.ps1 — 从 Windows PowerShell 直接跑构建(给 Windows 用户用)。
#
# 多数情况 WSL 用户用 xsterm.sh 即可,这个脚本给习惯 PowerShell 的人留个入口。
#
# 用法(在项目根目录):
#   powershell -NoProfile -File scripts/build-windows.ps1 dev
#   powershell -NoProfile -File scripts/build-windows.ps1 check

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("setup", "dev", "build", "check", "tsc", "cargo", "format", "format-check")]
  [string]$Command
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

switch ($Command) {
  "setup" { npm install --include=optional }
  "dev" { npm run tauri dev }
  "build" { npm run tauri build }
  "check" {
    npx tsc --noEmit
    Push-Location src-tauri
    cargo check
    Pop-Location
  }
  "tsc" { npx tsc --noEmit }
  "cargo" {
    Push-Location src-tauri
    cargo check
    Pop-Location
  }
  "format" {
    npx prettier --write "src/**/*.{ts,tsx,css,json,md}" "doc/**/*.md"
    Push-Location src-tauri
    cargo fmt
    Pop-Location
  }
  "format-check" {
    npx prettier --check "src/**/*.{ts,tsx,css,json,md}" "doc/**/*.md"
    Push-Location src-tauri
    cargo fmt --check
    Pop-Location
  }
}
