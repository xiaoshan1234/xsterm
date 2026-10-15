# xsterm — Agent Guide

A Tauri 2 + React 19 + TypeScript + Vite 7 desktop terminal emulator starter.
Current working tree (branch `hold-v1`) is a work-in-progress port of the
template toward an xterm.js-driven PTY app — small (~200 LOC). **Two-package
split, but no monorepo tooling**: `src/` (frontend) and `src-tauri/` (backend)
build and run independently.

## Working tree status (read first)

- Branch: `hold-v1` (NOT `main` / `dev` — many `origin/*` branches exist; do
  not switch without an explicit user request).
- Top-level template files are modified vs the initial commit. Untracked:
  - `ref/xsterm/` — a more developed reference implementation of the same
    project. Has its own `AGENTS.md`, design-system doc, and full architecture.
    **Do not edit or treat as project source.** It is here for reference only.
  - `ref/oxideterm/` — a separate Tauri terminal project used for comparison.
  - **Do not** confuse `ref/xsterm/AGENTS.md` with this file. The reference's
    rules (Cursor design system, ADR-driven architecture, WSL toolchain
    restrictions, ~20 commands, etc.) apply only inside `ref/xsterm/`.

## Build & run

Only commands defined in `package.json` exist — there is no lint, format,
test, or storybook script yet. Don't invent commands.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server only on **port 1420** (`strictPort: true`). Does NOT launch the Tauri/Rust shell. |
| `npm run build` | `tsc && vite build` → emits `dist/` (frontend only). |
| `npm run preview` | Serves the built `dist/` via Vite preview. |
| `npm run tauri dev` | Full app: starts Vite, then `cargo build` + launches the Rust binary. |
| `npm run tauri build` | `npm run build` then `cargo build --release` + bundles MSI/NSIS/.deb/.dmg. |
| `npm run tauri` | Pass-through to `@tauri-apps/cli`. |

`tauri build` invokes the Rust compiler; `npm run dev` alone does not.

## Vite / Tauri port coupling

- `vite.config.ts` pins `server.port = 1420` with `strictPort: true`.
  If port 1420 is in use, Vite **fails instead of falling back**.
- `src-tauri/tauri.conf.json` sets `devUrl: "http://localhost:1420"` and
  `frontendDist: "../dist"` — change both together if the port moves.
- `npm run tauri dev` blocks until Vite at `localhost:1420` is ready
  (Tauri CLI default timeout). To skip that wait on slow setups, start
  `npm run dev` in another shell first — Tauri will then attach to an
  already-running Vite.
- Do not open `localhost:1420` in a non-Tauri browser: `__TAURI_INTERNALS__`
  is undefined and every `invoke()` / `listen()` will throw.

## WSL environment

You're in WSL (`Platform: linux`). This project produces a Windows binary
(WebView2 + MSVC) by default. **When invoking `cargo`, `rustc`, or `npm
run build` / `tauri dev` / `tauri build`, prefer the Windows toolchain** —
WSL-native builds produce Linux binaries the Tauri shell can't load.

**Use the scripts in [`scripts/`](scripts/) — do not call `cargo` / `npm`
directly from WSL for cross-cutting work.** The WSL↔Windows path is
fragile (Windows mount permissions, npm optional-deps like
`@rollup/rollup-linux-x64-gnu`).

- `./scripts/xsterm.sh dev` — full Tauri dev (Windows binary, Vite on :1420)
- `./scripts/xsterm.sh build` — production bundle
- `./scripts/xsterm.sh check` — `tsc --noEmit` + `cargo check`
- `./scripts/xsterm.sh tsc` / `cargo` / `format` / `format-check` — finer

Or from PowerShell directly:

- `powershell -NoProfile -File scripts/build-windows.ps1 dev`

If you only need a Linux build (`cargo run` from WSL to validate logic),
`portable-pty` already branches on `cfg!(target_os = "windows")` and spawns
`/bin/bash --login` on Linux, so the Rust side runs cross-platform.

## Code layout

> 完整层次文档见 [`doc/arch/ARCHITECTURE.md`](doc/arch/ARCHITECTURE.md) 和 [`doc/arch/LAYERS.md`](doc/arch/LAYERS.md)。速查:[`doc/arch/frontend-quick-ref.md`](doc/arch/frontend-quick-ref.md)。
> 本节是 brief 摘要。

### Frontend (`src/`)

- Entry chain: `index.html` → `src/main.tsx` → `src/ui/App.tsx` → 各种
  `src/ui/*` 组件。
