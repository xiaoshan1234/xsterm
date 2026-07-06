# Workspace → Window → Session/Pane Architecture Refactor

## Goal
Change the frontend state/container hierarchy from:
- `Workspace (tab)` → `Session/Pane`

to:
- `Workspace` → `Window (tab)` → `Session/Pane`

A `Window` is a tabbed container inside a workspace. It owns the pane tree and active pane state. The UI renders workspace tabs at the top, and inside the active workspace renders a window tab bar plus the active window's pane tree.

## Phase 1-5 (completed)
- Defined `Window`/`SavedWindow` types and updated `Workspace`/`SavedWorkspace`.
- Updated actions (`createWindow`, `closeWindow`, `setActiveWindow`, `splitPane`, etc.).
- Updated UI (`WorkspaceContainer`, `PaneTree`, `Pane`, `TabBar`, `AppLayout`).
- Updated persistence with backward compatibility.
- Build passes.

## New Requirements (Phase 6)

### 6.1 Default workspace for session-config-created windows ✅
- Added `createWindowFromSession` and `createWindowFromSavedConfig`.
- `createAndActivateSession` and `openFromConfig` now add windows to the first/default workspace.

### 6.2 Per-workspace window tab bar and session tool ✅
- `WorkspaceContainer` now includes both the window tab bar and `CommandSendPanel`.
- `AppLayout` removed the global `CommandSendPanel` and resize handle.

### 6.3 Add-window button in window tab bar ✅
- `WindowTabBar` renders `+` button to create an empty window.

### 6.4 Window Manager sidebar ✅
- Added `"windows"` sidebar panel with `WindowManager` component.
- Supports load (double-click), rename, delete.

### 6.5 Right-click tab → save as window config ✅
- Window tabs have context menu with "Save as Window Config".

### 6.6 Save-all-windows button ✅
- Added save-all button in `WindowTabBar`.

### Verification ✅
- `npm run build` passes.
