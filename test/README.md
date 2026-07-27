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
        │  http://<windows-ip>:4446
        ▼
TCP relay (scripts/windows/webdriver-relay.mjs, listens on 0.0.0.0:4446)
        │  127.0.0.1:4444
        ▼
tauri-driver (Windows, loopback only - it has no --bind option)
        │  127.0.0.1:4445
        ▼
msedgedriver → xsterm.exe (WebView2)
```

`tauri-driver` **launches the app itself** when a WebDriver session is
created. Do not start xsterm manually beforehand.

## One-time Windows setup

In a PowerShell window on Windows, from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\start-webdriver.ps1
```

The script will:

1. Install `tauri-driver` via cargo (pinned version) if missing.
2. Install a version-matched `msedgedriver` if missing/mismatched
   (first three version components must match your installed Edge).
3. Start `tauri-driver` + the TCP relay and keep both alive until Ctrl+C.

If Windows Firewall blocks inbound connections on the relay port, run once in
an **admin** PowerShell:

```powershell
New-NetFirewallRule -DisplayName 'xsterm webdriver relay' -Direction Inbound -Protocol TCP -LocalPort 4446 -Action Allow
```

### Which app binary gets launched?

By default the debug exe is used:

```
C:\Users\LONER\1111\prj\xsterm\src-tauri\target\debug\xsterm.exe
```

Override with the `TAURI_APPLICATION` env var (must be a **Windows** path,
not `/mnt/c/...`). Two supported workflows:

| Binary | Requirement | Best for |
|--------|-------------|----------|
| `target\debug\xsterm.exe` | Vite dev server (`npm run dev`) running **on Windows** | UI iteration: edit code in WSL, `refresh` in the driver picks up new code |
| `target\release\xsterm.exe` | nothing (frontend embedded) | verifying a packaged build |

> The debug exe loads `http://localhost:1420` **on the Windows side** — the
> Vite server must run on Windows, not in WSL.

## Usage from WSL

Self-check (diagnoses connectivity, session creation, screenshot round-trip):

```bash
npm run test:remote:check
```

Interactive driving REPL (keeps one app session alive):

```bash
npm run test:remote:drive
```

Commands: `shot <file.png>`, `html [css]`, `text <css>`, `find <css>`,
`click <css>`, `sendkeys <css> <text>`, `key <KEY>`, `exec <js>`, `refresh`,
`sleep <ms>`, `url`, `quit`.

Typical AI-assisted UI-tuning loop:

1. Windows: keep `start-webdriver.ps1` and `npm run dev` running.
2. WSL: `npm run test:remote:drive` (e.g. inside tmux).
3. `shot out/before.png` → inspect → edit code in WSL → `refresh` →
   `shot out/after.png` → compare.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REMOTE_WEBDRIVER_URL` | `http://<auto-detected-gateway>:4446` | Full relay URL; set this to bypass auto-detection |
| `REMOTE_WEBDRIVER_PORT` | `4446` | Relay port when auto-detecting the host IP |
| `TAURI_APPLICATION` | `C:\Users\LONER\1111\prj\xsterm\src-tauri\target\debug\xsterm.exe` | Windows path of the exe tauri-driver launches |

## Troubleshooting

- **`npm run test:remote:check` fails at step 2 (reachability)** — the
  PowerShell script is not running, or the firewall blocks port 4446.
- **Session creation fails with a driver/version error** — rerun
  `start-webdriver.ps1`; it reinstalls a matching msedgedriver.
- **App window opens but is blank** — debug exe without the Vite dev server
  running on Windows. Start `npm run dev` on Windows, then `refresh`.
- **Port 4446 already in use** — a previous relay is still alive; stop it or
  set `RELAY_PORT`/`REMOTE_WEBDRIVER_PORT` to a different port on both sides.
