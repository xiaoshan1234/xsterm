import { invoke } from "@tauri-apps/api/core";
import { type AttachedTmuxServer, type TmuxCcConfig } from "../../../model/entities";
import { logger } from "../../logger/logger";
import type { SessionInfo } from "./sessions";

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
 */
export async function captureTmuxPane(xstermSessionId: number, lines: number): Promise<string> {
  logger.debug("sessionService", "captureTmuxPane", { xstermSessionId, lines });
  const result = await invoke<string>("capture_tmux_pane", {
    xstermSessionId,
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

export async function autoAttachTmuxServers(): Promise<AutoAttachOutcome[]> {
  return invoke<AutoAttachOutcome[]>("auto_attach_tmux_servers");
}

/**
 * split an xsterm session (whose backend is a tmux pane) into two panes.
 *
 * The backend invokes `create_tmux_pane`, which sends `split-window`
 * to the tmux controller, waits for tmux's matching
 * `%window-pane-changed` reply (with a 5 s timeout), and returns the
 * new pane's metadata. The frontend uses the returned
 * `xstermSessionId` to bind the new tmux pane to a new xsterm pane
 * leaf in the PaneTree.
 *
 * Both `controllerId` and `parentXstermSessionId` are **xsterm**
 * identifiers (controller id and `Session.id` from React state) — NOT
 * tmux pane ids (those stay internal to the Rust controller). Mirrors
 * req-006 §4.5.
 */
export async function createTmuxPane(
  controllerId: number,
  parentXstermSessionId: number,
  direction: "horizontal" | "vertical",
): Promise<SessionInfo> {
  logger.debug("sessionService", "createTmuxPane", {
    controllerId,
    parentXstermSessionId,
    direction,
  });
  const result = await invoke<SessionInfo>("create_tmux_pane", {
    controllerId,
    parentXstermSessionId,
    direction,
  });
  logger.debug("sessionService", "createTmuxPane:result", result);
  return result;
}

/**
 * kill the tmux pane backing an xsterm session via `kill-pane`.
 *
 * `xstermSessionId` is the **xsterm** session id (the `Session.id`
 * from React state that was bound to this tmux pane), NOT a tmux pane
 * id and NOT an xsterm pane UUID. The function name reflects the
 * tmux-side effect (`kill-pane`); the parameter name reflects the
 * xsterm-side caller identifier.
 *
 * The backend returns immediately after writing the command to the
 * controller's stdin FIFO; the resulting `%pane-exited` reply drives
 * the `tmux-pane-removed` event which the frontend listener uses to
 * drop the matching `Session` from React state.
 */
export async function killTmuxPane(xstermSessionId: number): Promise<void> {
  logger.debug("sessionService", "killTmuxPane", { xstermSessionId });
  await invoke("kill_tmux_pane", { xstermSessionId });
  logger.debug("sessionService", "killTmuxPane:result", undefined);
}

/**
 * open a new tmux window on the given controller via
 * `new-window`. The backend blocks until tmux confirms via
 * `%window-pane-changed` (Promise coordination, parallel to
 * `createTmuxPane`) and returns the new window's first pane as a
 * `SessionInfo`. The frontend uses the returned `xstermSessionId` /
 * `tmuxWindowId` to build the new xsterm Window and attach the Session
 * to it; the `tmux-window-added` event from the controller's dispatch
 * task is a defensive cross-check (idempotent).
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
 * `xstermWindowId` is the **xsterm** window id (NOT the tmux window
 * id). The frontend looks this up from the `tmux-window-added`
 * event payload when it created the Window.
 */
export async function killTmuxWindow(xstermWindowId: number): Promise<void> {
  logger.debug("sessionService", "killTmuxWindow", { xstermWindowId });
  await invoke("kill_tmux_window", { xstermWindowId });
  logger.debug("sessionService", "killTmuxWindow:result", undefined);
}

/**
 * rename a tmux window via `rename-window`. The backend
 * returns immediately after writing the command to the controller's
 * stdin FIFO; the resulting `%window-renamed` reply drives the
 * `tmux-window-renamed` event which the frontend listener uses to
 * update the matching xsterm Window's `name`.
 *
 * `xstermWindowId` is the **xsterm** window id (NOT the tmux window
 * id). The frontend looks this up from the `tmux-window-added`
 * event payload when it created the Window.
 */
export async function renameTmuxWindow(xstermWindowId: number, name: string): Promise<void> {
  logger.debug("sessionService", "renameTmuxWindow", { xstermWindowId, name });
  await invoke("rename_tmux_window", { xstermWindowId, name });
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
