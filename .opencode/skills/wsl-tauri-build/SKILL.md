# WSL → Windows Tauri Build/Dev

Run `npm run tauri dev` and `npm run tauri build` from WSL using the Windows toolchain (Node.js, Cargo, WiX, NSIS).

## When to Use

- User asks to `tauri dev`, `tauri build`, or run/debug a Tauri app from WSL
- User wants to compile a Tauri project using Windows toolchain while working in WSL
- User mentions "Windows toolchain", "tauri dev from WSL", "cross-compile Tauri"

## Prerequisites

| Tool | How to verify |
|---|---|
| `node.exe` on Windows PATH | `node.exe --version` |
| `cargo.exe` on Windows PATH | `cargo.exe --version` |
| `npm` available via `powershell.exe` | `powershell.exe -NoProfile -Command "npm --version"` |
| WSL interop enabled | `grep -E "^(flags|interpreter)" /proc/sys/fs/binfmt_misc/WSLInterop` |
| Project has `node_modules/` | `ls node_modules/.package-lock.json` |

## Critical Gotchas

### 1. Path mangling — NEVER pass WSL paths to `node.exe` directly

```bash
# WRONG — node.exe interprets /mnt/c/... as C:\mnt\c\...
node.exe /mnt/c/Program\ Files/nodejs/node_modules/npm/bin/npm-cli.js run build
# → Error: Cannot find module 'C:\mnt\c\Program Files\...'

# CORRECT — use powershell.exe as intermediary
powershell.exe -NoProfile -Command "Set-Location 'C:\Users\LONER\project'; npm run build"
```

### 2. tmux send-keys drops backslashes in paths

```bash
# WRONG — backslashes get eaten by tmux
tmux send-keys -t session "powershell.exe -Command \"Set-Location 'C:\Users\LONER\project'\"" Enter
# → Set-Location receives 'C:UsersLONERproject'

# CORRECT — use forward slashes, PowerShell accepts them
tmux send-keys -t session "powershell.exe -NoProfile -Command \"Set-Location 'C:/Users/LONER/project'; npm run tauri dev\"" Enter
```

### 3. Port 1420 must be free before `tauri dev`

Tauri's `beforeDevCommand` starts Vite on port 1420 with `strictPort: true`. If occupied, it fails silently or hangs.

```bash
# Check and kill
powershell.exe -NoProfile -Command \
  "Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue }"
```

### 4. `cargo.exe` works directly from WSL (no path issues)

Unlike `node.exe`, `cargo.exe` handles WSL paths correctly. You can run it directly:

```bash
cargo.exe build --release  # Works fine from WSL
```

But `npm run tauri build` wraps cargo via npm, so still use `powershell.exe` for the full pipeline.

---

## Recipes

### Recipe 1: `tauri dev` (development mode)

Long-running process — use tmux to manage.

```bash
# Step 1: Clear port 1420
powershell.exe -NoProfile -Command \
  "Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue }"

# Step 2: Convert project path (WSL → Windows, use forward slashes for tmux)
WIN_PATH=$(wslpath -w "$(pwd)" | sed 's/\\/\//g')

# Step 3: Create tmux session and launch
tmux new-session -d -s tauri-dev
tmux send-keys -t tauri-dev "powershell.exe -NoProfile -Command \"Set-Location '${WIN_PATH}'; npm run tauri dev\"" Enter

# Step 4: Wait for startup, then check output
sleep 15
tmux capture-pane -p -t tauri-dev -S -50
```

**Expected output sequence:**
1. `VITE vX.X.X ready in Nms` → `http://localhost:1420/`
2. `Running DevCommand (cargo run ...)`
3. `Finished dev profile` → `Running target\debug\<app>.exe`
4. App logs appear (session storage loaded, etc.)

**To stop:**
```bash
tmux send-keys -t tauri-dev C-c
sleep 2
# Also clean up Vite if it lingers
powershell.exe -NoProfile -Command \
  "Get-NetTCPConnection -LocalPort 1420 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue }"
```