- **目录 ↔ 层映射**:
  - `src/ui/` → **L7**(chrome: TabBar / SplitContainer / PaneChrome / PaneInitCard / App)
  - `src/ui/styles/` → **L8**(design tokens,M2 提前落地)
  - `src/hooks/` → **L5**(usePaneTree / useTerminalSession / paneTreeContext)
  - `src/infra/xterm/` → **L4**(唯一 `@xterm/*` 入口)
  - `src/model/` → **L3**(纯 TS 数据结构,PaneNode / PaneTree / SessionId)
  - `src/service/` → **L2**(唯一 `invoke`/`listen` 入口,pty.ts / session.ts)
  - `src/main.tsx` → entry,import `./ui/App` + `./ui/styles/tokens.css`
- xterm.js version: `@xterm/xterm@^6.0.0` + `@xterm/addon-fit@^0.11.0`。
  xterm 主题在 `src/infra/xterm/theme.ts`,与 chrome tokens 独立
  (DESIGN.md §3.2)。
- Plain CSS only — 每个组件自带 `.css` 文件,无 CSS-in-JS / Tailwind。

### Frontend ↔ Backend IPC (Tauri 2)

- **Commands** (TS → Rust, all `snake_case`,见 `src/service/`):
  - `spawn_terminal({ rows, cols, shell })` → `SessionId` (number)
  - `write_terminal({ id, data: number[] })` — bytes to PTY master
  - `resize_terminal({ id, rows, cols })`
  - `close_session({ id })` — 幂等(NotFound 当成功)
  - `list_sessions()` → `SessionInfo[]`
- **Events** (Rust → TS):
  - `terminal-data` — payload `{ id: number, data: number[] }`(M2 加 id,见
    `doc/arch/ARCHITECTURE.md` §5.2)
  - `terminal-exit` — payload `{ id: number }`(M2 新增,触发 PaneChrome banner)
- L2 是**唯一**调 `@tauri-apps/api` 的层。L3 / L4 / L5 / L7 不得 `import`
  `invoke` / `listen`(R1)。
- L4 是**唯一** import `@xterm/*` 的层(R3)。L5 / L7 通过
  `import type { Terminal } from "../infra/xterm/xterm"` 拿类型。

### Backend (`src-tauri/`)

