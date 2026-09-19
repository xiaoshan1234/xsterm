/**
 * Tmux IPC event payloads and runtime metadata.
 *
 * The five `*Event` interfaces mirror the payloads emitted by the
 * backend `TmuxController` dispatch task in response to tmux control
 * mode replies. The other two interfaces — `TmuxControllerError`,
 * `AttachedTmuxServer`, `TmuxWindowListEntry` — are runtime metadata
 * the frontend tracks alongside open tmux controllers.
 *
 * For the backend-side window / session references themselves, see
 * `./tmux-handles.ts`.
 */

/**
 * Payload of the `tmux-pane-added` event emitted by the
 * `TmuxController` dispatch task on `%window-pane-changed`.
 *
 * The frontend listener in `useTauriListeners.ts` is idempotent: if a
 * `Session` with the same `xstermSessionId` already exists (because
 * the backend's `create_tmux_session` return value populated React
 * state for the bootstrap pane), the listener short-circuits. This
 * means the same payload shape covers BOTH the bootstrap pane and
 * user-driven split panes; only the listener's behavior differs.
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxPaneAddedEvent {
  controllerId: number;
  tmuxPaneId: string;
  /** Backend-allocated xsterm session id. */
  xstermSessionId: number;
  /** tmux server-side window id this pane belongs to. */
  parentTmuxWindowId: string;
}

/**
 * Payload of the `tmux-pane-removed` event emitted by the
 * `TmuxController` dispatch task on `%pane-exited` / `%pane-died`
 * (and on a successful `kill_pane` round-trip). The frontend listener
 * drops the matching `Session` from React state and collapses the
 * corresponding leaf in the pane tree.
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxPaneRemovedEvent {
  controllerId: number;
  tmuxPaneId: string;
  /** Backend-allocated xsterm session id. */
  xstermSessionId: number;
}

/**
 * Payload of the `tmux-window-added` event emitted by the
 * `TmuxController` dispatch task when a user-driven `new-window`
 * request resolves. The frontend listener creates a new xsterm Window
 * in the same workspace as the controller's other panes (if any) and
 * attaches the Session to it. Bootstrap windows do NOT fire this
 * event (the frontend already owns the corresponding xsterm Window).
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxWindowAddedEvent {
  controllerId: number;
  /** tmux server-side window id (e.g. `"@1"`). */
  tmuxServerWindowId: string;
  /** Backend-allocated window id (u32). */
  tmuxWindowId: number;
  /** Backend-allocated xsterm session id of this window's first pane. */
  xstermSessionId: number;
  /** tmux pane id of this window's first pane. */
  xstermPaneId: string;
}

/**
 * Payload of the `tmux-window-closed` event emitted by the
 * `TmuxController` dispatch task on `%window-close`. The frontend
 * listener finds every Session with `tmuxWindowId === payload.tmuxWindowId`,
 * drops them from React state, then drops the matching xsterm Window
 * (collapsing the workspace to an init window if it becomes empty).
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxWindowClosedEvent {
  controllerId: number;
  /** tmux server-side window id (e.g. `"@1"`). */
  tmuxServerWindowId: string;
  /** Backend-allocated window id (u32). */
  tmuxWindowId: number;
}

/**
 * Payload of the `tmux-window-renamed` event emitted by the
 * `TmuxController` dispatch task on `%window-renamed`. The frontend
 * listener updates the matching xsterm Window's `name`.
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxWindowRenamedEvent {
  controllerId: number;
  /** tmux server-side window id (e.g. `"@1"`). */
  tmuxServerWindowId: string;
  /** Backend-allocated window id (u32). */
  tmuxWindowId: number;
  name: string;
}

/**
 * Held in `useTmuxStore.tmuxControllerErrors` when a tmux controller
 * exits unexpectedly (e.g. tmux died with a `%exit reason` message).
 * Holds the original config so the user can retry via `attachTmux` /
 * `createTmux`.
 */
export interface TmuxControllerError {
  /** The original config the controller was built from. */
  config: import("./session-config").TmuxCcConfig;
  /** Reported reason (the `reason` field from the `tmux-controller-exit` event). */
  reason?: string;
  /** ms epoch when the error was first surfaced. */
  timestamp: number;
}

/**
 * Record of a tmux server the user has attached to (or `create_tmux`'d).
 * Persisted by the backend in `attached_tmux.json`; the frontend reads
 * it at startup to drive the auto-attach flow.
 */
export interface AttachedTmuxServer {
  /** tmux session name (the `-s <name>` arg) — required to re-attach. */
  sessionName: string;
  /** Optional tmux socket name (the `-L <socket>` arg). */
  socketName?: string;
  /** ms epoch when the user last attached / created this server. */
  attachedAt: number;
}

/**
 * One row in the `windows` array of a `tmux-window-list` event
 * payload (ADR 0009 §2.6 / §2.8). Populated by the bridge module
 * `emit_tmux_window_added_for_list` from the bootstrap
 * `list-windows -F #{DEFAULT_WINDOW_LIST_FORMAT}` reply, and
 * incrementally refreshed by the per-window `tmux-window-added` /
 * `tmux-window-closed` / `tmux-window-renamed` events.
 *
 * The frontend's `TmuxWindowsControl` component reads these to render
 * the per-window rename / disconnect / delete actions.
 */
export interface TmuxWindowListEntry {
  /** tmux server-side window id (e.g. `"@1"`). */
  tmuxServerWindowId: string;
  /** Backend-allocated window id (matches `Window.tmuxWindowId`). */
  tmuxWindowId: number;
  /** xsterm session id of the window's first pane, when known. */
  xstermSessionId?: number;
  /** tmux pane id of the window's first pane, when known. */
  tmuxPaneId?: string;
  /** current tmux window name. */
  name: string;
}
