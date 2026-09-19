/**
 * Window schema.
 *
 * `Window` is a discriminated union of the three runtime window kinds.
 * Common fields (`id`, `name`, `kind`, `activePaneId`) live on
 * `WindowBase`; each kind extends it with its own per-kind payload.
 *
 * Persisted snapshot (`SavedWindow`) lives in `./window-config.ts`.
 * Persisted pane tree (`SavedPaneNode`) lives in `./pane.ts`.
 */

import type { PaneNode } from "./pane";

export type WindowKind = "terminal" | "tmux-control" | "init";

/** Common fields shared by every runtime window kind. */
export interface WindowBase {
  /** Frontend-local uuid. */
  id: string;
  /** Tab-bar label. */
  name: string;

  kind: WindowKind;
  /** Currently-focused pane; `null` for empty windows. */
  activePaneId: string | null;
}

/** A normal terminal window. */
export interface TerminalWindow extends WindowBase {
  kind: "terminal";
  rootPane: PaneNode;
}

/** Per-controller "session/window control" surface (ADR 0009 §2.1). */
export interface TmuxControlWindow extends WindowBase {
  kind: "tmux-control";
  /** tmux controller id (`TmuxController::controller_id`, u32). */
  tmuxControllerId: number;
  /** tmux session name (e.g. `"work"`); drives the tab label. */
  tmuxSessionName: string;
}

/** Empty placeholder shown in a fresh workspace until a session is attached. */
export interface InitWindow extends WindowBase {
  kind: "init";
}

export type Window = TerminalWindow | TmuxControlWindow | InitWindow;
