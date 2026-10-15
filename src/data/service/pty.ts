// L2 — `invoke`/`listen` 的唯一入口。
// 见 ARCHITECTURE §4 R1。

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { SessionId } from "../model/session";
import type { TerminalDataPayload, ResizeRequest, SpawnRequest, WriteRequest } from "./types";

const COMMAND_SPAWN = "spawn_terminal";
const COMMAND_WRITE = "write_terminal";
const COMMAND_RESIZE = "resize_terminal";
const EVENT_TERMINAL_DATA = "terminal-data";

export async function spawnTerminal(opts: SpawnRequest): Promise<SessionId> {
  return await invoke<SessionId>(COMMAND_SPAWN, opts);
}

export async function writeTerminal(id: SessionId, data: Uint8Array): Promise<void> {
  const payload: WriteRequest = { id, data: Array.from(data) };
  await invoke(COMMAND_WRITE, payload);
}

export async function resizeTerminal(id: SessionId, rows: number, cols: number): Promise<void> {
  const payload: ResizeRequest = { id, rows, cols };
  await invoke(COMMAND_RESIZE, payload);
}

export function onTerminalData(
  handler: (payload: TerminalDataPayload) => void,
): Promise<UnlistenFn> {
  return listen<TerminalDataPayload>(EVENT_TERMINAL_DATA, (event) => {
    handler(event.payload);
  });
}
