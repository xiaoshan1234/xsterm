/**
 * Tmux IPC event payloads and runtime metadata.
 *
 * The five `*Event` interfaces mirror the payloads emitted by the
 * backend `TmuxController` dispatch task in response to tmux control
 * mode replies. The other three interfaces — `TmuxControllerError`,
 * `AttachedTmuxServer`, `TmuxWindowListEntry` — are runtime metadata
 * the frontend tracks alongside open tmux controllers.
 *
 * Wire payloads use snake_case field names that match the Rust
 * `json!` payloads emitted by `TmuxBridge` in
 * `src-tauri/src/services/tmux_session/bridge/mod.rs`. Internal UI
 * types (e.g. `TmuxWindowListEntry`, fields on `Session` / `Window`)
 * use camelCase and live in the rest of `model/`.
 *
 * Identifier convention used across these payloads (after Rust commit
 * `2871e76 refactor tmux controller to replace xsterm_id with
 * session_id`):
 * - `tmux_window_id: string` — tmux server-side window id (e.g.
 *   `"@1"`). The single window identity on the wire (no parallel
 *   backend u32). Used for `kill_tmux_window` / `rename_tmux_window`
 *   IPC and for matching the event to the right xsterm Window.
 * - `tmux_pane_id: string` — server-side pane id (e.g. `"%5"`).
 *   Used for `kill_tmux_pane` / `capture_tmux_pane` / `resize_tmux_pane`
 *   IPC and for matching the event to the right xsterm Session.
 * - `session_id: number` — backend u32 (`Session.id`) of the
 *   session a pane belongs to; primary key for `session-output` /
 *   `session-closed` events.
 *
 * For the Session/Window shapes that hold these fields at rest, see
 * `./session.ts` and `./window.ts`. The `{ isHidden }` marker carried
 * on bootstrap panes lives in `./tmux-handles.ts`.
 */

/**
 * Payload of the `tmux-pane-added` event emitted by the
 * `TmuxController` dispatch task on `%window-pane-changed`.
 *
 * The frontend listener in `useTauriListeners.ts` is idempotent: if a
 * `Session` with the same `session_id` already exists (because
 * the backend's `create_tmux_session` return value populated React
 * state for the bootstrap pane), the listener short-circuits. This
 * means the same payload shape covers BOTH the bootstrap pane and
 * user-driven split panes; only the listener's behavior differs.
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxPaneAddedEvent {
  tmux_controller_id: number;
  tmux_pane_id: string;
  /** Backend-allocated Session.id (`u32`). */
  session_id: number;
  /** tmux server-side window id this pane belongs to. */
  tmux_window_id?: string;
  /** Always `"tmux-cc"` for bridge-emitted pane-added events. */
  session_type?: string;
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
  controller_id: number;
  tmux_pane_id: string;
  /** Backend-allocated Session.id (`u32`). */
  session_id: number;
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
  tmux_controller_id: number;
  /** tmux server-side window id (e.g. `"@1"`) — the Window identity. */
  tmux_window_id: string;
  /** tmux session name (the `session_name` from `%window-add`). */
  session_name?: string;
  /** Backend-allocated Session.id of this window's first pane. */
  session_id?: number;
  /** tmux pane id of this window's first pane. */
  tmux_pane_id?: string;
}

/**
 * Payload of the `tmux-window-closed` event emitted by the
 * `TmuxController` dispatch task on `%window-close`. The frontend
 * listener finds every Session whose `tmuxServerWindowId` matches,
 * drops them from React state, then drops the matching xsterm Window
 * (collapsing the workspace to an init window if it becomes empty).
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxWindowClosedEvent {
  controller_id: number;
  /** tmux server-side window id (e.g. `"@1"`). */
  tmux_window_id: string;
}

/**
 * Payload of the `tmux-window-renamed` event emitted by the
 * `TmuxController` dispatch task on `%window-renamed`. The frontend
 * listener updates the matching xsterm Window's `name`.
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxWindowRenamedEvent {
  controller_id: number;
  /** tmux server-side window id (e.g. `"@1"`). */
  tmux_window_id: string;
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
 * Internal UI cache entry: one row from the per-controller tmux
 * window list. The bridge emits `tmux-window-list` with raw snake_case
 * rows; `subscribeTmuxWindowList` in `infra/tauri/events/tmuxEvents.ts`
 * normalises them into this camelCase shape so the rest of the app
 * can speak one dialect. The cache is consumed by
 * `TmuxWindowsControl` (rename / disconnect / delete actions) and by
 * the `tmux-window-list` listener in `useTauriListeners.ts` (sync
 * insert of xsterm Windows on attach).
 */
export interface TmuxWindowListEntry {
  /** tmux server-side window id (e.g. `"@1"`) — the Window identity. */
  tmuxServerWindowId: string;
  /** Session.id of the window's first pane, when known. */
  sessionId?: number;
  /** tmux pane id of the window's first pane, when known. */
  tmuxPaneId?: string;
  /** current tmux window name. */
  name: string;
}

/**
 * Raw payload of the `tmux-window-list` event as emitted by the
 * backend bridge module. The frontend listener normalises the
 * snake_case Rust payload into the camelCase `TmuxWindowListEntry[]`
 * shape so the rest of the app can speak one dialect. ADR 0009 §2.8 /
 * §2.6.
 */
export interface TmuxWindowListRawEvent {
  controller_id: number;
  windows: Array<{
    tmux_window_id: string;
    session_id?: number;
    tmux_pane_id?: string;
    name: string;
  }>;
}

/**
 * Payload of the `tmux-controller-exit` event. Fired when the
 * underlying `tmux -CC` child terminates. The frontend listener
 * drops every frontend Session bound to the controller from React
 * state, then surfaces a retry banner by pushing into
 * `tmuxControllerErrors`. ADR 0009 §2.7.
 */
export interface TmuxControllerExitEvent {
  controller_id: number;
  reason?: string;
}
