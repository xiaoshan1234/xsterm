import type { SessionInfo } from "./session";

/**
 * Initial-state payloads returned synchronously by tmux IPC commands.
 *
 * The IA contract: every tmux controller's initial state is delivered in a
 * single round-trip:
 * - `TmuxSessionInit.session` — the bootstrap pane's `SessionInfo`.
 * - `TmuxSessionInit.windows` — all n tmux windows on the server at
 *   creation/attach time, keyed by `tmuxWindowId`.
 * - `TmuxSessionInit.panes` — all m tmux panes (including the bootstrap
 *   pane — same id as `session.id`). Each carries a pre-allocated
 *   `sessionId` so the frontend builds 1:1 Session rows for every pane.
 * - `TmuxSessionInit.controlWindow` — per-controller "session/window
 *   control" surface (ADR 0009 §2.1). Frontend creates exactly one
 *   `TmuxControlWindow`.
 *
 * After this initial state is delivered, subsequent panes / windows
 * (created via user-driven `split-window` / `new-window`) still come
 * through the `TmuxPaneAddedEvent` / `TmuxWindowAddedEvent` async
 * events — those are unaffected.
 */
export interface TmuxSessionInit {
  session: SessionInfo;
  windows: TmuxWindowInit[];
  panes: TmuxPaneInit[];
  controlWindow: TmuxControlWindowInit;
}

export interface TmuxWindowInit {
  /** tmux server-side window id (e.g. `"@5"`). */
  tmuxWindowId: string;
  /** Tab-bar label. */
  name: string;
  /** Currently-active window. */
  active: boolean;
  /** `tmux list-windows` layout string (informational; not parsed). */
  layout: string;
}

export interface TmuxPaneInit {
  /** Pre-allocated Session.id — 1:1 with a Session row the frontend builds. */
  sessionId: number;
  /** tmux server-side pane id (e.g. `"%5"`). */
  tmuxPaneId: string;
  /** Owning tmux window id. */
  tmuxWindowId: string;
  /** Currently-active pane. */
  active: boolean;
  width: number;
  height: number;
  title: string;
  cwd: string;
}

export interface TmuxControlWindowInit {
  /** Owning tmux controller id (u32). */
  tmuxControllerId: number;
  /** Display name for the tab (e.g. `"tmux-7"`). */
  name: string;
}

/**
 * One row of the `auto_attach_tmux_servers` Tauri command response.
 * Each entry is a unified object: `info` is populated on success,
 `error` on failure (never both).
 */
export interface AutoAttachOutcome {
  /** Stable key (`<session_name>::<socket_name>`) for matching back to the persisted entry. */
  sessionKey: string;
  /** Set on a successful re-attach — carries the full initial state. */
  info?: TmuxSessionInit;
  /** Set on a failed re-attach. */
  error?: string;
}
