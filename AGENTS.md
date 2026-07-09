# Project Agent Rules

## Build & Compile Restrictions

**Do not run any compile, build, or transpile command without explicit user permission.** This includes but is not limited to:

- `make`, `cmake`, `ninja`, `cargo`, `rustc`
- `npm run build`, `yarn build`, `pnpm build`, `bun build`
- `npm run tauri build`, `yarn tauri build`, `pnpm tauri build`, `bun tauri build`, `cargo tauri build`, `npx tauri build`
- `vite build`, `npx vite build`, `tsc`, `tsc -b`, `tsc --build`
- `cargo build`, `cargo run`
- `docker build`

If the user asks you to build the project, suggest the exact command for them to run manually instead of executing it yourself.

## Project Orientation

- **xsterm** is a terminal emulator built with **Tauri 2 + React 19 + TypeScript 5.8 + Vite 7**.
- The app supports **local PTY shell sessions** and **SSH sessions** through a Rust backend.
- The codebase is split into two packages that are built separately:
  - `src/` — Vite frontend (React, xterm.js)
  - `src-tauri/` — Rust backend (Tauri, `portable-pty`, `russh`)

## Exact Commands

| Command | What it does |
|--------|--------------|
| `npm run dev` | Starts the Vite dev server only on port 1420. Does **not** start the Rust app. |
| `npm run tauri dev` | Runs the full Tauri app in development: starts Vite in the background, then compiles and launches the Rust binary. |
| `npm run build` | Runs `tsc` (type check only) + `vite build` → outputs to `dist/`. |
| `npm run tauri build` | Full production build: `npm run build`, then `cargo build --release`, then bundles the app. |
| `npm run preview` | Serves the built `dist/` via Vite preview. |
| `npm run tauri` | Pass-through to the Tauri CLI. |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Runs the Rust unit tests. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Fast Rust type-check without full compilation. |
| `cargo clippy --manifest-path src-tauri/Cargo.toml` | Rust lint (available, not enforced by CI). |

There are **no** `npm run lint`, `npm run test`, or `npm run format` scripts. There is no ESLint, Prettier, Vitest, Jest, or Playwright config in the repo.

## Architecture

### Frontend

- Entry chain: `index.html` → `src/main.tsx` → `src/App.tsx` → `src/components/AppLayout.tsx`.
- Global state is managed through **React Context** — three providers:
  - `SessionContext` — sessions, workspaces, panes, groups
  - `ThemeContext` — theme state
  - `LoggerContext` — logging bridge to the Rust backend
- All Tauri IPC goes through `src/services/sessionService.ts` (`invoke`) and `src/contexts/session/useTauriListeners.ts` (`listen`).
- Components import from these service modules, not directly from `@tauri-apps/api`.
- Styling is plain CSS only (no Tailwind, CSS-in-JS, or UI framework). CSS files are colocated next to components.
- The app has no router; view switching is state-driven inside `AppLayout`.

### Backend

- Entry chain: `src-tauri/src/main.rs` → `src-tauri/src/lib.rs::run()`.
- `lib.rs` registers the Tauri builder, plugins, logging setup, and the `SessionManager` state.
- All commands are defined in `src-tauri/src/commands/` and aggregated in `src-tauri/src/commands/mod.rs::all_handlers()`.
- Backend events pushed to the frontend use these exact names/payloads:
  - `session-output` → payload `[sessionId: number, data: number[]]` (UTF-8 byte array)
  - `session-closed` → payload `sessionId: number`
- State is stored behind a single `Arc<Mutex<SessionManager>>` passed as Tauri `State`.
- Layered structure: `commands` → `services` → `infrastructure` → `models`.

## Capabilities & Permissions

- Tauri 2 uses `src-tauri/capabilities/default.json` to declare permissions.
- Current capabilities include: `core:default`, `opener:default`, `store:default`, `clipboard-manager:default`, `clipboard-manager:allow-read-image`, and window control permissions (`minimize`, `maximize`, `unmaximize`, `close`, `is-maximized`, `start-dragging`).
- Adding a new Tauri command that requires a permission not listed here will fail at runtime unless the capability file is updated.

## Important Gotchas

- **You are on Tauri v2, not v1.** Capabilities/permissions in `src-tauri/capabilities/default.json` replace the v1 `allowlist` block. Adding a plugin requires three steps: (1) crate in `Cargo.toml`, (2) `.plugin(...)` registration in `lib.rs`, (3) permission identifier in the capability JSON. Skip step 3 and the plugin will compile but throw at runtime.
- **`invoke()` is not type-safe in this repo.** There is no `tauri-specta` or generated TypeScript bindings; command-name typos and argument-shape mismatches are only caught at runtime.
- **Window decorations are disabled** (`decorations: false` in `tauri.conf.json`). The frontend implements the custom title bar in `src/components/NavBar.tsx` using `getCurrentWindow()`.
- **Vite dev server uses a fixed port**: port 1420 with `strictPort: true`. If 1420 is taken, the dev server fails instead of picking another port. `npm run tauri dev` waits up to ~180 seconds for `http://localhost:1420` to respond and then exits if it never does.
- **Do not open `http://localhost:1420` in a standalone browser.** `__TAURI_INTERNALS__` is undefined outside the Tauri webview, so every `invoke()` call will throw.
- **Generated files — do not edit manually:**
  - `src/vite-env.d.ts` — generated by Vite
  - `src-tauri/gen/schemas/` — generated by Tauri during `tauri dev` / `tauri build`
- **SSH host-key verification is disabled** in `src-tauri/src/infrastructure/ssh.rs`. This is a known security gap; do not change it without an explicit user request.
- **CSP is disabled** (`"csp": null` in `tauri.conf.json`). Re-enable a restrictive CSP before adding any remote script, asset, or web content.
- **Version mismatch**: `package.json` and `Cargo.toml` are `0.1.1`, but `tauri.conf.json` is `0.1.2`. If you change one, consider whether the others should be updated too.
- **Logging setup intentionally leaks a guard** (`std::mem::forget(_guard)` in `src-tauri/src/logging_setup.rs`) to keep the rolling file writer alive for the application lifetime.
- **Mock-based Rust tests** live in an inline `#[cfg(test)]` block in `src-tauri/src/services/session_manager.rs`, using `mockall` for the `PtySystem`, `PtyPair`, `Child`, and `SshBackend` traits.
- **`opencode.json` currently allows all bash commands** (`permission.bash: "*": "allow"`), but this file (AGENTS.md) still forbids build/compile commands as an explicit project rule.
- **`list_sessions` is registered in the Rust command handler** but is **not exposed in `src/services/sessionService.ts`**. If you need to call it, add the frontend wrapper first.

## Persistence

- Session configs, groups, and log settings are persisted via `tauri-plugin-store` as JSON files in the Tauri app data directory.
- Frontend log messages are forwarded to the Rust backend via `log_message` and written to rolling log files by the `tracing` setup.

## VS Code

- `.vscode/extensions.json` recommends the Tauri and rust-analyzer extensions.
- `.vscode/launch.json` provides an LLDB-based Rust debugging configuration. It references the `ui:dev` task in `.vscode/task.json`, which runs `npm run dev`.

## .gitignore Reminder

`dist/`, `node_modules/`, `src-tauri/target/`, and `src-tauri/gen/` are ignored. Do not try to inspect or commit files inside them.
