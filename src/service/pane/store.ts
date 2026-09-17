/**
 * Pane service store — active pane focus + transient pane UI state.
 *
 * **Scope**: the user can have many panes across many windows;
 * the active pane per workspace is tracked inside
 * `Window.activePaneId` (per-window). This store exists for
 * **transient** state that doesn't belong on a `Window` (e.g.
 * drag-and-drop highlights, last-focused pane across workspace
 * switches).
 *
 * Currently this store is mostly empty — the plan calls for
 * `activePaneRef` to back the `setActivePane` action in Commit 4,
 * so the action signature is stable now and the data follows
 * later.
 */
import { create } from "zustand";

export interface PaneStoreState {
  /** ID of the most-recently focused pane across all workspaces. */
  lastFocusedPaneId: string | null;
  setLastFocusedPaneId: (id: string | null) => void;

  /** (workspaceId, windowId, paneId) triple of the most-recently focused pane. */
  lastFocusedPanePath: { workspaceId: string; windowId: string; paneId: string } | null;
  setLastFocusedPanePath: (
    path: { workspaceId: string; windowId: string; paneId: string } | null,
  ) => void;

  reset: () => void;
}

export const usePaneStore = create<PaneStoreState>((set) => ({
  lastFocusedPaneId: null,
  setLastFocusedPaneId: (id) => set({ lastFocusedPaneId: id }),

  lastFocusedPanePath: null,
  setLastFocusedPanePath: (path) => set({ lastFocusedPanePath: path }),

  reset: () => set({ lastFocusedPaneId: null, lastFocusedPanePath: null }),
}));
