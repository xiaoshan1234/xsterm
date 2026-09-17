import { invoke } from "@tauri-apps/api/core";
import {
  type CapabilityFlags,
  type LocalSessionConfig,
  type SSHSessionConfig,
  type Session,
  type SessionType,
  type TmuxCcConfig,
} from "../../../model/entities";
import { logger } from "../../logger/logger";

/**
 * Metadata returned by every session-creating Tauri command
 * (`create_session`, `create_tmux_session`, `attach_tmux_session`,
 * `create_tmux_pane`, `create_tmux_window`). Defines the structural
 * shape used by both local/ssh sessions and tmux-backed sessions —
 * the `tmuxPaneId` / `tmuxControllerId` / `tmuxWindowId` /
 * `xstermWindowId` / `isHidden` fields are populated only for tmux
 * sessions.
 *
 * This type lives in `infra/tauri/commands/sessions.ts` (rather than
 * `model/entities/`) because it is purely the IPC wire shape of the
 * Rust `SessionInfo` struct — there is no business-logic that lives in
 * `model/` for it. Mirrors the original `SessionInfo` exported from
 * `src/services/sessionService.ts` 1:1.
 */
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
  /** tmux window id (e.g. `@1`) the pane belongs to. Surfaced by
   * `create_tmux_session` / `attach_tmux_session` so the frontend can
   * render the matching xsterm Window synchronously on return (the
   * `tmux-window-added` listener does not fire for the bootstrap window). */
  tmuxWindowId?: string;
  /** xsterm window id paired with `tmuxWindowId`. Frontend uses this to
   * construct the matching xsterm Window on `create_tmux_session` /
   * `attach_tmux_session` return. Undefined for non-tmux sessions. */
  xstermWindowId?: number;
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
  await invoke("resize_session", { sessionId: id, rows, cols });
  logger.debug("sessionService", "resizeSession:result", undefined);
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
