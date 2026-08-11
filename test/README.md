# System Tests

This directory contains system-level (end-to-end) tests for **xsterm**, plus a
remote WebDriver driving stack that lets a WSL environment (e.g. an AI
assistant) control and inspect the app running on Windows.

## Prerequisites

- Node.js 22+ (current project uses v24)
- Google Chrome installed
- `chromedriver` and `selenium-webdriver` are already in `devDependencies`

## How to run

### 1. Run against an already-running Tauri app

Start the Tauri app in another terminal:

```bash
npm run tauri dev
```

Then run the system test:

```bash
npm run test:system
```

### 2. Let the test start the dev server

```bash
START_TAURI=true npm run test:system
```

> Works from **WSL** — the launcher uses `powershell.exe` to invoke `npm run tauri dev`
> on the Windows side, then polls `http://localhost:1420` until Vite responds.

> The smoke test waits up to 180 seconds for `http://localhost:1420` to respond.
> Set `TAURI_DEV_TIMEOUT_MS` to override the wait timeout.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_URL` | `http://localhost:1420` | Base URL of the running app |
| `HEADLESS` | `true` | Run Chrome in headless mode |
| `START_TAURI` | `false` | When `true`, the test launches `npm run tauri dev` |
| `TAURI_DEV_TIMEOUT_MS` | `180000` | Max time to wait for the dev server |

## Notes

- The tests use the **Node.js built-in test runner** (`node:test`) and **Selenium WebDriver**.
- The app is a Tauri 2 application; the tests assume the frontend is served and Tauri APIs are available.
- Some interactions (e.g., opening the create-session dialog) may behave differently when the app is running in a Chrome browser vs. the Tauri webview.
- The test suite is intentionally a **smoke test** that verifies the app renders and the main layout is present.

---

# Remote WebDriver Driving (WSL → Windows)

This setup lets a process inside **WSL** (for example an AI coding assistant)
drive and inspect the xsterm app running on **Windows**: create sessions,
click elements, execute JS, and take screenshots.

## Architecture

```
WSL selenium-webdriver client
        │  http://127.0.0.1:4444  (WSL2 NAT auto-forwards Windows loopback)
        ▼
tauri-driver (Windows, 127.0.0.1:4444 — has no --bind option, only loopback)
        │  127.0.0.1:4445
        ▼
msedgedriver → xsterm.exe (WebView2)
```

Key facts (validated in this repo):

- WSL2 NAT mode auto-proxies Windows loopback ports to WSL, so the WSL
  client can reach tauri-driver on `127.0.0.1:4444` directly. **No TCP
  relay is needed.**
- `tauri-driver` **launches the app itself** when a WebDriver session
  is created. Do not start xsterm manually beforehand.
- `tauri-driver` does **not** implement the standard WebDriver
  `/status` endpoint; use `GET /sessions` (returns `{"sessions":[]}`)
  to probe readiness.
- The debug binary loads `http://localhost:1420` **on the Windows
  side**, so the Vite dev server must also run on Windows (a WSL-side
  Vite is unreachable from xsterm.exe). Run `npm run dev` in a Windows
  shell, or use `scripts/start-webdriver.sh` after starting Vite.

## One-time setup

### Windows: install the WebDriver stack

