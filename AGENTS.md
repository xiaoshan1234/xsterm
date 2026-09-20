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

## Pre-commit Formatting — Standing Rule

**Every commit must run formatters before `git commit`.** Both languages, no exceptions (other than commits that touch only generated files: `src-tauri/gen/`, `dist/`, `node_modules/` — gitignored anyway).

### The sequence

```bash
# 1. Frontend — Prettier rewrites files in place
npm run format

# 2. Backend — rustfmt rewrites Rust sources in src-tauri/
cargo fmt --manifest-path src-tauri/Cargo.toml

# 3. Stage the formatting-only changes
git add -u

# 4. Commit (existing code + formatter rewrites in the same commit)
git commit -m "..."
```

Then run the format **check** versions to confirm clean state:

```bash
npm run format:check           # exit 0 = clean
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check   # exit 0 = clean
```

### Why "auto-format" not just "check"

This project chose `npm run format` + `cargo fmt` (mutating) over `format:check` + `cargo fmt --check` (fail-on-drift) because:

- Style drift on save is faster to fix than style drift on PR review.
- A rebase that drops the formatter run produces noisy diffs; running the formatter locally keeps the diff focused on the actual change.
- The project does not yet have a git pre-commit hook (intentional, per dev review 2026-09) — the rule relies on dev discipline. **If a PR shows up with `npm run format:check` or `cargo fmt --check` failing, treat it as a bug fix, not a style nit.**

### When formatting breaks code

Two cases to watch for — do NOT silence the formatter, fix the underlying issue:

1. **Prettier wraps a long string literal** → break the string into a template literal with concatenation, or extract a constant. See `src/services/sessionService.ts` for canonical examples.
2. **rustfmt splits a long `match` arm across lines** → usually correct; if it hurts readability, extract a helper function instead of fighting the formatter.

### Markdown files in `doc/`

