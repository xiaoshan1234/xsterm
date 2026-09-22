/**
 * Frozen window stored in `SavedWorkspace`. Mirrors `Window` but without
 * runtime-only fields (`activePaneId`, tmux handles).
 */
export interface SavedWindow {
  id: string;
  name: string;
  rootPane: import("./pane").SavedPaneNode;
}

/**
 * Legacy alias for `SavedWindow`. Older code paths (especially
 * `service/legacy/contexts/session/types.ts` and the persistence
 * store) imported `SavedWindowConfig` from `./persistence.ts` /
 * `./window-config.ts`. The current canonical name is `SavedWindow`;
 * this alias preserves the old import surface.
 */
export type SavedWindowConfig = SavedWindow;
