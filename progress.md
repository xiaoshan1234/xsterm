# Project Progress Log

## 2026-07-09
- [x] Confirmed frontend only supports `local` and `ssh` session types.
- [x] Verified `npx tsc --noEmit` passes with zero errors.
- [x] Verified `npm run build` passes.
- [x] Verified `src/` contains no leftover references to the removed session subsystem.

## Verification Results
- `npx tsc --noEmit`: passed, no errors
- `npm run build`: passed, build artifacts generated
- `grep -ri <removed-subsystem> src/`: no matches

## 2026-07-09 — SSH Session Output Buffer Bug Fix
- [x] Fixed `useTauriTerminalOutput` stale closure by capturing the xterm instance at effect start and using it throughout.
- [x] Added `xterm.clear()` in `Terminal.tsx` when `sessionId` changes so a new session starts with a fresh buffer.
- [x] Added `key={node.id}` to `<Pane>` in `PaneTree.tsx` to ensure stable React identity for terminal instances.
- [x] Verified `npx tsc --noEmit` passes.
- [x] Verified `npm run build` passes (after `npm install` to fix missing `@rollup/rollup-linux-x64-gnu`).
- Rust backend not modified; session IDs are already unique per session.

## Verification Results
- `npx tsc --noEmit`: passed, no errors
- `npm run build`: passed, build artifacts generated
