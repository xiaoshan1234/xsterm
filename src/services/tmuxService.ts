import { invoke } from "@tauri-apps/api/core";
import { TmuxSessionConfig, SshTmuxSessionConfig } from "../types/tmux";
import { logger } from "../contexts/LoggerContext";
import { SessionInfo } from "./sessionService";

/**
 * Raw pane output delivered by the Rust backend.
 */
export interface TmuxPaneOutput {
  paneId: string;
  data: number[];
}

/**
 * Generic wrapper around a tmux control-mode event payload.
 */
export interface TmuxControlEventWrapper {
  type: string;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Escape double quotes in a value so it can be safely embedded in a tmux
 * command string.
 */
export function quoteTmuxString(value: string): string {
  return value.replace(/"/g, '\\"');
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Create a new local tmux control-mode session.
 */
export async function createTmux(config: TmuxSessionConfig): Promise<SessionInfo> {
  logger.debug("tmuxService", "createTmux", { config });
  const result = await invoke<SessionInfo>("create_tmux_session", { config });
  logger.debug("tmuxService", "createTmux:result", result);
  return result;
}

/**
 * Create a new SSH tmux control-mode session.
 */
export async function createSshTmuxSession(config: SshTmuxSessionConfig): Promise<SessionInfo> {
  logger.debug("tmuxService", "createSshTmuxSession", { config });
  const result = await invoke<SessionInfo>("create_ssh_tmux_session", { config });
  logger.debug("tmuxService", "createSshTmuxSession:result", result);
  return result;
}

/**
 * Attach to an existing tmux session by target name.
 */
export async function attachTmuxSession(
  config: TmuxSessionConfig & { target: string }
): Promise<SessionInfo> {
  logger.debug("tmuxService", "attachTmuxSession", { config });
  const result = await createTmux({ ...config, command: "attach-session" });
  logger.debug("tmuxService", "attachTmuxSession:result", result);
  return result;
}

/* -------------------------------------------------------------------------- */
/* Window / pane management                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Create a new tmux window, optionally with a custom name.
 */
export async function createTmuxWindow(sessionId: number, name?: string): Promise<void> {
  logger.debug("tmuxService", "createTmuxWindow", { sessionId, name });
  const command = name ? `new-window -n "${quoteTmuxString(name)}"\n` : "new-window\n";
  await writeTmuxCommand(sessionId, command);
  logger.debug("tmuxService", "createTmuxWindow:result", undefined);
}

/**
 * Close a tmux window by id.
 */
export async function closeTmuxWindow(sessionId: number, windowId: string): Promise<void> {
  logger.debug("tmuxService", "closeTmuxWindow", { sessionId, windowId });
  await writeTmuxCommand(sessionId, `kill-window -t ${windowId}\n`);
  logger.debug("tmuxService", "closeTmuxWindow:result", undefined);
}

/**
 * Close a tmux pane by id.
 */
export async function closeTmuxPane(sessionId: number, paneId: string): Promise<void> {
  logger.debug("tmuxService", "closeTmuxPane", { sessionId, paneId });
  await writeTmuxCommand(sessionId, `kill-pane -t ${paneId}\n`);
  logger.debug("tmuxService", "closeTmuxPane:result", undefined);
}

/**
 * Rename a tmux window.
 */
export async function renameTmuxWindow(
  sessionId: number,
  windowId: string,
  name: string
): Promise<void> {
  logger.debug("tmuxService", "renameTmuxWindow", { sessionId, windowId, name });
  await writeTmuxCommand(
    sessionId,
    `rename-window -t ${windowId} "${quoteTmuxString(name)}"\n`
  );
  logger.debug("tmuxService", "renameTmuxWindow:result", undefined);
}

/**
 * Split a tmux pane horizontally or vertically.
 */
export async function splitTmuxPane(
  sessionId: number,
  paneId: string,
  direction: "h" | "v" = "h"
): Promise<void> {
  logger.debug("tmuxService", "splitTmuxPane", { sessionId, paneId, direction });
  const flag = direction === "h" ? "-h" : "-v";
  await writeTmuxCommand(sessionId, `split-window ${flag} -t ${paneId}\n`);
  logger.debug("tmuxService", "splitTmuxPane:result", undefined);
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Request a tab-separated list of all tmux sessions.
 */
export async function listSessions(sessionId: number): Promise<void> {
  logger.debug("tmuxService", "listSessions", { sessionId });
  await writeTmuxCommand(sessionId, "list-sessions -F '#{session_id}\t#{session_name}'\n");
  logger.debug("tmuxService", "listSessions:result", undefined);
}

/**
 * Request a tab-separated list of windows for a given tmux session.
 */
export async function listWindows(sessionId: number, tmuxSessionId: string): Promise<void> {
  logger.debug("tmuxService", "listWindows", { sessionId, tmuxSessionId });
  const command =
    `list-windows -t ${tmuxSessionId} -F '#{session_id}\t#{window_id}\t#{window_active}\t#{window_layout}\t#{window_name}'\n`;
  await writeTmuxCommand(sessionId, command);
  logger.debug("tmuxService", "listWindows:result", undefined);
}

/**
 * Request a tab-separated list of panes for a given tmux window.
 */
export async function listPanes(sessionId: number, windowId: string): Promise<void> {
  logger.debug("tmuxService", "listPanes", { sessionId, windowId });
  const command =
    `list-panes -t ${windowId} -F '#{session_id}\t#{window_id}\t#{pane_id}\t#{pane_active}\t#{pane_width}\t#{pane_height}\t#{pane_title}'\n`;
  await writeTmuxCommand(sessionId, command);
  logger.debug("tmuxService", "listPanes:result", undefined);
}

/* -------------------------------------------------------------------------- */
/* Low-level commands                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Write a raw command string to the tmux control-mode stdin.
 */
export async function writeTmuxCommand(sessionId: number, command: string): Promise<void> {
  logger.debug("tmuxService", "writeTmuxCommand", { sessionId, command });
  await invoke("write_tmux_command", { sessionId, command });
  logger.debug("tmuxService", "writeTmuxCommand:result", undefined);
}

/**
 * Resize a single tmux pane.
 */
export async function resizeTmuxPane(
  sessionId: number,
  paneId: string,
  rows: number,
  cols: number
): Promise<void> {
  logger.debug("tmuxService", "resizeTmuxPane", { sessionId, paneId, rows, cols });
  await invoke("resize_tmux_pane", { sessionId, paneId, rows, cols });
  logger.debug("tmuxService", "resizeTmuxPane:result", undefined);
}

/**
 * Send literal keys to a tmux pane.
 */
export async function sendKeysToTmuxPane(
  sessionId: number,
  paneId: string,
  keys: string
): Promise<void> {
  logger.debug("tmuxService", "sendKeysToTmuxPane", { sessionId, paneId, keys });
  await invoke("send_keys_to_tmux_pane", { sessionId, paneId, keys });
  logger.debug("tmuxService", "sendKeysToTmuxPane:result", undefined);
}

/**
 * Capture the current contents of a tmux pane.
 */
export async function captureTmuxPane(
  sessionId: number,
  paneId: string
): Promise<void> {
  logger.debug("tmuxService", "captureTmuxPane", { sessionId, paneId });
  await invoke("capture_tmux_pane", { sessionId, paneId });
  logger.debug("tmuxService", "captureTmuxPane:result", undefined);
}
