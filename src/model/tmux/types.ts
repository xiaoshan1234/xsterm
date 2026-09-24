/**
 * Tmux domain — tmux-specific IPC payloads, runtime metadata, and
 * initial-state shapes.
 *
 * **Scope**
 * - `TmuxSessionBackend` — the legacy `{ isHidden }` marker carried on
 *   bootstrap tmux panes (referenced by `Session.tmuxBackend`).
 * - `TmuxPaneAddedEvent` / `TmuxPaneRemovedEvent` /
 *   `TmuxWindowAddedEvent` / `TmuxWindowClosedEvent` /
 *   `TmuxWindowRenamedEvent` / `TmuxWindowListRawEvent` /
 *   `TmuxControllerExitEvent` — wire payloads emitted by the
 *   backend `TmuxController` dispatch task.
 * - `TmuxControllerError` / `TmuxAttachmentRecord` /
 *   `TmuxWindowListEntry` — runtime metadata the frontend tracks
 *   alongside open tmux controllers.
 * - `TmuxSessionInit` / `TmuxWindowInit` / `TmuxPaneInit` /
 *   `TmuxControlWindowInit` / `AutoAttachOutcome` — synchronous
 *   initial-state payloads returned by tmux IPC commands.
 *
 * **Wire payload convention**: snake_case fields match the Rust
 * `json!` payloads emitted by `TmuxBridge` in
 * `src-tauri/src/services/tmux_session/bridge/mod.rs`. Internal UI
 * types (e.g. `TmuxWindowListEntry`, fields on `Session` / `Window`)
 * use camelCase and live in the rest of `model/`.
 *
 * **Identifier convention** (after Rust commit
 * `2871e76 refactor tmux controller to replace xsterm_id with
 * session_id`):
 * - `tmux_window_id: string` — tmux server-side window id (e.g.
 *   `"@1"`). The single window identity on the wire (no parallel
 *   backend u32). Used for `kill_tmux_window` / `rename_tmux_window`
 *   IPC and for matching the event to the right xsterm Window.
 * - `tmux_pane_id: string` — server-side pane id (e.g. `"%5"`).
 *   Used for `kill_tmux_pane` / `capture_tmux_pane` /
 *   `resize_tmux_pane` IPC and for matching the event to the right
 *   xsterm Session.
 * - `session_id: number` — backend u32 (`Session.id`) of the
 *   session a pane belongs to; primary key for `session-output` /
 *   `session-closed` events.
 */
import type { SessionInfo, TmuxCcConfig } from "../session";

/**
 * Marker shape carried on bootstrap tmux panes. The runtime narrowing
 * goes by `Session.type === "tmux-cc"`; the optional `tmuxBackend`
 * slot on `Session` keeps this object alive for backward compat.
 */
export interface TmuxSessionBackend {
  /** `true` for the bootstrap pane; UI renders nothing for it. */
  isHidden?: boolean;
  /** Owning tmux controller id (u32). Required for every tmux IPC command. */
  tmuxControllerId: number;
  tmuxServerPaneId: string[];
  tmuxServerWindowId: string[];
  localToserverPaneId: Map<string, string>[];
  localToserverWindowId: Map<string, string>[];
  serverTolocalPaneId: Map<string, string>[];
  serverTolocalWindowId: Map<string, string>[];
}

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
  config: TmuxCcConfig;
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
export interface TmuxAttachmentRecord {
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
  /** Currently-isActive window. */
  isActive: boolean;
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
  /** Currently-isActive pane. */
  isActive: boolean;
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
 * `error` on failure (never both).
 */
export interface AutoAttachOutcome {
  /** Stable key (`<session_name>::<socket_name>`) for matching back to the persisted entry. */
  sessionKey: string;
  /** Set on a successful re-attach — carries the full initial state. */
  info?: TmuxSessionInit;
  /** Set on a failed re-attach. */
  error?: string;
}
