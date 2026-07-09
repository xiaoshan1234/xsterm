import { invoke } from "@tauri-apps/api/core";
import { logger } from "../contexts/LoggerContext";

/**
 * Raw pane output delivered by the Rust backend.
 */
export interface TmuxPaneOutput {
  paneId: string;
  data: number[];
}

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Connect or reconnect a tmux underlay session to a target tmux session.
 */
export async function connectTmuxUnderlay(sessionId: number, tmuxSessionName: string): Promise<void> {
  logger.debug("tmuxService", "connectTmuxUnderlay", { sessionId, tmuxSessionName });
  await invoke("connect_tmux_underlay", { sessionId, tmuxSessionName });
  logger.debug("tmuxService", "connectTmuxUnderlay:result", undefined);
}

/**
 * Disconnect a tmux underlay session from its tmux server.
 */
export async function disconnectTmuxUnderlay(sessionId: number): Promise<void> {
  logger.debug("tmuxService", "disconnectTmuxUnderlay", { sessionId });
  await invoke("disconnect_tmux_underlay", { sessionId });
  logger.debug("tmuxService", "disconnectTmuxUnderlay:result", undefined);
}

/* -------------------------------------------------------------------------- */
/* Window / pane management                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Create a new tmux window, optionally with a custom name.
 */
export async function createTmuxWindow(sessionId: number, name?: string): Promise<void> {
  logger.debug("tmuxService", "createTmuxWindow", { sessionId, name });
  await invoke("create_tmux_window", { sessionId, name });
  logger.debug("tmuxService", "createTmuxWindow:result", undefined);
}

/**
 * Close a tmux window by id.
 */
export async function closeTmuxWindow(sessionId: number, windowId: string): Promise<void> {
  logger.debug("tmuxService", "closeTmuxWindow", { sessionId, windowId });
  await invoke("close_tmux_window", { sessionId, windowId });
  logger.debug("tmuxService", "closeTmuxWindow:result", undefined);
}

/**
 * Close a tmux pane by id.
 */
export async function closeTmuxPane(sessionId: number, paneId: string): Promise<void> {
  logger.debug("tmuxService", "closeTmuxPane", { sessionId, paneId });
  await invoke("close_tmux_pane", { sessionId, paneId });
  logger.debug("tmuxService", "closeTmuxPane:result", undefined);
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
  await invoke("split_tmux_pane", { sessionId, paneId, direction });
  logger.debug("tmuxService", "splitTmuxPane:result", undefined);
}

/* -------------------------------------------------------------------------- */
/* Low-level commands                                                         */
/* -------------------------------------------------------------------------- */

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