Prettier formats `.md` files too (`format` script's glob includes `md`). Long Chinese lines and ASCII diagrams may wrap differently than expected — preview the diff before committing. **Do not** add prettier-ignore comments to `doc/` files just to silence reformatting; either accept the diff or restructure the content.

## Exact Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Starts the Vite dev server only on port 1420. Does **not** start the Rust app. |
| `npm run tauri dev` | Runs the full Tauri app in development: starts Vite in the background, then compiles and launches the Rust binary. |
| `npm run build` | Runs `tsc` (type check only) + `vite build` → outputs to `dist/`. |
| `npm run tauri build` | Full production build: `npm run build`, then `cargo build --release`, then bundles the app. |
| `npm run preview` | Serves the built `dist/` via Vite preview. |
| `npm run tauri` | Pass-through to the Tauri CLI. |
| `npm run lint` / `npm run lint:fix` | ESLint over `src/` (`lint:fix` auto-fixes). |
| `npm run format` | Prettier auto-formats `src/**/*.{ts,tsx,css,json,md}` in place. |
| `npm run format:check` | Prettier check only (no writes) — used in CI / pre-commit verify. |
| `npm test` / `npm run test:watch` | Vitest (frontend unit tests). |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Runs the Rust unit tests. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Fast Rust type-check without full compilation. |
| `cargo clippy --manifest-path src-tauri/Cargo.toml` | Rust lint (available, not enforced by CI). |
| `cargo fmt` | Auto-formats all Rust sources in `src-tauri/` per rustfmt defaults. |
| `cargo fmt --check` | Rust format check only (no writes) — used in CI / pre-commit verify. |

Tools available in this repo (none of which are wired into a CI pipeline yet — verification is dev responsibility):

- ESLint (`@eslint/js` + `typescript-eslint` + `eslint-plugin-react-hooks`)
- Prettier 3 (`.prettierrc` + `.prettierignore` at repo root)
- Vitest 4 + jsdom + `@testing-library/react` for frontend unit tests
- chromedriver + selenium-webdriver for system / UI tests (`test:system`, `test:ui`)
- rustfmt (default config — no `rustfmt.toml` in the repo)


## Architecture

### Core Concepts

xsterm 的几个概念容易混淆（特别是 "session"）。**session = backend 连接的抽象，与 UI 树（workspace / window / pane）正交**。

| 概念 | 是什么 | 拥有方 |
|---|---|---|
| **xsterm session** (frontend `Session`) | **backend 连接** —— 一个能读写 stdin/stdout 的活动实体。local 模式 = PTY 进程；ssh 模式 = russh channel；tmux-cc 模式 = tmux pane 的逻辑代理。**独立于 UI 树**。 | Rust：`SessionManager.sessions: DashMap<u32, ActiveSession>`。<br>React：`useSessionState` 的 `sessions: Session[]` |
| **workspace** | UI 顶层容器（`WorkspaceContainer`），承载多个 xsterm Window | `workspaces[]` |
| **xsterm Window** | UI 二级容器，承载一棵 `PaneTree`。对应 tmux window（1:1）。 | `workspace.windows[]` |
| **pane** (PaneTree leaf) | UI 三级容器，渲染一个 xterm.js 实例。**绑定**一个 Session（通过 `sessionId` 字段）。对应 tmux pane（1:1）。 | `window.rootPane` 树 |
| **TmuxController** | 1 个 `tmux -CC` 子进程 / SSH exec channel 的客户端。≈ 1 个 tmux session（对用户不可见）。 | Rust：`SessionManager.tmux_controllers: DashMap<u32, Arc<TmuxController>>` |

**关键关系**：

- **xsterm session ≠ tmux session**。前者是 backend 连接的抽象，后者是 tmux 自己的概念（承载多个 window/pane）。两者**没有对应关系**。
- **xsterm pane ↔ tmux pane**（1:1 渲染关系）。两者都是 leaf 概念；tmux pane 提供 stdin/stdout 给 xsterm session，xsterm pane leaf 在 PaneTree 里**渲染**该 session。
- **创建 session 时根据 `type` 自动装配 UI**（`useSessionLifecycle::createAndActivateSession`）：
  - `local` / `ssh` / `tmux-cc (create)` → 默认调 `createWindowFromSession` → 1 new xsterm Window + 1 new pane leaf 绑该 session
  - `tmux-cc (attach)` → 通过 `tmux-pane-added` 事件注册已有 pane bindings；listener 决定是否新建 ws/window
  - `tmux split` (`create_tmux_pane`) → 不创建 ws/window；在已存在的 PaneTree 里 split 出新 leaf 绑新 session
  - `tmux new-window` (`create_tmux_window`) → 创建新 xsterm Window + 第一个 pane leaf 绑新 session
- **关闭 session 时**：`closeSession` → 关闭 backend → 删 session → 在所有 workspace 调 `removeSessionAndCollapse` 移除绑它的 leaf。
- **Tauri 命令后缀** `_tmux_pane` / `_tmux_window` 反映**该命令的 tmux 视角效果**（如 `kill-pane` / `split-window`），且**参数也都是 tmux 视角**。两类对照:
  - **`_tmux_pane` 命令**（`kill_tmux_pane` / `create_tmux_pane` / `capture_tmux_pane` 等）接收 `(controller_id: u32, tmux_pane_id: String)`（`tmux_pane_id` 是 server-side id 如 `"%5"`，来自 `tmux-pane-added` 事件的 payload）。
  - **`_tmux_window` 命令**（`kill_tmux_window` / `rename_tmux_window` 等）接收 `(controller_id: u32, tmux_window_id: String)`（`tmux_window_id` 是 server-side id 如 `"@5"`，来自 `tmux-window-added` 事件的 payload）。
  - **本地 id 对 server id 的转换在 ts 层完成**：ts 持有 xsterm Window / xsterm Session ↔ tmux window / tmux pane 的映射（从 `tmux-*-added` 事件 payload 里拿到的 `(controllerId, tmux_*)`），invoke 前直接传 server id；rs 层不再查 `sessions` 也不再做 controller 全表扫描。

**命名禁忌**（读代码 / 写文档时务必注意）：

- ❌ "xsterm session = tmux pane" —— 错。xsterm session 是连接，pane 是 UI leaf。
- ❌ "xsterm session 对应 tmux session" —— 错。xsterm session 代理的是 **tmux pane**，不是 tmux session。
- ❌ "frontend `Session` 就是 xsterm pane" —— 错。pane 是 PaneTree leaf，通过 `sessionId` 引用 Session。
- ❌ 把 `xsterm_session_id` 参数类型说成 "tmux pane id" —— 错。它是 `Session.id` u32。

- 详细实现：[`doc/dev/architecture/02-process-view.md` §3](doc/dev/architecture/02-process-view.md) / [`doc/dev/architecture/03-development-view.md` §3](doc/dev/architecture/03-development-view.md) / [`doc/dev/architecture/README.md`](doc/dev/architecture/README.md) / [`doc/dev/history/prd-0.1-requirements/req-006-tmux.md` §2](doc/dev/history/prd-0.1-requirements/req-006-tmux.md)

### Frontend

- Entry chain: `index.html` → `src/main.tsx` → `src/App.tsx` → `src/components/AppLayout.tsx`.
- Global state is managed through **React Context** — three providers:
  - `SessionContext` — sessions（xsterm session 注册表）, workspaces, panes, groups
  - `ThemeContext` — theme state
  - `LoggerContext` — logging bridge to the Rust backend
- All Tauri IPC goes through `src/services/sessionService.ts` (`invoke`) and `src/contexts/session/useTauriListeners.ts` (`listen`).
- Components import from these service modules, not directly from `@tauri-apps/api`.
- Styling is plain CSS only (no Tailwind, CSS-in-JS, or UI framework). CSS files are colocated next to components.
- The app has no router; view switching is state-driven inside `AppLayout`.
- Full architecture overview, complexity hotspots, and onboarding path: [`doc/dev/architecture/README.md`](doc/dev/architecture/README.md).

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

After a bug is fixed, update `doc/dev/changelog/bugs.md` with the root cause and the solution details. Mark the bug as resolved (`是否解决: YES`) and keep the record in the same format as existing entries.

## Documentation Map

All project documentation lives under `doc/`, organized by **role** (dev / pdm / tm):

| Path | Purpose | When to read |
|---|---|---|
| `doc/design-system.md` | Cursor 暗色 IDE 适配版 UI 设计系统（**必读**） | 任何 UI 改动前 |
| `doc/dev/architecture/README.md` → 5 个视图 | 全栈架构地图 + 复杂度热点 + onboarding path | 新人入门、改 session/window/pane 前 |
| `doc/dev/changelog/bugs.md` | 已知 bug 历史 + 修复记录（按时间倒序） | 改 bug 前查历史 |
| `doc/dev/changelog/perf.md` | 本地 PTY I/O 性能诊断 + 与 oxideterm 的架构对比 + 按 ROI 排序的修复计划（Perf 001-009） | 改 session I/O / 调 IPC / 排查"打字卡 / cat 大文件卡"前 |
| `doc/dev/roadmap/` | 演进路线（gap-analysis / target-architecture / migration-prs） | 做产品决策、改字段行为前 |
| `doc/dev/flows/` | 端到端代码流程（path:line + ASCII 图） | 排查"卡哪一步" / 跟新功能调用链时 |
| `doc/dev/history/prd-0.1-requirements/create-session-config.md` | Create Session 表单字段完整参考（**已归档**，可能过时） | 改 CreateSessionDialog 前 |
| `doc/dev/history/prd-0.1-requirements/session-config-{common,shell,ssh}.md` | Session config 三类字段详表（**已归档**，可能过时） | 改 LocalSessionForm / SshSessionForm / CommonSettingsForm 前 |
| `doc/tm/handoff.md` | tm 验收专属入口（90 分钟达到拍板水平） | tm 第一次接手 / 每个 PR 验收前 |
| `doc/pdm/` | pdm 的输入（外部 ai-terminal 规格 + 验收标准） | 拍产品决策前 |

**历史迁移记录**（不要再回到这些路径）：
- ~~`doc/frontend-architecture.md`~~ —— 2026-07-02 目标态（含 tmux 相关文件），与实际仓库不符，已删除
- ~~`doc/architecture-map.md`~~ —— 已迁移到 `doc/dev/history/prd-0.1-arch-snapshot/architecture-map.md`（保留作历史）
- ~~`doc/bug.md`~~ —— 已迁移到 `doc/dev/changelog/bugs.md`
- ~~`doc/req-*.md`~~ —— 已迁移到 `doc/dev/history/prd-0.1-requirements/req-*.md`（保留作历史）
- ~~`doc/rfcs/~~ —— 已迁移到 `doc/dev/adr/legacy-rfcs/`
- ~~`doc/prd/~~ —— 已迁移到 `doc/pdm/`
- ~~`doc/version.md`~~ / ~~`doc/dev-manage.md`~~ —— 已删除

**新文档结构**（详见 `doc/README.md`）：`dev/` / `pdm/` / `tm/` 三角色目录 + `design-system.md` 顶层。所有"现状"文档在 `dev/architecture/`，所有"废弃但保留可追溯"在 `dev/history/`。
