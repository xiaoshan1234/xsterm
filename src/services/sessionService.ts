import { invoke } from "@tauri-apps/api/core";
import { logger } from "../contexts/LoggerContext";
import { Session, LocalSessionConfig, SSHSessionConfig } from "../types/session";

export interface SessionInfo {
  id: number;
  name: string;
  session_type: Session["session_type"];
  is_connected: boolean;
}

export async function createLocal(config: LocalSessionConfig): Promise<SessionInfo> {
  logger.debug("sessionService", "createLocal", { config });
  const result = await invoke<SessionInfo>("create_local_session", { config });
  logger.debug("sessionService", "createLocal:result", result);
  return result;
}

export async function createSsh(config: SSHSessionConfig): Promise<SessionInfo> {
  logger.debug("sessionService", "createSsh", { config });
  const result = await invoke<SessionInfo>("create_ssh_session", { config });
  logger.debug("sessionService", "createSsh:result", result);
  return result;
}

export async function writeSession(id: number, data: string): Promise<void> {
  logger.debug("sessionService", "writeSession", { id, data });
  const encoded = new TextEncoder().encode(data);
  const arr = Array.from(encoded);
  await invoke("write_session", { sessionId: id, data: arr });
  logger.debug("sessionService", "writeSession:result", undefined);
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
  data: number[]
): Promise<string> {
  logger.debug("sessionService", "uploadImageToSshSession", { id, filename, dataSize: data.length });
  const result = await invoke<string>("upload_image_to_ssh_session", { sessionId: id, filename, data });
  logger.debug("sessionService", "uploadImageToSshSession:result", result);
  return result;
}