- Entry: `src-tauri/src/main.rs` → `xsterm_lib::run()` (note the `_lib`
  suffix in the lib name — it is required on Windows to avoid clashing with
  the bin target; see `Cargo.toml` and rust-lang/cargo#8519). Do not rename.
- 层次:
  - `src-tauri/src/core/` → **L0**(纯 Rust,无 Tauri 依赖;`pty` / `shell` / `session`)
  - `src-tauri/src/commands/` + `events.rs` + `state.rs` + `error.rs` → **L1**(Tauri 胶水)
  - `lib.rs` → 入口:plugin 注册 + `generate_handler!` + dispatch 线程
- 跨层契约:命令 handler 第一行 `state.manager.lock()`,主体委托
  `core::session::SessionManager`;reader 线程 `mpsc::sync_channel` →
  L1 dispatch → `app.emit("terminal-data", payload)`。
- Tauri 2 capabilities live in `src-tauri/capabilities/default.json`。
  目前 `core:default` + `opener:default`。**Adding a plugin** requires
  three steps:
  1. add the crate to `[dependencies]` in `Cargo.toml`,
  2. register `.plugin(...)` in `lib.rs::run()`,
  3. add the permission identifier to `capabilities/default.json`.

  Skipping step 3 compiles cleanly but throws at runtime in the webview.
- Shell 抽象在 `core/shell.rs`:M1 实现 PowerShell / Bash(其他
  `Wsl` / `GitBash` 标 `ShellError::Unsupported`)。
- `src-tauri/build.rs` is just `tauri_build::build()` — leave alone.
- Tauri 2 context object: do not edit `src-tauri/gen/schemas/` (regenerated
  on `tauri dev` / `tauri build`).

## Architecture — `doc/arch/` is authoritative

**The structural spec lives in [`doc/arch/ARCHITECTURE.md`](doc/arch/ARCHITECTURE.md)**
with per-layer detail in [`doc/arch/LAYERS.md`](doc/arch/LAYERS.md). Active
milestone blueprint (what to build *now*) lives in `doc/blueprint/M*.md`.

Scope split, mirrored from the `DESIGN.md` relationship:

| Document | Scope |
|---|---|
| `DESIGN.md` | chrome **visual** (colors / spacing / radius / hairline) |
| `doc/arch/ARCHITECTURE.md` | **structure & module boundaries** (who owns what, who may depend on whom) |

If `AGENTS.md` and either doc disagree, the doc wins — fix `AGENTS.md`.

### Headline rules (full list in `ARCHITECTURE.md` §4)

- **8 layers, single-direction.** Top depends on bottom, bottom knows nothing
  above. Names L0–L8 from `ARCHITECTURE.md` §1.
- **L2 is the only TS layer that imports `@tauri-apps/api`.** L3, L4, L5, L7
  must not `invoke` / `listen`.
- **L4 is the only TS layer that imports `@xterm/*`.** L7 must not `new Terminal()`.
- **L0 (Rust core) does not depend on Tauri.** `src-tauri/src/core/` must not
  `use tauri::...`.
- **PaneTree lives in L3 (TS).** Rust does not know about tabs / splits. The
  foreign key is `SessionId`.
- **IPC command / event names are `snake_case`** on both sides; literal-string
  matching. Mirror types are hand-written (no codegen until M5).

If a future change wants to violate one of these, update the doc first.

## Frontend design — `DESIGN.md` is authoritative

**The full spec lives in [`DESIGN.md`](DESIGN.md).** This section captures the
invariants the agent must not violate. If this section and `DESIGN.md` ever
disagree, `DESIGN.md` wins — fix `AGENTS.md`, not the codebase. Read
`DESIGN.md` once before writing any chrome (any UI outside the xterm
container).

### Two themes, decoupled

xsterm has **two independent** theme systems. They live on different stacks by
intent — never bridge them.

| Surface | Authority | Where it lives |
|---|---|---|
| **Shell chrome** — titlebar, status bar, buttons, dialogs, banners, settings, anything outside the xterm container | `DESIGN.md` §3.1 + §4 | CSS variables in `src/styles/tokens.css` `:root`, consumed via `var(--...)` |
| **xterm terminal content** — PTY output, cursor, selection, 24-bit color | `DESIGN.md` §3.2 | xterm.js `theme` prop (currently inline in `src/components/Terminal.tsx`; will move to `src/types/theme.ts`) |

xterm is canvas-rendered and does **not** read CSS variables. The two share no
code path; their hex literals only happen to overlap by convention. xterm's
ANSI palette is **not** `--accent` — leave it inside the §3.2 layer.

### Hard rules (chrome only, unless noted)

- **Single accent.** `--accent: #f54e00` (Cursor Orange) is the only "electric"
  color. Use only for: primary CTA, focus border, active underline, focus ring,
  wordmark. **Never** on body text, **never** as a default border.
- **Weight discipline.** Chrome uses `400` / `500` only. `≥ 600` (bold) is
  banned in chrome. The only exceptions are: wordmark, `caption-uppercase`
  (11px / 600 / uppercase), and code blocks (which sit inside the `--font-mono`
  zones). `--font-mono` is reserved for xterm container wrappers (if needed),
  code blocks, command echoes, and explicit monospace snippets — **never** the
  whole UI.
- **Hairline-only depth.** 1px borders via `var(--hairline*)` do all the
  layering. **No `box-shadow`** on cards / sections / inputs / panes.
  Floating overlays (Dialog / ContextMenu / popover) are the only documented
  exception — log new uses in `DESIGN.md` §12.2.
- **No gradients / glow.** No `linear-gradient`, no `radial-gradient`, no
  `text-shadow` glow. Flat surfaces only.
- **No hardcoded hex in component CSS.** Every color / spacing / radius / font
  resolves through `var(--...)` from `:root`. The `:root` block itself in
  `src/styles/tokens.css` is the only place hex literals belong, plus the
  documented exceptions in `DESIGN.md` §12.
- **No Tailwind / CSS-in-JS / CSS Modules.** Plain global CSS only.
- **No VSCode blue hex** (`#0e639c` / `#1177bb`) — leaks VSCode vibes.
- **No legacy semantic tokens** (`--bg-primary`, `--border-color`,
  `--text-secondary`, etc.) — use the vocabulary from `DESIGN.md` §4.

### Spacing & radius (chrome)

- Spacing rhythm: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 / 80 (px). Default field
  gap = 16px (`--space-base`). Major section gap = 80px (`--space-section`).
- Radius decision tree:
  - button / input → `--radius-md` (8px)
  - card / dialog → `--radius-lg` (12px)
  - list row → `--radius-sm` (6px)
  - inline tag / badge → `--radius-xs` (4px) or `--radius-pill`
  - avatar / status dot → `--radius-pill`
  - Cards **never** use 4 / 6px. Buttons / inputs **never** use 12 / 16px.

### Validation (`DESIGN.md` §13)

Run before claiming a UI change done — all three must produce empty results
(after `src/ui/styles/tokens.css` exists; otherwise the first command will
false-positive on hex matches in chrome files until tokens land):

```bash
# Forbidden token names, forbidden palette, gradients — must be empty
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/ \
  --include="*.ts" --include="*.tsx" --include="*.css"

# Bold weights in chrome — must be empty
grep -rn -E "font-weight: ?(600|700|bold)" src/ --include="*.ts" --include="*.tsx" --include="*.css"

# box-shadow locations — only the §12.2 / §12.3 exceptions should appear
grep -rn "box-shadow:" src/ui/ --include="*.css"
```

### Token reference pointer

Full catalog (surface tiers, hairline tiers, semantic colors, typography scale,
spacing scale, radius scale, overlay) → **`DESIGN.md` §4**. Component specs
(Button, Form input, Card, Dialog, Tab, Banner) → **`DESIGN.md` §8**. Color
usage table (token / where it's used / where it isn't) → **`DESIGN.md` §5**.
Documented exceptions → **`DESIGN.md` §12**.

## .gitignore

- Ignored: `dist/`, `node_modules/`, `src-tauri/target/`,
  `src-tauri/gen/`, `doc/.obsidian/*`, `*.local`.
- **NOT** ignored but untracked: `ref/` (see top of file).
- Generate-once: `dist/`, `src-tauri/target/`. Don't try to inspect or
  commit those — they aren't in tree for a reason.

## What does NOT exist yet (don't assume)

- **No** ESLint / Prettier in `package.json`'s scripts — but `scripts/xsterm.sh format`
  / `format-check` 跑 Prettier + cargo fmt(从 WSL 调 PowerShell)。
- **No** Vitest / unit-test setup, no `test/` directory at project root
  (the `test/` dir under `ref/xsterm/` is reference only).
- **No** router, no global state library (Zustand etc.) — 当前用 React Context +
  useReducer-style 状态在 `usePaneTree`。
- **No** CI workflow files (`.github/`) — verification is dev responsibility.
- **No** `opencode.json` at the project root (the `.opencode/` folder is the
  OpenCode agent's own plugin workspace, not project config).

如果加了新东西(lint rule、test 框架、CI、新 plugin),在同一次 commit 改
`AGENTS.md` 标记。

## Platform-specific deps 铁律(WSL 踩过的坑)

**禁止**把 `@rollup/rollup-{linux,darwin,win32,...}-*` 写进 `package.json`。
项目是 **Windows-only**,这些 platform binaries 走 `vite` 的 `optionalDependencies`
自动装,**不要**手动 pin,**不要**在 WSL 里 `npm install --force <platform>`
救场。

- 项目是 Windows-only — `package.json` 不应该有 platform-pin
- `node_modules` 里出现当前 OS 对应的 rollup binary 是正常的(vite optionalDeps 拉的)
- 装错 / 缺了 → 在 Windows 侧跑 `npm install --include=optional`(见 `scripts/xsterm.sh setup`),
  **不要**在 WSL 装 Linux 的顶替
- **从 WSL 验证构建**:只跑 `npx tsc --noEmit` + `cargo check`,**不要** `npm run build`
  (后者会触发 vite 找 Linux rollup,污染 lockfile)
- 历史踩坑:本项目曾被显式 pin `@rollup/rollup-linux-x64-gnu` 和 `-win32-x64-msvc`,
  已被本次 A 重整清理;`package-lock.json` 里的 `linux-x64-gnu` 是 lockfile 跨平台
  问题,在 Windows 上 `rm -rf node_modules package-lock.json && npm install` 重生
  即可

## Naming rules

Detailed conventions live in dedicated files under `doc/rules/`:

- [`doc/rules/ts-name-rules.md`](doc/rules/ts-name-rules.md) — TypeScript / TSX
- [`doc/rules/rust-name-rules.md`](doc/rules/rust-name-rules.md) — Rust

The headline: TS and Rust follow their own idioms (camelCase vs snake_case
for functions, PascalCase types either way) but **Tauri command names are
`snake_case` on both sides** because the Rust fn name IS the string literal
in `invoke("...")`. Same for events (`emit` ↔ `listen`).

## Shell working directories

The dirs `.hermes/`, `.omo/`, `.logs/`, and `.opencode/` look like project
folders but are Sisyphus / agent-runtime state. They are not committed and
should not be edited by hand or added to git. If you need scratch space,
use `/tmp/opencode` instead.
