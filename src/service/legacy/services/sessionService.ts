// eslint-disable-next-line boundaries/dependencies -- legacy shim: tauri-apps bridge before infra layer existed
import { invoke } from "@tauri-apps/api/core";
import { logger } from "../contexts/LoggerContext";
import {
  type AttachedTmuxServer,
  type Session,
  type LocalSessionConfig,
  type SSHSessionConfig,
  type SessionType,
  type TmuxCcConfig,
} from "../../../model";
import type { CapabilityFlags } from "../../../model/capabilities";

export interface SessionInfo {
  id: number;
  name: string;
  sessionType: Session["sessionType"];
  isConnected: boolean;
  capabilities?: CapabilityFlags;
  /** tmux pane id (`%<N>`) when this session is backed by a tmux pane. */
  tmuxPaneId?: string;
  /** id of the tmux controller process that owns this pane. */
  tmuxControllerId?: number;
  /** tmux server-side window id (e.g. `@1`) the pane belongs to.
   * Surfaced by `create_tmux_session` / `attach_tmux_session` so the
   * frontend can render the matching xsterm Window synchronously on
   * return (the `tmux-window-added` listener does not fire for the
   * bootstrap window). */
  tmuxServerWindowId?: string;
  /**
   * hidden (bootstrap) tmux panes are not rendered by the frontend.
   * MVP `tmux -CC new` panes have `is_hidden = false`; tmux attaches
   * flag the bootstrap pane as hidden.
   */
  isHidden?: boolean;
}

export async function createSession(config: SessionType): Promise<SessionInfo> {
  logger.debug("sessionService", "createSession", { config });
  const result = await invoke<SessionInfo>("create_session", { config });
  logger.debug("sessionService", "createSession:result", result);
  return result;
}

export async function listSessions(): Promise<SessionInfo[]> {
  const result = await invoke<SessionInfo[]>("list_sessions");
  return result;
}

// Called by tests and diagnostics; not yet wired into a UI surface but
// the Rust command has been exposed in the Tauri handler list for a while.
// AGENTS.md mentioned this wrapper was missing — added for completeness.

export async function createLocal(config: LocalSessionConfig): Promise<SessionInfo> {
  return createSession({ type: "local", config });
}

export async function createSsh(config: SSHSessionConfig): Promise<SessionInfo> {
  return createSession({ type: "ssh", config });
}

/**
 * starts a new local tmux control-mode session by invoking
 * `create_tmux_session`. The backend returns a `SessionInfo` whose
 * `sessionType.type === "tmux-cc"`; the frontend builds the corresponding
 * `Session` (with `tmuxPaneId` / `tmuxControllerId`).
 */
export async function createTmux(config: TmuxCcConfig): Promise<SessionInfo> {
  logger.debug("sessionService", "createTmux", { config });
  const result = await invoke<SessionInfo>("create_tmux_session", { config });
  logger.debug("sessionService", "createTmux:result", result);
  return result;
}

/**
 * Probe the tmux server for a session whose name matches
 * `config.tmuxSessionName`. Returns `true` when one already exists,
 * `false` otherwise. SSH is not supported by the backend probe yet
 * (the command returns `Err` for SSH configs); callers should treat
 * the `Err` as "fall back to the previous behaviour".
 *
 * Used by the Create Session dialog to decide between
 * `create_tmux_session` and `attach_tmux_session` — see
 * `doc/ai-terminal-migration/04-tmux-redesign-v0.md`.
 */
export async function probeTmuxSessionExists(config: TmuxCcConfig): Promise<boolean> {
  logger.debug("sessionService", "probeTmuxSessionExists", { config });
  const result = await invoke<boolean>("probe_tmux_session_exists", { config });
  logger.debug("sessionService", "probeTmuxSessionExists:result", result);
  return result;
}

/**
 * Attach to an existing `tmux -CC` server. Implemented as the
 * scrollback / reconnect path; the Tauri command is
 * `attach_tmux_session`. The frontend auto-attach flow (see
 * `useTmuxAutoAttach`) calls this for every entry persisted in
 * `attached_tmux.json`.
 */
export async function attachTmux(config: TmuxCcConfig): Promise<SessionInfo> {
  logger.debug("sessionService", "attachTmux", { config });
  const result = await invoke<SessionInfo>("attach_tmux_session", { config });
  logger.debug("sessionService", "attachTmux:result", result);
  return result;
}

