/**
 * Backend-side handles for tmux-attached windows and sessions.
 *
 * `TmuxTerminalBackend` is held on `TerminalWindow.tmuxBackend` so the
 * frontend can match incoming `tmux-window-closed` /
 * `tmux-window-renamed` events against the right window.
 *
 * `TmuxSessionBackend` is held on `Session.tmuxBackend` (when the
 * session type is `"tmux-cc"`) so the frontend can route UI events
 * back to the right backend pane.
 *
 * Both shapes mirror the backend Rust structs. Identifiers are kept
 * distinct:
 * - `tmuxWindowId: number` is the backend-allocated u32 used over IPC.
 * - `tmuxServerWindowId: string` is the tmux server-side window id
 *   (e.g. `"@1"`); distinct from the u32 above.
 */

/**
 * Handle attached to a `TerminalWindow` when the window was created
 * via `create_tmux_window`.
 */
export interface TmuxTerminalBackend {
  /** Backend-allocated window id (u32). */
  tmuxWindowId: number;
  /** Owning tmux controller id (u32). */
  tmuxControllerId: number;
}

/**
 * Handle attached to a `Session` of type `"tmux-cc"`. Identifies the
 * pane inside the tmux controller and lets the frontend route UI
 * events to the right backend session.
 */
export interface TmuxSessionBackend {
  /** tmux pane id (e.g. `"%5"`). */
  tmuxPaneId: string;
  /** Owning tmux controller id (u32). */
  tmuxControllerId: number;
  /** tmux server-side window id (e.g. `"@1"`). */
  tmuxServerWindowId: string;
  /** Backend-allocated window id (u32). */
  tmuxWindowId: number;
  /** `true` for the bootstrap pane; UI renders nothing for it. */
  isHidden?: boolean;
}
