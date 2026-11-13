# tmux TUI WebView E2E

This test drives the real Windows Tauri WebView2 application through
`tauri-driver` + Selenium. It launches real Codex and OpenCode executables
inside a WSL tmux session and verifies detach/reconnect behavior.

## Prerequisites

- Windows Node.js with the repository dependencies installed.
- WSL2 with `tmux`.
- `tauri-driver` and `msedgedriver-tool` in `PATH`.
- Codex installed through npm, or OpenCode available through `npx`.

The runner automatically:

- starts Vite if port 1420 is free;
- builds `xsterm.exe`; tmux uses xsterm's native WSL transport;
- downloads a version-matched `msedgedriver` when needed;
- starts tauri-driver on an isolated port;
- creates temporary saved configs and removes the tmux servers afterward.

## Run

```powershell
npm run test:e2e:tmux
```

Run one TUI:

```powershell
$env:XSTERM_E2E_TUIS = "codex"
npm run test:e2e:tmux
```

Failure screenshots are written to `test/e2e/artifacts/`.

## Clean residual processes

If a test is interrupted, release ports 1420/4444/4454/4455 and clean test
tmux servers with:

```powershell
npm run test:cleanup
```

Preview the processes that would be terminated:

```powershell
npm run test:cleanup -- --dry-run
```