/**
 * capture up to `lines` lines of scrollback from a tmux pane.
 * Frontend use: called once when a tmux pane becomes focused (after a
 * `Pane` mounts) so the user sees existing scrollback before live
 * `session-output` events stream in.
 *
 * `controllerId` + `tmuxPaneId` follow the convention documented in
 * AGENTS.md: the frontend resolves the xsterm session id locally and
 * sends the tmux-side identifiers directly.
 */
export async function captureTmuxPane(
  controllerId: number,
  tmuxPaneId: string,
  lines: number,
): Promise<string> {
  logger.debug("sessionService", "captureTmuxPane", { controllerId, tmuxPaneId, lines });
  const result = await invoke<string>("capture_tmux_pane", {
    controllerId,
    tmuxPaneId,
    lines,
  });
  logger.debug("sessionService", "captureTmuxPane:result", { bytes: result.length });
  return result;
}

/**
 * list every tmux server currently attached to live
 * `TmuxController`s. Mirrors the on-disk `attached_tmux.json` shape.
 */
export async function getAttachedTmuxServers(): Promise<AttachedTmuxServer[]> {
  return invoke<AttachedTmuxServer[]>("get_attached_tmux_servers");
}

/**
 * ask the backend to re-attach every tmux server from the
 * persisted `attached_tmux.json` store. Called once on app startup by
 * `useTmuxAutoAttach`. Each entry is a unified object: `info` is
 * populated on success, `error` on failure (never both).
 */
export interface AutoAttachOutcome {
  /** Stable key (`<session_name>::<socket_name>`) for matching back to the persisted entry. */
  sessionKey: string;
  /** Set on a successful re-attach. */
  info?: SessionInfo;
  /** Set on a failed re-attach. */
  error?: string;
}

export async function autoAttachTmuxServers(): Promise<AutoAttachOutcome[]> {
  return invoke<AutoAttachOutcome[]>("auto_attach_tmux_servers");
}

// Fire-and-forget: do not await. Keystroke writes are rAF-batched in
// Terminal.tsx (Perf 003 in doc/maintenance/perf.md), so awaiting each IPC
// would defeat the batching. Do not add rAF batching here.
export function writeSession(id: number, data: string): Promise<void> {
  const encoded = new TextEncoder().encode(data);
  return invoke("write_session", { sessionId: id, data: encoded }).then(
    () => undefined,
    (e) => {
      console.error("[xsterm] write_session failed:", e);
    },
  );
}

// Fire-and-forget paste chunk write. Used by usePasteBatcher after the
// clipboard payload has been encoded once and split into UTF-8-safe chunks.
// Caller is responsible for pacing; this wrapper stays thin.
export function writeSessionBytes(id: number, data: Uint8Array): Promise<void> {
  return invoke("write_session", { sessionId: id, data }).then(
    () => undefined,
    (e) => {
      console.error("[xsterm] write_session failed:", e);
    },
  );
}

export async function resizeSession(id: number, rows: number, cols: number): Promise<void> {
  logger.debug("sessionService", "resizeSession", { id, rows, cols });
  // Legacy / unknown transport fallback — kept as a safety net for
  // call sites that don't have a Session in hand (the type-dispatching
  // variants below are the ones used by the live UI).
  await invoke("resize_pty_session", { sessionId: id, rows, cols });
  logger.debug("sessionService", "resizeSession:result", undefined);
}

/**
 * Resize a tmux pane via `resize-pane -t %<pane> -x <cols> -y <rows>`.
 *
 * Symmetric with `killTmuxPane` / `captureTmuxPane`: takes the
 * server-side `(controllerId, tmuxPaneId)` pair, no xsterm session id
 * involved.
 */
export async function resizeTmuxPane(
  controllerId: number,
  tmuxPaneId: string,
  rows: number,
  cols: number,
): Promise<void> {
  logger.debug("sessionService", "resizeTmuxPane", { controllerId, tmuxPaneId, rows, cols });
  await invoke("resize_tmux_pane", { controllerId, tmuxPaneId, rows, cols });
  logger.debug("sessionService", "resizeTmuxPane:result", undefined);
}

/**
 * Resize a local PTY session via TIOCSWINSZ ioctl. Takes the universal
 * `Session.id`.
 */
export async function resizePtySession(
  sessionId: number,
  rows: number,
  cols: number,
): Promise<void> {
  logger.debug("sessionService", "resizePtySession", { sessionId, rows, cols });
  await invoke("resize_pty_session", { sessionId, rows, cols });
  logger.debug("sessionService", "resizePtySession:result", undefined);
}

