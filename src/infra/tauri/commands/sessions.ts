import { invoke } from "@tauri-apps/api/core";
import {
  type LocalSessionConfig,
  type SSHSessionConfig,
  type SessionInfo,
  type SessionType,
  type TmuxCcConfig,
} from "../../../model";
import { logger } from "../../logger/logger";

export type { SessionInfo };

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
  // call sites that don't have a Session in hand (the `infra`
  // dispatch-by-type variant below is the one used by the live UI).
  await invoke("resize_pty_session", { sessionId: id, rows, cols });
  logger.debug("sessionService", "resizeSession:result", undefined);
}

/**
 * Resize a tmux pane via `resize-pane -t %<pane> -x <cols> -y <rows>`.
 *
 * Symmetric with `kill_tmux_pane` / `capture_tmux_pane`: takes the
 * server-side `(controller_id, tmux_pane_id)` pair, no xsterm session
 * id involved (the frontend resolves the mapping locally from the
 * `tmux-pane-added` event payload).
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
 * `Session.id` (the same one `write_session` / `close_session` use).
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

// `TmuxCcConfig` is re-exported here so consumers of
// `infra/tauri/commands` can import the union config type alongside
// the IPC wrappers without reaching into `model/entities` directly.
export type { TmuxCcConfig };
