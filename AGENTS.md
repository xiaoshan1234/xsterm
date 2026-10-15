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

Use the `wsl-windows-interop` skill to bridge:

- Frontend build/check: `powershell.exe -NoProfile -Command "Set-Location
  'C:\Users\LONER\1111\prj\xsterm'; npm run build"` (or `tauri dev`).
- Backend: `cargo.exe build --release` is callable directly from WSL once
  Rust is installed on the Windows side.
- Type check only: `powershell.exe -NoProfile -Command "Set-Location
  'C:\...\xsterm'; npx tsc --noEmit"`.

If you only need a Linux build (`cargo run` from WSL to validate logic),
`portable-pty` already branches on `cfg!(target_os = "windows")` and spawns
`/bin/bash --login` on Linux, so the Rust side runs cross-platform.

## Code layout

### Frontend (`src/`)

- Entry chain: `index.html` → `src/main.tsx` → `src/App.tsx`
  → `src/components/Terminal.tsx`. `App.tsx` is a thin wrapper; the entire
  terminal UI lives in `Terminal.tsx`.
- No router, no state library, no UI framework — bare React + xterm.js.
  `Terminal.tsx` uses `useRef` + a single `useEffect` to mount xterm, the
  `FitAddon`, and Tauri event listeners. Add new UI either as sibling
  components in `src/components/` or by extending `Terminal.tsx`.
- xterm.js version: `@xterm/xterm@^6.0.0` + `@xterm/addon-fit@^0.11.0`. Theme
  is hardcoded inline in `Terminal.tsx`. No CSS variables yet.
- Plain CSS only — `src/App.css` is global resets, `Terminal.tsx` uses an
  inline style for the container height. No CSS-in-JS, no Tailwind.

### Frontend ↔ Backend IPC (Tauri 2)

- **Commands** (TS → Rust, via `invoke()`):
  - `spawn_terminal({ rows, cols })` → opens a PTY and starts the reader thread.
  - `write_terminal({ data: number[] })` → bytes to the PTY master.
  - `resize_terminal(rows, cols)` → currently a no-op stub; do not rely on it.
- **Event** (Rust → TS, via `listen()`):
  - `terminal-data` — payload is `Vec<u8>` (raw PTY bytes). The frontend
    decodes it with `new TextDecoder().decode(new Uint8Array(payload))`.
    Note the mismatch: Rust emits `Vec<u8>` (numbers), the frontend receives
    `number[]` and reconstructs `Uint8Array` — keep both sides in sync if
    the payload type changes.
- Do not import from `@tauri-apps/api` directly inside new components — match
  `Terminal.tsx`'s pattern and call `invoke()` / `listen()` inline. There is
  no `services/` layer yet.

### Backend (`src-tauri/`)

- Entry: `src-tauri/src/main.rs` → `xsterm_lib::run()` (note the `_lib`
  suffix in the lib name — it is required on Windows to avoid clashing with
  the bin target; see `Cargo.toml` and rust-lang/cargo#8519). Do not rename.
- `lib.rs` registers `tauri-plugin-opener`, manages one `Mutex<PtyState>`
  (holds the master writer), and generates handlers for the three commands
  above via `tauri::generate_handler!`.
- Tauri 2 capabilities live in `src-tauri/capabilities/default.json`.
  Currently only `core:default` + `opener:default`. **Adding a plugin**
  (e.g. `clipboard-manager`, `store`) requires three steps:
  1. add the crate to `[dependencies]` in `Cargo.toml`,
  2. register `.plugin(...)` in `lib.rs::run()`,
  3. add the permission identifier to `capabilities/default.json`.

  Skipping step 3 compiles cleanly but throws at runtime in the webview.
- Shell selection lives in `lib.rs::spawn_terminal`: `powershell.exe
  -NoLogo -NoProfile` on Windows, `/bin/bash --login` elsewhere.
- `src-tauri/build.rs` is just `tauri_build::build()` — leave alone.
- Tauri 2 context object: do not edit `src-tauri/gen/schemas/` (regenerated
  on `tauri dev` / `tauri build`).

## .gitignore

- Ignored: `dist/`, `node_modules/`, `src-tauri/target/`,
  `src-tauri/gen/`, `doc/.obsidian/*`, `*.local`.
- **NOT** ignored but untracked: `ref/` (see top of file).
- Generate-once: `dist/`, `src-tauri/target/`. Don't try to inspect or
  commit those — they aren't in tree for a reason.

## What does NOT exist yet (don't assume)

- **No** ESLint / Prettier / `cargo fmt` runner script in `package.json`.
  Don't run `npm run lint` / `npm run format` — they will fail.
- **No** Vitest / unit-test setup, no `test/` directory at project root
  (the `test/` dir under `ref/xsterm/` is reference only).
- **No** design-system doc, no theme tokens, no router, no global
  React context.
- **No** CI workflow files (`.github/`) — verification is dev responsibility.
- **No** `opencode.json` at the project root (the `.opencode/` folder is the
  OpenCode agent's own plugin workspace, not project config).

If you add any of these (lint, format, test, CI), update `package.json` and
this file in the same change.

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