/**
 * Resize an SSH session's exec channel via the russh `window-change`
 * request. Takes the universal `Session.id`.
 */
export async function resizeSshSession(
  sessionId: number,
  rows: number,
  cols: number,
): Promise<void> {
  logger.debug("sessionService", "resizeSshSession", { sessionId, rows, cols });
  await invoke("resize_ssh_session", { sessionId, rows, cols });
  logger.debug("sessionService", "resizeSshSession:result", undefined);
}

export async function closeSession(id: number): Promise<void> {
  logger.debug("sessionService", "closeSession", { id });
  await invoke("close_session", { sessionId: id });
  logger.debug("sessionService", "closeSession:result", undefined);
}

export async function uploadImageToSshSession(
  id: number,
  filename: string,
  data: number[],
): Promise<string> {
  logger.debug("sessionService", "uploadImageToSshSession", {
    id,
    filename,
    dataSize: data.length,
  });
  const result = await invoke<string>("upload_image_to_ssh_session", {
    sessionId: id,
    filename,
    data,
  });
  logger.debug("sessionService", "uploadImageToSshSession:result", result);
  return result;
}

/**
 * split a tmux pane into two panes.
 *
 * The backend invokes `create_tmux_pane`, which sends `split-window`
 * to the tmux controller, waits for tmux's matching
 * `%window-pane-changed` reply (with a 5 s timeout), and returns the
 * new pane's metadata. The frontend uses the returned `id` (the new
 * xsterm session id) to bind the new tmux pane to a new xsterm pane
 * leaf in the PaneTree.
 *
 * `parentTmuxPaneId` is the **server-side** tmux pane id (e.g. `"%5"`)
 * of the parent — NOT an xsterm session id, NOT an xsterm pane UUID.
 * The frontend received this id from the `tmux-pane-added` event
 * payload (which also carries the matching `controllerId`) and tracks
 * it alongside the xsterm pane leaf.
 *
 * The frontend performs the local-id → server-id resolution before
 * invoking this command (xsterm session id ↦
 * `(controller_id, tmux_pane_id)`); the backend does not look up
 * either side via `sessions`. Mirrors req-006 §4.5.
 */
export async function createTmuxPane(
  controllerId: number,
  parentTmuxPaneId: string,
  direction: "horizontal" | "vertical",
): Promise<SessionInfo> {
  logger.debug("sessionService", "createTmuxPane", {
    controllerId,
    parentTmuxPaneId,
    direction,
  });
  const result = await invoke<SessionInfo>("create_tmux_pane", {
    controllerId,
    parentTmuxPaneId,
    direction,
  });
  logger.debug("sessionService", "createTmuxPane:result", result);
  return result;
}

/**
 * kill a tmux pane via `kill-pane`.
 *
 * `controllerId` + `tmuxPaneId` follow the same convention as
 * [`createTmuxPane`](Self::createTmuxPane): the frontend resolves the
 * xsterm session id locally and sends the tmux-side identifiers
 * directly. The backend returns immediately after writing the command
 * to the controller's stdin FIFO; the resulting `%pane-exited` reply
 * drives the `tmux-pane-removed` event which the frontend listener
 * uses to drop the matching `Session` from React state.
 */
export async function killTmuxPane(controllerId: number, tmuxPaneId: string): Promise<void> {
  logger.debug("sessionService", "killTmuxPane", { controllerId, tmuxPaneId });
  await invoke("kill_tmux_pane", { controllerId, tmuxPaneId });
  logger.debug("sessionService", "killTmuxPane:result", undefined);
}

/**
 * open a new tmux window on the given controller via
 * `new-window`. The backend blocks until tmux confirms via
 * `%window-pane-changed` (Promise coordination, parallel to
 * `createTmuxPane`) and returns the new window's first pane as a
 * `SessionInfo`. The frontend uses the returned `id` (xsterm session
 * id) to build the new xsterm Window and attach the Session to it;
 * the `tmux-window-added` event from the controller's dispatch task
 * is a defensive cross-check (idempotent).
 *
 * Mirrors req-006 §4.5.
 */
