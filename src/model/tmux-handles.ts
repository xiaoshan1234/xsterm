/**
 * Backend-side handle for tmux-attached sessions.
 *
 * `TmuxSessionBackend` is held on `Session.tmuxBackend` (when the
 * session type is `"tmux-cc"`). It carries the controller id plus two
 * `Map<number, string>` lookups that translate the backend's xsterm
 * (u32) window / pane ids to the tmux server-side ids (`"@N"` /
 * `"%N"`).
 *
 * # Why two maps (the id-namespace problem)
 *
 * IPC events carry **backend-allocated u32 ids** for windows and
 * panes (`event.tmuxWindowId: number`, `event.xstermSessionId:
 * number`), while tmux's own control-mode protocol emits **string
 * ids** (`"@1"`, `"%5"`). The two namespaces exist because:
 *
 * - **Backend u32 ids are transient** — they are the backend's
 *   in-process counters and change on every backend restart. They
 *   exist to give the IPC wire format a stable fixed-size key.
 * - **Tmux string ids are persistent** within a tmux server lifetime
 *   and survive backend restarts (since the tmux server keeps them).
 *
 * The maps translate between the two — needed whenever an event
 * arrives with a backend u32 but the consumer (e.g. `TmuxControlWindow`,
 * `kill-tmux-window`) needs the tmux-side id to talk back to tmux.
 *
 * # Why maps (not flat fields)
 *
 * A tmux-cc session can be split into multiple panes — each pane has
 * its own (xsterm pane id, tmux pane id) pair, all owned by the same
 * session. Flat fields can't represent N pairs; a map does.
 *
 * # Cost
 *
 * Every IPC event that mentions a window or pane id triggers a
 * map write on the receiving session. The maps grow and shrink
 * with the session's visible panes. Empty when the session is
 * disconnected.
 */

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
