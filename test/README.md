# System Tests

This directory contains system-level (end-to-end) tests for **xsterm**.

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
