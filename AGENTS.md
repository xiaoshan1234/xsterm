# Project Agent Rules

## Project Orientation

- **xsterm** is a terminal emulator built with **Tauri 2 + React 19 + TypeScript 5.8 + Vite 7**.
- The app supports **local PTY shell sessions** and **SSH sessions** through a Rust backend.
- The codebase is split into two packages that are built separately:
  - `src/` — Vite frontend (React, xterm.js)
  - `src-tauri/` — Rust backend (Tauri, `portable-pty`, `russh`)

## Design System — Standing Rule ⛔

**The shell UI follows an adapted Cursor design language.** This is a **standing project rule**, not a suggestion. Every UI change (new component, dialog, panel, button, surface) **must** consult and follow [`doc/design-system.md`](doc/design-system.md).

Quick reference:
- Tokens live in `src/styles/global.css` `:root`. Reference via `var(--...)` — **no hex literals** in component CSS (documented exceptions in §10 of the doc).
- Dark IDE palette: `--canvas` `#1a1a1a`, `--ink` `#e8e6e0`, `--accent: #f54e00` (Cursor Orange).
- Typography: Inter / system sans for UI, JetBrains Mono only on code surfaces. Display weight **400–500**, never 600+ on chrome.
- Radius: 8px (buttons / inputs), 12px (cards / dialogs), 6px (rows), pill (badges).
- Depth: **hairline-only** (`var(--hairline*)`). No `box-shadow` on cards/sections/inputs. No gradients. No text-shadow glow.
- Two independent theme systems: shell chrome (CSS vars) vs xterm terminal content (`src/types/theme.ts`). Do not mix them.
- Terminal **content** themes (5 ANSI presets) are user-switchable and **out of scope** for shell chrome.

**Pre-commit verification** (run all three before committing UI work):
```bash
# 1. No forbidden tokens / VSCode blue / gradients — MUST be empty.
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/ --include="*.ts" --include="*.tsx" --include="*.css"

# 2. No bold weights on chrome — MUST be empty.
grep -rn "font-weight: ?(600|700|bold)" src/ --include="*.ts" --include="*.tsx" --include="*.css"

# 3. No drop shadows outside allowed floating overlays — MUST show only the
#    5 documented exceptions in doc/design-system.md §10.2 + §10.3.
#    If a new match appears, it is a violation: add an exception to §10 first.
grep -rn "box-shadow:" src/components/ --include="*.css"
```

All three grep results must be reviewed against [`doc/design-system.md`](doc/design-system.md) §10 before merging UI work. (1) and (2) must return zero matches; (3) must match only the documented exceptions.

## Build Toolchain (WSL Environment)

**When running in WSL, always use the Windows toolchain for compilation.** Do not use WSL-native `rustc`/`cargo`/`node`/`npm` for building.

- **Frontend**: Use `powershell.exe -NoProfile -Command "Set-Location 'C:/path/to/project'; npm run build"` (or `npm run dev`, `npm run tauri dev`, etc.).
- **Backend**: Use `cargo.exe build --release` (directly callable from WSL) or the full `npm run tauri build` via PowerShell.
- **Type check**: Use `powershell.exe -NoProfile -Command "Set-Location 'C:/path/to/project'; npx tsc --noEmit"`.

**Why**: The project targets Windows (WebView2, MSVC). Building with WSL toolchain produces Linux binaries that cannot run as the Tauri app.

**Test launcher**: Use `test/tauri-launcher.ts` for `START_TAURI=true` workflows — it handles the PowerShell invocation automatically.

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
- Full architecture overview, complexity hotspots, and onboarding path: [`doc/arch/architecture-map.md`](doc/arch/architecture-map.md).

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
- **Version sync**: `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` all carry a `version` field. The MSI/NSIS bundle version is taken from Cargo.toml and tauri.conf.json — `package.json` is used by npm scripts only. If you bump one, bump all three.
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

## Bug Fix Documentation

After a bug is fixed, update `doc/maintenance/bug.md` with the root cause and the solution details. Mark the bug as resolved (`是否解决: YES`) and keep the record in the same format as existing entries.

## Documentation Map

All project documentation lives under `doc/`, organized by purpose:

| Path | Purpose | When to read |
|---|---|---|
| `doc/design-system.md` | Cursor 暗色 IDE 适配版 UI 设计系统（**必读**） | 任何 UI 改动前 |
| `doc/arch/architecture-map.md` | 全栈架构地图 + 复杂度热点 + onboarding path | 新人入门、改 session/window/pane 前 |
| `doc/maintenance/bug.md` | 已知 bug 历史 + 修复记录（按时间倒序） | 改 bug 前查历史 |
| `doc/requirements/prd-0.1/` | v0.1 PRD 拆解 + 需求文档（req-*.md）+ session-config 字段详表 | 做产品决策、改字段行为前 |
| `doc/requirements/prd-0.1/create-session-config.md` | Create Session 表单字段完整参考 | 改 CreateSessionDialog 前 |
| `doc/requirements/prd-0.1/session-config-{common,shell,ssh}.md` | Session config 三类字段详表 | 改 LocalSessionForm / SshSessionForm / CommonSettingsForm 前 |

**已删除/过期的旧文档**（不要再引用）：
- ~~`doc/frontend-architecture.md`~~ —— 2026-07-02 目标态（含 tmux 相关文件），与实际仓库不符，已删除
- ~~`doc/architecture-map.md`~~ —— 已迁移到 `doc/arch/architecture-map.md`
- ~~`doc/bug.md`~~ —— 已迁移到 `doc/maintenance/bug.md`
- ~~`doc/req-*.md`~~ —— 已迁移到 `doc/requirements/prd-0.1/req-*.md`
- ~~`doc/version.md`~~ / ~~`doc/dev-manage.md`~~ —— 已删除