export async function createTmuxWindow(controllerId: number, name?: string): Promise<SessionInfo> {
  logger.debug("sessionService", "createTmuxWindow", { controllerId, name });
  const result = await invoke<SessionInfo>("create_tmux_window", {
    controllerId,
    name,
  });
  logger.debug("sessionService", "createTmuxWindow:result", result);
  return result;
}

/**
 * kill a tmux window via `kill-window`. The backend returns
 * immediately after writing the command to the controller's stdin FIFO;
 * the resulting `%window-close` reply drives the `tmux-window-closed`
 * event which the frontend listener uses to drop every Session in the
 * matching xsterm Window and then drop the Window itself.
 *
 * `controllerId` + `tmuxWindowId` follow the convention documented in
 * AGENTS.md: the frontend tracks these alongside each xsterm Window —
 * `controllerId` is the same field carried by the
 * `tmux-window-added` / `tmux-window-closed` event payloads, and
 * `tmuxWindowId` is the **server-side** tmux window id (e.g. `"@5"`)
 * also received from the `tmux-window-added` event. The backend
 * dispatches the command directly to that controller; it does not
 * scan every controller's bindings to look them up.
 */
export async function killTmuxWindow(controllerId: number, tmuxWindowId: string): Promise<void> {
  logger.debug("sessionService", "killTmuxWindow", { controllerId, tmuxWindowId });
  await invoke("kill_tmux_window", { controllerId, tmuxWindowId });
  logger.debug("sessionService", "killTmuxWindow:result", undefined);
}

/**
 * rename a tmux window via `rename-window`. The backend
 * returns immediately after writing the command to the controller's
 * stdin FIFO; the resulting `%window-renamed` reply drives the
 * `tmux-window-renamed` event which the frontend listener uses to
 * update the matching xsterm Window's `name`.
 *
 * `controllerId` + `tmuxWindowId` follow the same convention as
 * [`killTmuxWindow`](Self::killTmuxWindow).
 */
export async function renameTmuxWindow(
  controllerId: number,
  tmuxWindowId: string,
  name: string,
): Promise<void> {
  logger.debug("sessionService", "renameTmuxWindow", { controllerId, tmuxWindowId, name });
  await invoke("rename_tmux_window", { controllerId, tmuxWindowId, name });
  logger.debug("sessionService", "renameTmuxWindow:result", undefined);
}

/**
 * Detach the control client for `controllerId` from its tmux session
 * without destroying the server-side session + windows. ADR 0009
 * §2.9 + §2.4 row "Disconnect".
 *
 * The backend writes `detach-client -s "<name>"` to the controller's
 * stdin and removes the controller from the in-memory registry. The
 * tmux child exits naturally; the dispatch task emits
 * `tmux-controller-exit` which the frontend listener uses to drop
 * every `Session` that was bound to this controller and to grey-out
 * the corresponding xsterm windows.
 *
 * Idempotent: unknown `controllerId` returns `Ok(())`.
 */
export async function detachTmux(controllerId: number): Promise<void> {
  logger.debug("sessionService", "detachTmux", { controllerId });
  await invoke("detach_tmux_controller", { controllerId });
  logger.debug("sessionService", "detachTmux:result", undefined);
}

/**
 * Shut down the entire tmux server reachable via `controllerId`
 * (every session, every window, every pane). ADR 0009 §2.9 + §2.4
 * row "Remote delete".
 *
 * The backend writes `kill-server` to the controller's stdin. The
 * tmux child exits because its server is gone; the dispatch task
 * emits `tmux-controller-exit` for the frontend listener.
 *
 * Idempotent: unknown `controllerId` returns `Ok(())`.
 */
export async function killServerViaController(controllerId: number): Promise<void> {
  logger.debug("sessionService", "killServerViaController", { controllerId });
  await invoke("kill_server_via_controller", { controllerId });
  logger.debug("sessionService", "killServerViaController:result", undefined);
}

/**
 * Remove a controller's entry from the persisted `attached_tmux.json`
 * store so the next startup does not auto-attach it. ADR 0009 §2.9 +
 * A9.
 *
 * Called by the frontend's "Close control-window" and "Remote delete"
 * UI paths so the user's explicit teardown does not leave a ghost
 * entry behind for the next session to silently re-attach.
 */
export async function unmarkAttachedTmux(controllerId: number): Promise<void> {
  logger.debug("sessionService", "unmarkAttachedTmux", { controllerId });
  await invoke("unmark_attached_tmux", { controllerId });
  logger.debug("sessionService", "unmarkAttachedTmux:result", undefined);
}
