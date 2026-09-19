/**
 * Backend-side handles for tmux-attached windows and sessions.
 *
 * `TmuxTerminalBackend` is held on `TerminalWindow.tmuxBackend` so the
 * frontend can match incoming `tmux-window-closed` /
 * `tmux-window-renamed` events against the right window.
 *
 * `TmuxSessionBackend` is held on `Session.tmuxBackend` (when the
 * session type is `"tmux-cc"`). It carries the controller id plus two
 * `Map<number, string>` lookups that translate the backend's xsterm
 * (u32) window / pane ids to the tmux server-side ids (`"@N"` /
 * `"%N"`). The maps exist because a tmux-cc session can be split into
 * multiple panes — each pane has its own xsterm pane id and tmux
 * pane id, all owned by the same session.
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
 * Handle attached to a `Session` of type `"tmux-cc"`.
 *
 * Tracks every pane (and window) this session is currently visible in.
 * A single session can be split into multiple panes — each pane has
 * its own (xsterm pane id, tmux pane id) pair, all mapped here.
 */
export interface TmuxSessionBackend {
  /** Owning tmux controller id (u32). */
  tmuxControllerId: number;
  /** `true` for the bootstrap pane; UI renders nothing for it. */
  isHidden?: boolean;
  /** Backend-allocated xsterm window id → tmux server-side window id. */
  xsWindowToTmuxWindow: Map<number, string>;
  /** Backend-allocated xsterm pane id → tmux server-side pane id. */
  xsPaneToTmuxPane: Map<number, string>;
}
