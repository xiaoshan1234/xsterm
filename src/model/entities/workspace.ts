export type SplitDirection = "horizontal" | "vertical";

export interface PaneNode {
  id: string;
  type: "leaf" | "split";
  direction?: SplitDirection;
  size: number;
  children?: PaneNode[];
  sessionId?: number;
  configId?: string;
}

export interface SavedWindow {
  id: string;
  name: string;
  rootPane: PaneNode;
}

export interface SavedWindowConfig extends SavedWindow {}

export interface SavedWorkspace {
  id: string;
  name: string;
  windows: SavedWindow[];
}

export interface Window {
  id: string;
  name: string;
  rootPane: PaneNode;
  activePaneId: string | null;
  /**
   * Window surface type:
   * - `"terminal"` (default): a normal terminal window whose pane tree
   *   renders xterm.js leaves.
   * - `"init"`: empty placeholder window shown in fresh workspaces;
   *   rendered as `InitWindowView` until the user opens a session.
   * - `"tmux-control"`: a special window that does NOT render any pane
   *   tree. It is the per-controller "session/window control" surface
   *   introduced by ADR 0009 — tab bar shows it with a distinct marker
   *   and `WorkspaceContainer` renders `TmuxControlWindowView` instead
   *   of a `PaneTree`. Identified by `tmuxControlWindowId` (= the
   *   controller id); never carries `xstermWindowId` because the
   *   control window does not correspond to any tmux server-side
   *   window.
   */
  windowType?: "terminal" | "init" | "tmux-control";
  /**
   * backend's xsterm window id (a u32) for tmux-backed windows.
   * Used by the `tmux-window-closed` / `tmux-window-renamed` listeners
   * to find the matching frontend Window. Undefined for non-tmux
   * windows, for tmux bootstrap windows (the bootstrap window's
   * xsterm_window_id is tracked by the backend but not exposed to the
   * frontend, so the bootstrap window cannot be killed via
   * `kill_tmux_window` from the frontend), AND for
   * `windowType === "tmux-control"` windows (those don't map to any
   * tmux server-side window).
   */
  xstermWindowId?: number;
  /**
   * tmux controller id (`TmuxController::controller_id`, u32). Only
   * set when `windowType === "tmux-control"`. Used by the
   * `tmux-window-added` listener and the control-window UI to
   * associate ordinary terminal windows under the same controller and
   * to dispatch kill / rename / new-window commands to the right
   * controller. ADR 0009 §2.1.
   */
  tmuxControlWindowId?: number;
  /**
   * tmux session name (e.g. `"work"`). Only set when
   * `windowType === "tmux-control"`. Drives the tab label and the
   * windows-control section title inside `TmuxControlWindowView`.
   * ADR 0009 §2.1.
   */
  tmuxControlName?: string;
}

export interface Workspace {
  id: string;
  name: string;
  windows: Window[];
  activeWindowId: string | null;
  sessionIds: number[];
  savedWorkspaceId?: string;
}