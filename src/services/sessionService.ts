import { invoke } from "@tauri-apps/api/core";
import { Session, LocalSessionConfig, SSHSessionConfig } from "../types/session";

export interface SessionInfo {
  id: number;
  name: string;
  session_type: Session["session_type"];
  is_connected: boolean;
}

export async function createLocal(config: LocalSessionConfig): Promise<SessionInfo> {
  return invoke<SessionInfo>("create_local_session", { config });
}

export async function createSsh(config: SSHSessionConfig): Promise<SessionInfo> {
  return invoke<SessionInfo>("create_ssh_session", { config });
}

export async function writeSession(id: number, data: string): Promise<void> {
  const encoded = new TextEncoder().encode(data);
  const arr = Array.from(encoded);
  await invoke("write_session", { sessionId: id, data: arr });
}

export async function resizeSession(id: number, rows: number, cols: number): Promise<void> {
  await invoke("resize_session", { sessionId: id, rows, cols });
}

export async function closeSession(id: number): Promise<void> {
  await invoke("close_session", { sessionId: id });
}
