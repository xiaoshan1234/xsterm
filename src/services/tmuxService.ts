import { invoke } from "@tauri-apps/api/core";
import { TmuxSessionConfig, SSHSessionConfig } from "../types/session";
import { SessionInfo } from "./sessionService";

export interface TmuxPaneOutput {
  paneId: string;
  data: number[];
}

export interface TmuxControlEventWrapper {
  type: string;
  [key: string]: unknown;
}

export interface SshTmuxSessionConfig {
  ssh?: SSHSessionConfig;
  tmux: TmuxSessionConfig;
}

export function quoteTmuxString(value: string): string {
  return value.replace(/"/g, '\\"');
}

export async function createTmux(config: TmuxSessionConfig): Promise<SessionInfo> {
  return invoke<SessionInfo>("create_tmux_session", { config });
}

export async function createSshTmuxSession(config: SshTmuxSessionConfig): Promise<SessionInfo> {
  return invoke<SessionInfo>("create_ssh_tmux_session", { config });
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

export async function captureTmuxPane(
  sessionId: number,
  paneId: string
): Promise<string[]> {
  return invoke<string[]>("capture_tmux_pane", { sessionId, paneId });
}

export async function createTmuxWindow(sessionId: number, name?: string): Promise<void> {
  const command = name ? `new-window -n "${quoteTmuxString(name)}"\n` : "new-window\n";
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
    `rename-window -t ${windowId} "${quoteTmuxString(name)}"\n`
  );
}

export async function attachTmuxSession(
  config: TmuxSessionConfig & { target: string }
): Promise<SessionInfo> {
  return createTmux({ ...config, command: "attach-session" });
}

export async function listWindows(sessionId: number, tmuxSessionId: string): Promise<void> {
  const command =
    `list-windows -t ${tmuxSessionId} -F '#{session_id}\t#{window_id}\t#{window_active}\t#{window_layout}\t#{window_name}'\n`;
  await writeTmuxCommand(sessionId, command);
}

export async function listSessions(sessionId: number): Promise<void> {
  await writeTmuxCommand(sessionId, "list-sessions -F '#{session_id}\t#{session_name}'\n");
}

export async function listPanes(sessionId: number, windowId: string): Promise<void> {
  const command =
    `list-panes -t ${windowId} -F '#{session_id}\t#{window_id}\t#{pane_id}\t#{pane_active}\t#{pane_width}\t#{pane_height}\t#{pane_title}'\n`;
  await writeTmuxCommand(sessionId, command);
}