### Recipe 2: `tauri build` (production build)

One-shot process — can run directly via `powershell.exe`.

```bash
# Convert project path
WIN_PATH=$(wslpath -w "$(pwd)" | sed 's/\\/\//g')

# Run build
powershell.exe -NoProfile -Command "Set-Location '${WIN_PATH}'; npm run tauri build"
```

**Expected output:**
1. `Running beforeBuildCommand npm run build` → Vite builds `dist/`
2. `Compiling <app> v...` → Cargo release build
3. `Finished release profile [optimized]`
4. `Built application at: ...\target\release\<app>.exe`
5. `Running candle/light` → MSI bundle
6. `Running makensis` → NSIS bundle
7. `Finished 2 bundles at:` with paths

**Verify outputs:**
```bash
# Get Windows project path for verification
WIN_PROJ=$(wslpath -w "$(pwd)")

# Check MSI
ls -lh "${WIN_PROJ}\\src-tauri\\target\\release\\bundle\\msi\\"

# Check NSIS
ls -lh "${WIN_PROJ}\\src-tauri\\target\\release\\bundle\\nsis\\"

# Check binary
ls -lh "${WIN_PROJ}\\src-tauri\\target\\release\\<app>.exe"
```

### Recipe 3: Frontend-only build (skip Rust)

```bash
WIN_PATH=$(wslpath -w "$(pwd)" | sed 's/\\/\//g')
powershell.exe -NoProfile -Command "Set-Location '${WIN_PATH}'; npm run build"
```

### Recipe 4: Backend-only build (skip frontend)

```bash
cargo.exe build --release --manifest-path src-tauri/Cargo.toml
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot find module 'C:\mnt\c\...'` | Passed WSL path to node.exe | Use `powershell.exe -Command "Set-Location ...; npm ..."` |
| `Set-Location: 找不到路径 "C:UsersLONER..."` | tmux ate backslashes | Use forward slashes: `C:/Users/LONER/...` |
| Vite fails to start, port 1420 in use | Previous dev server didn't clean up | Kill process on port 1420 (see Recipe 1 Step 1) |
| `cargo build` succeeds but `tauri build` fails at bundling | Missing WiX or NSIS | Install WiX Toolset 3.11+ and NSIS, ensure on PATH |
| GUI window doesn't appear | WSL session not connected to Windows desktop | Launch from Windows Terminal or ensure WSL has display access |
| `npm run tauri dev` hangs after Vite starts | Port conflict or cargo compilation taking long | Check `tmux capture-pane` for progress; cargo first build can take 5+ min |

---

## Path Conversion Quick Reference

```bash
# WSL → Windows (for powershell.exe Set-Location)
wslpath -w /mnt/c/Users/LONER/project
# → C:\Users\LONER\project

# WSL → Windows with forward slashes (for tmux send-keys)
wslpath -w /mnt/c/Users/LONER/project | sed 's/\\/\//g'
# → C:/Users/LONER/project

# Windows → WSL (for reading build outputs)
wslpath -u 'C:\Users\LONER\project\src-tauri\target\release'
# → /mnt/c/Users/LONER/project/src-tauri/target/release
```

---

## Build Output Locations

| Artifact | Windows Path | WSL Path |
|---|---|---|
| Release binary | `src-tauri\target\release\<app>.exe` | `src-tauri/target/release/<app>.exe` |
| MSI bundle | `src-tauri\target\release\bundle\msi\` | `src-tauri/target/release/bundle/msi/` |
| NSIS bundle | `src-tauri\target\release\bundle\nsis\` | `src-tauri/target/release/bundle/nsis/` |
| Frontend dist | `dist\` | `dist/` |
| App logs | `%LOCALAPPDATA%\<identifier>\logs\` | `/mnt/c/Users/<user>/AppData/Local/<identifier>/logs/` |
