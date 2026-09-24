/**
 * Workspace domain — runtime UI tree shapes.
 *
 * **Scope**
 * - `Workspace` — tabbed workspace holding an ordered list of `Window`s
 *   plus the active selection.
 * - `App` — singleton root of the frontend state tree (the list of
 *   workspaces plus the active selection).
 *
 * **Out of scope** (sibling domains):
 * - `Window` / `WindowBase` / `TerminalWindow` / `TmuxControlWindow` /
 *   `InitWindow` — runtime window discriminated union, lives in
 *   `../window`.
 * - `PaneNode` / `PaneBinding` / `SavedPaneNode` — pane tree shapes,
 *   live in `../pane`.
 * - `SavedWorkspace` / `SavedWindow` / `SavedSessionConfig` /
 *   `SessionGroup` — on-disk persisted shapes, live in `../persistence`.
 */
import type { Window } from "../window";

/** A workspace: a tabbed workspace holding an ordered list of `Window`s. */
export interface Workspace {
  id: string;
  name: string;
  windows: Window[];
  /** Active window id; `null` while the workspace is empty (transient). */
  activeWindowId: string | null;
  /**
   * Union of session ids attached to panes across every window of this
   * workspace. Optional — populated by `withRecomputedSessionIds` and
   * read by persistence + drag-side window close flows. Derive from
   * pane bindings via `collectSessionIdsFromWorkspace` if absent.
   */
  sessionIds?: number[];
  /**
   * Id of the `SavedWorkspace` this workspace was loaded from, or
   * `undefined` for an unsaved workspace. Distinct from `id` — the
   * workspace `id` is per-session (changes every boot); the
   * `savedWorkspaceId` is per-record (stable across loads).
   */
  savedWorkspaceId?: string;
}

/**
 * App-wide identity.
 *
 * `App` is the singleton root of the frontend state tree: a list of
 * `Workspace`s plus the active selection. It is independent of any
 * single `Workspace` — the user always has exactly one `App`, but a
 * `Workspace` may be created and not yet attached.
 *
 * Lives in the workspace domain (rather than a top-level file) because
 * it only carries workspace list + active selection; the workspace
 * domain is its closest owning surface.
 */
export interface App {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}
