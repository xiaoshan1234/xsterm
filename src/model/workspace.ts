/**
 * Workspace schema.
 *
 * A `Workspace` is a tabbed workspace holding an ordered list of
 * `Window`s, exactly one of which is active. The frontend always has
 * exactly one `App`, which holds the list of workspaces and the active
 * selection.
 *
 * `Window` (runtime) lives in `./window.ts`; `SavedWindow` (persisted)
 * and `SavedWorkspace` live here next to `Workspace`.
 */
import type { Window } from "./window";

/** A workspace: a tabbed workspace holding an ordered list of `Window`s. */
export interface Workspace {
  id: string;
  name: string;
  windows: Window[];
  /** Active window id; `null` while the workspace is empty (transient). */
  activeWindowId: string | null;
  /**
   * Id of the `SavedWorkspace` this workspace was loaded from, or
   * `undefined` for an unsaved workspace. Distinct from `id` — the
   * workspace `id` is per-session (changes every boot); the
   * `savedWorkspaceId` is per-record (stable across loads).
   */
  savedWorkspaceId?: string;
}

// ---------------------------------------------------------------------------
// Persisted snapshots.

/**
 * Frozen window stored in `SavedWorkspace`. Mirrors `Window` but without
 * runtime-only fields (`activePaneId`, tmux handles).
 */
export interface SavedWindow {
  id: string;
  name: string;
  rootPane: import("./pane").SavedPaneNode;
}

export interface SavedWorkspace {
  id: string;
  name: string;
  windows: SavedWindow[];
}
