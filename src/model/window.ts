/**
 * Window schema.
 *
 * `Window` is a discriminated union of the three runtime window kinds.
 * Common fields (`id`, `name`, `kind`, `activePaneId`, and the
 * tmux-only metadata) live on `WindowBase`; each kind extends it with
 * its own per-kind payload.
 *
 * Persisted snapshot (`SavedWindow`) lives in `./window-config.ts`.
 * Persisted pane tree (`SavedPaneNode`) lives in `./pane.ts`.
 *
 * # Identifier namespaces on a tmux Window
 *
 * The tmux-cc metadata mirrors the same five fields carried on
 * `Session` (see `./session.ts`):
 * - `tmuxControllerId: number` — backend u32; required on every tmux
 *   IPC command.
 * - `tmuxServerWindowId: string` — tmux server-side window id (e.g.
 *   `"@1"`); used for `kill_tmux_window` / `rename_tmux_window`.
 * - `tmuxWindowId: number` — backend-allocated u32; matches the
 *   `xsterm_window_id` that appears in `tmux-window-added` /
 *   `tmux-window-closed` / `tmux-window-renamed` event payloads.
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
  /** --- tmux-cc-only metadata. All `undefined` for non-tmux windows. --- */
  /** Owning tmux controller id (u32). */
  tmuxControllerId?: number;
  /** tmux server-side window id (e.g. `"@1"`). */
  tmuxServerWindowId?: string;
  /** Backend-allocated window id (u32). */
  tmuxWindowId?: number;
  /** `true` for the bootstrap window — the Window renders nothing. */
  isHidden?: boolean;
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
