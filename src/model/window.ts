/**
 * Window schema.
 *
 * `Window` is a discriminated union of the three runtime window kinds.
 * The persisted snapshot (`SavedWindow` / `SavedWindowConfig`) lives in
 * `./persistence.ts` alongside the other persisted shapes — frozen
 * pane trees and missing `activePaneId` / tmux handles.
 *
 * Common fields on every runtime window kind: `id` (frontend-local
 * uuid), `name` (tab-bar label), `kind` (discriminator), `activePaneId`
 * (currently-focused pane or `null` for empty windows).
 *
 * Persisted pane trees (`SavedPaneNode` etc.) live in `./pane.ts`
 * alongside their runtime counterparts.
 */

import type { PaneNode } from "./pane";
import type { TmuxTerminalBackend } from "./tmux-handles";

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
