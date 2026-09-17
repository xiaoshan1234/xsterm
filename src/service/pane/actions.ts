/**
 * Pane service — action function surface.
 *
 * **Scope**: transient pane-level UI state that doesn't belong
 * on a `Window` (last-focused pane, drag-and-drop highlight,
 * etc). The per-window `activePaneId` lives inside `Window`
 * (managed by `service/workspace/store.ts`); the per-pane
 * tree mutations live in `service/workspace/store.ts` actions.
 *
 * **Stub bodies**: only the simple flags are wired in Commit 3.
 * Commit 4 fills in any actions that need to look across
 * workspaces / windows.
 */
import { usePaneStore, type PaneStoreState } from "./store";

export function setLastFocusedPaneId(id: string | null): void {
  usePaneStore.getState().setLastFocusedPaneId(id);
}

export function setLastFocusedPanePath(
  path: { workspaceId: string; windowId: string; paneId: string } | null,
): void {
  usePaneStore.getState().setLastFocusedPanePath(path);
}

export function getLastFocusedPaneId(): string | null {
  return usePaneStore.getState().lastFocusedPaneId;
}

export function resetPaneService(): void {
  usePaneStore.getState().reset();
}

export function usePaneActions(): Pick<PaneStoreState, "lastFocusedPaneId"> {
  return usePaneStore((s) => ({ lastFocusedPaneId: s.lastFocusedPaneId }));
}
