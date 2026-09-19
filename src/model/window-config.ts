/**
 * Frozen window stored in `SavedWorkspace`. Mirrors `Window` but without
 * runtime-only fields (`activePaneId`, tmux handles).
 */
export interface SavedWindow {
  id: string;
  name: string;
  rootPane: import("./pane").SavedPaneNode;
}
