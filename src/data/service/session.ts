// L2 — 会话生命周期命令与事件。
// 见 ARCHITECTURE §4 R1。

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { SessionId } from "../model/session";
import type { CloseSessionRequest, ListSessionsResponse, TerminalExitPayload } from "./types";

const COMMAND_CLOSE = "close_session";
const COMMAND_LIST = "list_sessions";
const EVENT_TERMINAL_EXIT = "terminal-exit";

// 幂等:重复 close 同一 id 不报错(reconnect 流程依赖,见 commands/session.rs)。
export async function closeSession(id: SessionId): Promise<void> {
  const payload: CloseSessionRequest = { id };
  await invoke(COMMAND_CLOSE, payload);
}

export async function listSessions(): Promise<ListSessionsResponse> {
  return await invoke<ListSessionsResponse>(COMMAND_LIST);
}

export function onSessionExit(
  handler: (payload: TerminalExitPayload) => void,
): Promise<UnlistenFn> {
  return listen<TerminalExitPayload>(EVENT_TERMINAL_EXIT, (event) => {
    handler(event.payload);
  });
}