In a PowerShell window on Windows, from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\start-webdriver.ps1
```

The script:

1. Installs `tauri-driver` via cargo (pinned version) if missing.
2. Installs a version-matched `msedgedriver` if missing/mismatched
   (first three version components must match your installed Edge).
3. Starts `tauri-driver` and keeps it alive until Ctrl+C.

Alternatively, from WSL:

```bash
bash scripts/start-webdriver.sh
```

This launches the PowerShell script detached (hidden window), polls
`/sessions` until ready, and prints the connect URL.

### Windows: native module check

If you ever ran `npm install` from inside WSL (e.g. when adding a
test dependency), the `node_modules/@rollup/` directory may contain
only Linux native binaries. Windows's `npm run dev` will then fail with
`Cannot find module @rollup/rollup-win32-x64-msvc`. Fix:

```bash
npm install --include=optional     # run from a Windows shell
```

## Daily workflow

**On Windows** (any terminal, foreground or background):

```powershell
npm run dev                                                    # Vite on :1420
powershell -ExecutionPolicy Bypass -File scripts\windows\start-webdriver.ps1
```

**On WSL** (this terminal / AI session):

```bash
npm run test:remote:check       # one-shot verification
npm run test:remote:drive       # interactive REPL
```

Commands: `shot <file.png>`, `html [css]`, `text <css>`, `find <css>`,
`click <css>`, `sendkeys <css> <text>`, `key <KEY>`, `exec <js>`,
`refresh`, `sleep <ms>`, `url`, `quit`.

Typical AI-assisted UI-tuning loop:

1. Windows: keep Vite + tauri-driver running.
2. WSL: `npm run test:remote:drive` (e.g. inside tmux).
3. `shot out/before.png` → inspect → edit code in WSL → `refresh` →
   `shot out/after.png` → compare.

## Which app binary gets launched?

By default the debug exe:

```
C:\Users\LONER\1111\prj\xsterm\src-tauri\target\debug\xsterm.exe
```

Override with the `TAURI_APPLICATION` env var (must be a **Windows**
path, not `/mnt/c/...`). Two supported workflows:

| Binary | Requirement | Best for |
|--------|-------------|----------|
| `target\debug\xsterm.exe` | Vite dev server (`npm run dev`) running **on Windows** | UI iteration: edit code in WSL, `refresh` picks up new code |
| `target\release\xsterm.exe` | nothing (frontend embedded) | verifying a packaged build |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REMOTE_WEBDRIVER_URL` | `http://127.0.0.1:4444` | WebDriver endpoint. Override when driving from a non-WSL host. |
| `TAURI_APPLICATION` | `C:\Users\LONER\1111\prj\xsterm\src-tauri\target\debug\xsterm.exe` | Windows path of the exe tauri-driver launches. |

## Troubleshooting

- **`npm run test:remote:check` fails at step 1 (reachability)** — the
  PowerShell script is not running on Windows. Start it (or run
  `bash scripts/start-webdriver.sh` from WSL).
- **Session creation fails with a driver/version error** — rerun
  `start-webdriver.ps1`; it reinstalls a matching msedgedriver.
- **App window opens but is blank (about:blank)** — Vite is not running
  on Windows. Run `npm run dev` on Windows, then `refresh` in the driver.
- **Windows-side `npm run dev` fails with `Cannot find module
  @rollup/rollup-win32-x64-msvc`** — see "native module check" above.

## One-shot helpers

| Script | Purpose |
|---|---|
| `scripts/start-webdriver.sh` | WSL-side: launches the Windows PowerShell stack detached, polls for readiness, prints the connect URL. |
| `scripts/windows/screenshot-window.ps1` | Windows-side: captures a single window (matched by title) into a PNG via `GetWindowRect` + `CopyFromScreen`. Falls back to full-screen capture if the window isn't visible. |

```bash
# From WSL — start the stack and wait until tauri-driver is responding
scripts/start-webdriver.sh

# On Windows — screenshot the xsterm window (or any title substring)
powershell -ExecutionPolicy Bypass -File scripts\windows\screenshot-window.ps1 -WindowTitle xsterm -OutPath C:\temp\xsterm.png
```

---

## UI system test suite (automated)

The `test/sys-test/` directory contains the automated E2E suite that drives the
real Windows app via tauri-driver + selenium-webdriver, covering the manual UI
test cases in `test/sys-test/ui-click-display-test-cases.md`.

- **Run**: `npm run test:ui` (preflight + serial specs) or `npm run test:ui:preflight`
- **Auto-start dev server**: `START_TAURI=true npm run test:ui` (launches `npm run tauri dev` before preflight)
- **Coverage matrix**: `test/sys-test/COVERAGE.md`
- **Docs**: [test/sys-test/README.md](sys-test/README.md)
