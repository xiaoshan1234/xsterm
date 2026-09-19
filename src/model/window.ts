/**
 * Window schema.
 *
 * A `Window` lives inside a `Workspace` and represents a tab in the
 * workspace's tab bar. Three kinds exist, distinguished by `kind`:
 *
 * - `"terminal"`:     a normal terminal window whose `rootPane` renders
 *                      xterm.js leaves against a backend session.
 * - `"tmux-control"`: the per-controller "session/window control"
 *                      surface (ADR 0009). Tab bar shows it with a
 *                      distinct marker; rendered as `TmuxControlWindowView`
 *                      instead of a pane tree.
 * - `"init"`:         empty placeholder shown in a fresh workspace.
 *                      Rendered as `InitWindowView` until a session
 *                      is attached.
 *
 * Common fields: `id` (frontend-local uuid), `name` (tab-bar label),
 * `kind` (discriminator), `activePaneId` (currently-focused pane or
 * `null` for empty windows).
 */

import type { PaneNode, SplitLayout } from "./pane";
import type { TmuxTerminalBackend } from "./tmux";

export type WindowKind = "terminal" | "tmux-control" | "init";

/** A normal terminal window. May also be a tmux-backed terminal (carries a `tmuxBackend`). */
export interface TerminalWindow {
  kind: "terminal";
  id: string;
  name: string;
  activePaneId: string | null;
  rootPane: PaneNode;
  /**
   * Backend-allocated tmux window handle. Set only when this window was
   * created by `create_tmux_window`.
   */
  tmuxBackend?: TmuxTerminalBackend;
}

/** Per-controller "session/window control" surface (ADR 0009 §2.1). */
export interface TmuxControlWindow {
  kind: "tmux-control";
  id: string;
  name: string;
  activePaneId: string | null;
  /** tmux controller id (`TmuxController::controller_id`, u32). */
  tmuxControllerId: number;
  /** tmux session name (e.g. `"work"`); drives the tab label. */
  tmuxSessionName: string;
}

/** Empty placeholder shown in a fresh workspace until a session is attached. */
export interface InitWindow {
  kind: "init";
  id: string;
  name: string;
  activePaneId: string | null;
}

export type Window = TerminalWindow | TmuxControlWindow | InitWindow;

// ---------------------------------------------------------------------------
// Persisted-window snapshots — separate shape from runtime Window because
// pane trees are frozen and `activePaneId` / tmux handles aren't persisted.

/**
 * Frozen pane tree stored in `SavedWindowConfig`. Mirrors the runtime
 * discriminated union but without the `binding.sessionId` runtime ID —
 * persisted configs only carry `configId` so the runtime can resolve to
 * a fresh session on reload.
 */
export type SavedPaneNode = PaneSavedSplitNode | PaneSavedLeafNode;

export interface PaneSavedSplitNode {
  id: string;
  kind: "split";
  size: number;
  layout: SplitLayout;
}

export interface PaneSavedLeafNode {
  id: string;
  kind: "leaf";
  size: number;
  /** Undefined for an init placeholder pane. */
  binding?: { configId: string };
}

export interface SavedWindow {
  id: string;
  name: string;
  rootPane: SavedPaneNode;
}

export type SavedWindowConfig = SavedWindow;
