import { invoke } from "@tauri-apps/api/core";
import { logger } from "../contexts/LoggerContext";
import {
  type Session,
  type LocalSessionConfig,
  type SSHSessionConfig,
  type SessionType,
} from "../types/session";
import type { CapabilityFlags } from "../types/capabilities";

export interface SessionInfo {
  id: number;
  name: string;
  sessionType: Session["sessionType"];
  isConnected: boolean;
  capabilities?: CapabilityFlags;
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

export async function createLocal(config: LocalSessionConfig): Promise<SessionInfo> {
  return createSession({ type: "local", config });
}

export async function createSsh(config: SSHSessionConfig): Promise<SessionInfo> {
  return createSession({ type: "ssh", config });
}

// Fire-and-forget: do not await. Keystroke writes are rAF-batched
// upstream, so awaiting each IPC would defeat the batching.
export function writeSession(id: number, data: string): Promise<void> {
  const encoded = new TextEncoder().encode(data);
  return invoke("write_session", { sessionId: id, data: encoded }).then(
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
