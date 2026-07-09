# SSH Session Output Buffer Bug Fix

## Goal
Fix the bug where two SSH sessions in the same workspace appear to share/overlap the same terminal display buffer. Output from one session overwrites the other, although input still goes to the correct session separately.

## Root Cause
1. **Primary**: `useTauriTerminalOutput` reads `termRef.current` at execution time in `flushWrites` and cleanup. When the `sessionId` prop changes and the effect re-runs, the old effect's queued writes can be flushed into the new effect's xterm instance, causing cross-session output contamination.
2. **Secondary**: When a pane's `sessionId` changes, the same xterm instance is reused. The old session's output remains in the buffer, so the new session appears to share the display buffer with the previous one.
3. **Contributing**: `PaneTree` renders `<Pane>` without a `key` prop, so React cannot guarantee stable identity for terminal instances when the pane tree changes or sessions are reassigned. This can cause xterm instances to be reused or mismatched across sessions.

## Plan

### Phase 1 — Fix `useTauriTerminalOutput` ✅
- Capture the xterm instance into a local `xterm` const at the top of the effect.
- Make `flushWrites` and cleanup write to the captured `xterm` instance, not `termRef.current`.
- Drain the write queue to the old xterm in the cleanup function with try/catch.

### Phase 2 — Clear terminal on session change ✅
- In `Terminal.tsx`, clear the xterm in the `sessionId` effect so the new session starts with a fresh buffer.

### Phase 3 — Fix `PaneTree` keys ✅
- Add `key={node.id}` to the `<Pane>` element in `PaneTree`.

### Phase 4 — Verify ✅
- Run `npx tsc --noEmit` to ensure no TypeScript errors.
- Run `npm run build` to ensure the frontend builds.

## Files Modified
- `src/hooks/useTauriTerminalOutput.ts`
- `src/components/Terminal.tsx`
- `src/components/PaneTree.tsx`

## Verification Results
- `npx tsc --noEmit`: passed, no errors
- `npm run build`: passed, build artifacts generated

## Notes
- Reverted an initial attempt to add `sessionId` to `useXterm`'s dependency array. Disposing and recreating the xterm on every session change would race with `useTauriTerminalOutput`'s cleanup flush, so we instead keep the xterm instance and clear it explicitly.
- Rust backend was not modified; session IDs are already allocated uniquely and emitted per-session.
