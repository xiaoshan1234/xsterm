import { invoke } from "@tauri-apps/api/core";
import { TmuxSessionConfig } from "../types/session";
import { SessionInfo } from "./sessionService";

export interface TmuxPaneOutput {
  paneId: string;
  data: number[];
}

export interface TmuxControlEventWrapper {
  type: string;
  [key: string]: unknown;
}

export async function createTmux(config: TmuxSessionConfig): Promise<SessionInfo> {
  return invoke<SessionInfo>("create_tmux_session", { config });
}

export async function writeTmuxCommand(sessionId: number, command: string): Promise<void> {
  await invoke("write_tmux_command", { sessionId, command });
}

export async function resizeTmuxPane(
  sessionId: number,
  paneId: string,
  rows: number,
  cols: number
): Promise<void> {
  await invoke("resize_tmux_pane", { sessionId, paneId, rows, cols });
}

export async function sendKeysToTmuxPane(
  sessionId: number,
  paneId: string,
  keys: string
): Promise<void> {
  await invoke("send_keys_to_tmux_pane", { sessionId, paneId, keys });
}

export async function createTmuxWindow(sessionId: number, name?: string): Promise<void> {
  const command = name ? `new-window -n "${name.replace(/"/g, '\\"')}"\n` : "new-window\n";
  await writeTmuxCommand(sessionId, command);
}

export async function closeTmuxWindow(sessionId: number, windowId: string): Promise<void> {
  await writeTmuxCommand(sessionId, `kill-window -t ${windowId}\n`);
}

export async function closeTmuxPane(sessionId: number, paneId: string): Promise<void> {
  await writeTmuxCommand(sessionId, `kill-pane -t ${paneId}\n`);
}

export async function renameTmuxWindow(
  sessionId: number,
  windowId: string,
  name: string
): Promise<void> {
  await writeTmuxCommand(
    sessionId,
    `rename-window -t ${windowId} "${name.replace(/"/g, '\\"')}"\n`
  );
}

export async function attachTmuxSession(
  config: TmuxSessionConfig & { target: string }
): Promise<SessionInfo> {
  return createTmux({ ...config, command: "attach-session" });
}
