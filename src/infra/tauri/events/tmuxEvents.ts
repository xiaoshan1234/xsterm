import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  TmuxPaneAddedEvent,
  TmuxPaneRemovedEvent,
  TmuxWindowAddedEvent,
  TmuxWindowClosedEvent,
  TmuxWindowListEntry,
  TmuxWindowRenamedEvent,
} from "../../../model";

/**
 * Subscribe to `tmux-pane-added`. Fired by the TmuxController dispatch
 * task on `%window-pane-changed`. The frontend listener (in the legacy
 * `useTauriListeners.ts`) is idempotent: if a Session with the same
 * `xstermSessionId` already exists (because the backend's
 * `create_tmux_session` return value populated React state for the
 * bootstrap pane), the listener short-circuits.
 *
 * Mirrors req-006 §4.6.
 */
export function subscribeTmuxPaneAdded(
  handler: (event: TmuxPaneAddedEvent) => void,
): Promise<UnlistenFn> {
  return listen<TmuxPaneAddedEvent>("tmux-pane-added", (e) => handler(e.payload));
}

/**
 * Subscribe to `tmux-pane-removed`. Fired on `%pane-exited` /
 * `%pane-died` (and on a successful `kill_pane` round-trip). The
 * frontend listener drops the matching Session from React state and
 * collapses the corresponding leaf in the pane tree.
 *
 * Mirrors req-006 §4.6.
 */
export function subscribeTmuxPaneRemoved(
  handler: (event: TmuxPaneRemovedEvent) => void,
): Promise<UnlistenFn> {
  return listen<TmuxPaneRemovedEvent>("tmux-pane-removed", (e) => handler(e.payload));
}

/**
 * Subscribe to `tmux-window-added`. Fired when a user-driven
 * `new-window` request resolves. Bootstrap windows do NOT fire this
 * event (the frontend already owns the corresponding xsterm Window).
 *
 * Mirrors req-006 §4.6.
 */
export function subscribeTmuxWindowAdded(
  handler: (event: TmuxWindowAddedEvent) => void,
): Promise<UnlistenFn> {
  return listen<TmuxWindowAddedEvent>("tmux-window-added", (e) => handler(e.payload));
}

/**
 * Subscribe to `tmux-window-closed`. Fired on `%window-close`. The
 * frontend listener finds every Session with `tmuxWindowId ===
 * payload.tmuxWindowId`, drops them from React state, then drops the
 * matching xsterm Window (collapsing the workspace to an init window
 * if it becomes empty).
 *
 * Mirrors req-006 §4.6.
 */
export function subscribeTmuxWindowClosed(
  handler: (event: TmuxWindowClosedEvent) => void,
): Promise<UnlistenFn> {
  return listen<TmuxWindowClosedEvent>("tmux-window-closed", (e) => handler(e.payload));
}

/**
 * Subscribe to `tmux-window-renamed`. Fired on `%window-renamed`. The
 * frontend listener updates the matching xsterm Window's `name`.
 *
 * Mirrors req-006 §4.6.
 */
export function subscribeTmuxWindowRenamed(
  handler: (event: TmuxWindowRenamedEvent) => void,
): Promise<UnlistenFn> {
  return listen<TmuxWindowRenamedEvent>("tmux-window-renamed", (e) => handler(e.payload));
}

/**
 * Subscribe to `tmux-window-list`. The bridge module emits this once
 * per controller after the bootstrap `list-windows` reply. The payload
 * shape is `{ controller_id: number; windows: Array<{ tmux_window_id,
 * xsterm_window_id?, xsterm_session_id?, xsterm_pane_id?, name }> }`.
 *
 * The listener normalises the snake_case Rust payload into the
 * camelCase `TmuxWindowListEntry[]` shape so the rest of the app can
 * speak one dialect. ADR 0009 §2.8 / §2.6.
 */
export interface TmuxWindowListRawEvent {
  controller_id: number;
  windows: Array<{
    tmux_window_id: string;
    xsterm_window_id?: number;
    xsterm_session_id?: number;
    xsterm_pane_id?: string;
    name: string;
  }>;
}

export function subscribeTmuxWindowList(
  handler: (controllerId: number, entries: TmuxWindowListEntry[]) => void,
): Promise<UnlistenFn> {
  return listen<TmuxWindowListRawEvent>("tmux-window-list", (event) => {
    const { controller_id: controllerId, windows: rows } = event.payload;
    const entries: TmuxWindowListEntry[] = rows.map((row) => ({
      tmuxWindowId: row.tmux_window_id,
      xstermWindowId: row.xsterm_window_id ?? 0,
      xstermSessionId: row.xsterm_session_id,
      xstermPaneId: row.xsterm_pane_id,
      name: row.name,
    }));
    handler(controllerId, entries);
  });
}

/**
 * Subscribe to `tmux-controller-exit`. Fired when the underlying
 * `tmux -CC` child terminates. The frontend listener drops every
 * frontend Session bound to the controller from React state, then
 * surfaces a retry banner by pushing into `tmuxControllerErrors`.
 *
 * ADR 0009 §2.7.
 */
export interface TmuxControllerExitEvent {
  controllerId: number;
  reason?: string;
}

export function subscribeTmuxControllerExit(
  handler: (event: TmuxControllerExitEvent) => void,
): Promise<UnlistenFn> {
  return listen<TmuxControllerExitEvent>("tmux-controller-exit", (e) => handler(e.payload));
}

/**
 * Subscribe to `session-disconnected`. Fired by the local PTY
 * (`local_session/spawn.rs`) when the reader encounters an EOF or
 * read error. The frontend listener flips the matching Session's
 * `isConnected` to false (but keeps the Session in React state so the
 * user can read the last buffer / inspect the failure).
 */
export function subscribeSessionDisconnected(
  handler: (sessionId: number) => void,
): Promise<UnlistenFn> {
  return listen<number>("session-disconnected", (e) => handler(e.payload));
}

/**
 * Subscribe to `tmux-paused`. Read-only marker from the tmux bridge;
 * logged for diagnostics in the legacy listener. We keep the typed
 * channel so a future iteration can flip a `paused` flag on the
 * Session without re-plumbing the listener.
 */
export function subscribeTmuxPaused(
  handler: (event: { tmuxPaneId: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ tmuxPaneId: string }>("tmux-paused", (e) => handler(e.payload));
}

/**
 * Subscribe to `tmux-continued`. Read-only marker from the tmux
 * bridge; logged for diagnostics in the legacy listener.
 */
export function subscribeTmuxContinued(
  handler: (event: { tmuxPaneId: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ tmuxPaneId: string }>("tmux-continued", (e) => handler(e.payload));
}
