/**
 * Backend-side handle attached to a `Window` of kind `"terminal"` when
 * that window was created via `create_tmux_window`.
 *
 * `tmuxWindowId` is the u32 the backend uses to address the window
 * over IPC; `tmuxControllerId` ties it to the controller. Used by the
 * `tmux-window-closed` / `tmux-window-renamed` listeners to find the
 * matching frontend `Window`.
 */
export interface TmuxTerminalBackend {
  /** Backend-allocated window id (u32). */
  tmuxWindowId: number;
  /** Owning tmux controller id (u32). */
  tmuxControllerId: number;
}

/**
 * Backend-side handle attached to a `Session` of type `"tmux-cc"`.
 * Identifies the pane inside the tmux controller and lets the frontend
 * route UI events to the right backend session.
 *
 * `tmuxPaneId` is the tmux-side pane id (e.g. `"%5"`).
 * `tmuxControllerId` is the controller id.
 * `tmuxServerWindowId` is the tmux-side window id (e.g. `"@1"`).
 * `tmuxWindowId` is the backend-allocated window id (u32).
 */
export interface TmuxSessionBackend {
  tmuxPaneId: string;
  tmuxControllerId: number;
  tmuxServerWindowId: string;
  tmuxWindowId: number;
  isHidden?: boolean;
}

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
  xstermSessionId: number;
  parentTmuxWindowId: string;
}

/**
 * Payload of the `tmux-pane-removed` event emitted by the
 * `TmuxController` dispatch task on `%pane-exited` /
 * `%pane-died` (and on a successful `kill_pane` round-trip). The
 * frontend listener drops the matching `Session` from React state and
 * collapses the corresponding leaf in the pane tree.
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxPaneRemovedEvent {
  controllerId: number;
  tmuxPaneId: string;
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
  tmuxWindowId: string;
  xstermWindowId: number;
  xstermSessionId: number;
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
  tmuxWindowId: string;
  xstermWindowId: number;
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
  tmuxWindowId: string;
  xstermWindowId: number;
  name: string;
}
