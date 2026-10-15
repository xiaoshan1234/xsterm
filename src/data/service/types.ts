// L2 ↔ L1 IPC 序列化形状。
// 与 `../model/` 的区别:`model/` 是业务纯类型;此处是协议层关注点。

import type { SessionInfo, SessionId } from "../model/session";
import type { ShellKind } from "../model/shell";

export interface SpawnRequest {
  rows: number;
  cols: number;
  shell: ShellKind;
  [key: string]: unknown;
}

export interface WriteRequest {
  id: SessionId;
  data: number[];
  [key: string]: unknown;
}

export interface ResizeRequest {
  id: SessionId;
  rows: number;
  cols: number;
  [key: string]: unknown;
}

export interface CloseSessionRequest {
  id: SessionId;
  [key: string]: unknown;
}

export type ListSessionsResponse = SessionInfo[];

// M1 wire format: `Vec<u8>` → `number[]`。
// M2 起:`{ id, data }`,前端按 id 分发到对应 pane,见 ARCHITECTURE §5.2。
export interface TerminalDataPayload {
  id: SessionId;
  data: number[];
  [key: string]: unknown;
}

export interface TerminalExitPayload {
  id: SessionId;
  [key: string]: unknown;
}
