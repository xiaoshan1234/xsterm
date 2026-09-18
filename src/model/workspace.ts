/**
 * UI tree types — `App` → `Workspace` → `Window` → `PaneNode`.
 *
 * Every shape here is **data only**. No methods, no derived fields,
 * no callbacks. The lifecycle (PaneTree ops, Workspace mutations,
 * Session bindings) lives in `app/rules/`; backend references
 * (session ids, tmux pane ids, etc.) are abstract ids the model
 * declares — the infra layer decides how to resolve them.
 */

/** Direction of a split. `"horizontal"` = divider is horizontal, panes stacked top↔bottom. */
export type SplitDirection = "horizontal" | "vertical";

/** Side-of-split a pane lives on. `0..1`, sum across siblings equals 1. */
export type PaneSize = number;

/**
 * Optional binding of a leaf pane to a backend session. Separated
 * from the layout so the tree can be re-laid out without touching
 * which session is where (and so a pane can exist without a
 * session — e.g. an init placeholder).
 */
export interface PaneBinding {
  /** Backend session id (`useSessionStore.sessions[]`). */
  sessionId: number;
  /** Saved config id the session was opened from. Empty string for ad-hoc sessions. */
  configId: string;
}

/**
 * Internal layout of a split node: how its children are arranged.
 * Kept separate from `PaneNode` so we can hold the layout
 * reference-stable while renaming or re-binding leaves.
 */
export interface SplitLayout {
  direction: SplitDirection;
  /** Children in display order. Length ≥ 2. */
  children: PaneNode[];
}

/**
 * A node in a window's pane tree.
 *
 * Discriminated by `kind`:
 * - `"split"`: a divider that holds a `SplitLayout`
 * - `"leaf"`:  a terminal pane bound to an optional session
 *
 * `size` is the leaf's share of the parent split, normalised against
 * sibling sizes. Pure splits don't carry their own `size` (the split
 * divides into children, each with their own).
 */
export type PaneNode =
  | (PaneSplitNode & PaneLegacyFields)
  | (PaneLeafNode & PaneLegacyFields);

/**
 * Legacy fields that legacy call-sites read off any PaneNode without
 * narrowing. Each is optional + typed as `unknown` on split nodes,
 * so post-narrowing reads against the leaf/split subtype continue to
 * work as before. New code should narrow first and read the
 * properly-typed fields.
 *
 * @deprecated Use `kind === "leaf" ? binding?.sessionId : undefined`
 *              (or similar narrowing) instead.
 */
export interface PaneLegacyFields {
  /** @deprecated */
  sessionId?: number;
  /** @deprecated */
  configId?: string;
  /** @deprecated */
  direction?: SplitDirection;
  /** @deprecated */
  children?: PaneNode[];
}

export interface PaneSplitNode {
  id: string;
  kind: "split";
  /** Fractional share of the parent split, normalised to siblings. */
  size: PaneSize;
  layout: SplitLayout;
}

export interface PaneLeafNode {
  id: string;
  kind: "leaf";
  /** Fractional share of the parent split. A root leaf uses 1. */
  size: PaneSize;
  /** Undefined for an init placeholder pane. */
  binding?: PaneBinding;
  /**
   * @deprecated Convenience field — `binding?.sessionId` for code that
   * hasn't migrated to read the binding directly. Mirrored by the
   * pane-tree write path (`createLeafPane`) for backwards compat.
   */
  sessionId?: number;
  /**
   * @deprecated Same pattern as `sessionId`. Prefer `binding?.configId`.
   */
  configId?: string;
}

// ---------------------------------------------------------------------------
// Window

/**
 * Identifier of which window surface this is. Three cases live in the
 * `Window` discriminated union — terminal (the normal xterm.js pane
 * tree), tmux-control (the per-controller "session/window control"
 * surface introduced by ADR 0009), and init (empty placeholder
 * rendered as `InitWindowView` until a session is opened).
 */
export type WindowKind = "terminal" | "tmux-control" | "init";

/**
 * Common fields every window carries, regardless of kind.
 * `surface` is the per-kind payload; the rest is shared.
 */
interface WindowBase {
  /** Frontend-local uuid. Stable across renames and reloads. */
  id: string;
  /** Tab-bar label. */
  name: string;
  /** Pane currently focused; `null` while a window has no panes. */
  activePaneId: string | null;
}

/**
 * A normal terminal window: its panes render xterm.js leaves against
 * a backend session. May also be a tmux-backed terminal (carries a
 * `tmuxBackend`) but the surface is still xterm.js panes.
 */
