# Workspace Session Ownership

## Goal
When a workspace instance is created from a saved workspace config, its sessions are created together with it. The saved workspace config does not store runtime session IDs; it only stores the session type/config (via `configId`) and pane layout. The runtime workspace instance explicitly tracks its contained sessions via `sessionIds` and manages their lifecycle (closing them when the workspace is closed).

## Current State
- `SavedWorkspace` persists pane trees that may still contain runtime `sessionId` values (bug).
- `Workspace` has no explicit `sessionIds` field; the inclusion relationship is implicit in the pane tree.
- `loadWorkspace` already recreates sessions from `configId`, but it preserves stale `sessionId` values.
- `closeWorkspace` does not close the workspace's sessions.

## Plan

### Phase 1 — Extend types and helpers
- Add `sessionIds: number[]` to the `Workspace` runtime type.
- Add `collectSessionIdsFromPaneTree`, `collectSessionIdsFromWorkspace`, and `withRecomputedSessionIds` helpers in `paneUtils.ts`.
- Add `stripSessionIdFromPaneTree` helper to ensure saved configs never persist runtime IDs.

### Phase 2 — Keep saved config free of runtime IDs
- `saveWorkspace`: strip `sessionId` from every pane tree before persisting.
- `saveWindow` / `saveAllWindows`: strip `sessionId` from saved pane trees.
- `loadWorkspace` / `loadWindow`: ignore stale `sessionId` in saved pane trees; always recreate from `configId`.

### Phase 3 — Workspace owns its sessions
- Populate `sessionIds` when a workspace is created:
  - `createDefaultWorkspace` → `[]`
  - `createWorkspaceFromSession` → `[sessionId]`
  - `loadWorkspace` → collect from loaded pane trees
- Recompute `sessionIds` after every workspace pane/session mutation:
  - `createWindow`, `createWindowFromSession`, `createWindowFromSavedConfig`, `loadWindow`
  - `replaceInitWindowWithSession`, `splitPane`
  - `closeWindow`, `closeSession`, `removeConfig`
  - `useTauriListeners` session-closed and tmux CommandError handlers
- `closeWorkspace`: close all sessions listed in `workspace.sessionIds`.

### Phase 4 — Verify
- `npm run build` passes with no TypeScript errors.
- No type-safety suppressions (`as any`, `@ts-ignore`, etc.).

## Files to Modify
- `src/types/session.ts`
- `src/contexts/session/paneUtils.ts`
- `src/contexts/session/useSessionActions.ts`
- `src/contexts/session/useTauriListeners.ts`
