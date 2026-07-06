# Workspace → Window → Session/Pane Architecture Refactor

## Goal
Change the frontend state/container hierarchy from:
- `Workspace (tab)` → `Session/Pane`

to:
- `Workspace` → `Window (tab)` → `Session/Pane`

A `Window` is a tabbed container inside a workspace. It owns the pane tree and active pane state. The UI renders workspace tabs at the top, and inside the active workspace renders a window tab bar plus the active window's pane tree.

## Current State
- `Workspace` in `src/types/session.ts` has `rootPane`, `activePaneId`, and `name`.
- `TabBar` renders `Workspace[]` as tabs.
- `WorkspaceContainer` renders the active workspace's pane tree.
- `useSessionActions` has `splitPane`, `setActivePane`, `updateWorkspacePaneTree`, `closeWorkspace`, `saveWorkspace`, `loadWorkspace`, `createWorkspaceFromSession`, etc.
- Persistence stores `SavedWorkspace` with `rootPane`.

## Phases

### Phase 1: Define types and state shape ✅
- Added `Window` and `SavedWindow` types.
- Updated `Workspace` to hold `windows: Window[]` and `activeWindowId`.
- Updated `SavedWorkspace` to hold saved windows.

### Phase 2: Update UI components ✅
- `WorkspaceContainer` renders a window tab bar (when >1 window) and the active window's pane tree.
- `PaneTree` and `Pane` now receive `windowId` and call `updateWindowPaneTree` / `splitPane` with window ID.
- `TabBar` derives session type from the active window.
- `AppLayout` derives `activeSessionId` from active window.

### Phase 3: Update state/actions ✅
- `useSessionActions` now has `createWindow`, `closeWindow`, `setActiveWindow`.
- `splitPane`, `setActivePane`, `updateWindowPaneTree` operate on a window inside a workspace.
- `createWorkspaceFromSession` creates a workspace with one default window.
- `saveWorkspace` / `loadWorkspace` handle windows.
- `closeSession`, `removeConfig`, and Tauri listeners now iterate over windows.

### Phase 4: Persistence migration ✅
- `loadSavedWorkspaces` wraps legacy saved workspaces (with `rootPane` directly) into a single default window.

### Phase 5: Type-check and clean up ✅
- `npm run build` passes (`tsc && vite build`).
- Removed unused `findPaneNode` from `WorkspaceContainer.tsx`.

## Files Likely to Change
- `src/types/session.ts`
- `src/contexts/session/types.ts`
- `src/contexts/session/useSessionState.ts`
- `src/contexts/session/useSessionActions.ts`
- `src/contexts/session/paneUtils.ts`
- `src/components/TabBar.tsx`
- `src/components/WorkspaceContainer.tsx`
- `src/components/AppLayout.tsx`
- `src/services/sessionStorage.ts`
- `src/components/sidebar/WorkspaceManager.tsx` (maybe)
- `src/hooks/useAppShortcuts.ts` (maybe)

## Notes
- Tmux already has its own "window" concept. The new frontend `Window` is unrelated. Naming may need disambiguation (e.g., `FrontendWindow` internally, but keep user-facing "Window").
- Preserve existing session lifecycle and tmux handling.