export interface TerminalWindow extends WindowBase {
  kind: "terminal";
  rootPane: PaneNode;
  /**
   * When this window was created by `create_tmux_window`, the
   * backend-assigned window id. `tmux-window-closed` /
   * `tmux-window-renamed` listeners match incoming events against
   * this id to find the matching frontend window.
   */
  tmuxBackend?: TmuxTerminalBackend;
  /**
   * @deprecated Flat mirror of `tmuxBackend.xstermWindowId`. Kept for
   * migration; prefer the nested field.
   */
  xstermWindowId?: number;
  /**
   * @deprecated Old `windowType` discriminator. Use `kind` instead.
   */
  windowType?: "terminal" | "init" | "tmux-control";
}

/**
 * Init placeholder window — empty until the user opens a session.
 *
 * NOTE: `rootPane` lives on the `InitWindow` interface too even though
 * the current implementation never sets it, because legacy call-sites
 * still destructure `window.rootPane` (and treat empty init windows as
 * "no pane tree"). Future commit: tighten this back to `undefined`.
 */
export interface InitWindow extends WindowBase {
  kind: "init";
  rootPane?: PaneNode;
  /**
   * @deprecated Old `windowType` discriminator. Use `kind` instead.
   */
  windowType?: "terminal" | "init" | "tmux-control";
}

/**
 * Per-controller "session/window control" surface (ADR 0009 §2.1).
 * Renders `TmuxControlWindowView` instead of a pane tree.
 */
export interface TmuxControlWindow extends WindowBase {
  kind: "tmux-control";
  /** tmux controller id (`TmuxController::controller_id`, u32). */
  tmuxControllerId: number;
  /** tmux session name (e.g. `"work"`); drives the tab label. */
  tmuxSessionName: string;
  /**
   * @deprecated Same value as `tmuxControllerId`; kept because a
   * number of legacy call-sites still read `window.tmuxControlWindowId`.
   */
  tmuxControlWindowId?: number;
  /**
   * @deprecated Legacy flat field. Control windows do not have a pane tree.
   */
  rootPane?: never;
  /**
   * @deprecated Legacy flat field. Control windows are frontend-only.
   */
  xstermWindowId?: never;
}

/** Backend-side handle for a tmux-backed terminal window. */
export interface TmuxTerminalBackend {
  /** Backend-assigned window id (u32; matches `xstermWindowId` over IPC). */
  xstermWindowId: number;
  /** Owning tmux controller id. */
  tmuxControllerId: number;
}

// --- Legacy Window alias ---
// The legacy `Window` type kept `xstermWindowId` flat and exposed
// `tmuxControlWindowId` on every window. New code should switch to
// the discriminated `Window = TerminalWindow | TmuxControlWindow | InitWindow`,
// but until then we keep the flat fields optional for migration.

export interface WindowLegacyFields {
  /** @deprecated Use `TerminalWindow.xstermWindowId` or `tmuxBackend.xstermWindowId`. */
  xstermWindowId?: number;
  /** @deprecated Use `TmuxControlWindow.tmuxControllerId`. */
  tmuxControlWindowId?: number;
}

export type Window = TerminalWindow | TmuxControlWindow | InitWindow;

// ---------------------------------------------------------------------------
// Workspace

/**
 * A workspace: a tabbed workspace holding an ordered list of
 * `Window`s, exactly one of which is active. Workspace-level
 * metadata (the linked `SavedWorkspace` record, if any) lives on the
 * field `savedWorkspaceId`.
 */
export interface Workspace {
  id: string;
  name: string;
  windows: Window[];
  /** Active window id; `null` while the workspace is empty (transient). */
  activeWindowId: string | null;
  /**
   * @deprecated Derived from the pane tree. Many legacy call-sites
   * still treat `sessionIds` as the source of truth. Kept optional
   * until callers migrate to `collectSessionIdsFromWorkspace`.
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
 * App-wide identity. The user always has exactly one `App`; it holds
 * the list of workspaces and the active selection. Not yet modelled
 * as a separate interface — currently only `Workspace[]` + an
 * active id float in the store. Reserved for a future commit.
 */
export interface App {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

// ---------------------------------------------------------------------------
// Persisted-window snapshots (different shape from runtime Window —
// frozen pane trees, no `activePaneId`, no tmux handles)

export interface SavedPaneNode {
  id: string;
  kind: "split" | "leaf";
  size: PaneSize;
  /** Only on `"split"`. */
  layout?: SplitLayout;
  /** Only on `"leaf"`. */
  binding?: PaneBinding;
}

export interface SavedWindow {
  id: string;
  name: string;
  rootPane: SavedPaneNode;
}

export type SavedWindowConfig = SavedWindow;

export interface SavedWorkspace {
  id: string;
  name: string;
  windows: SavedWindow[];
}