// L2 ↔ L1 IPC 序列化形状。
// 与 `src/domain/` 的区别:`domain/` 是业务纯类型;此处是协议层关注点。

import type { SessionId } from "../domain/session";
import type { ShellKind } from "../domain/shell";

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

// M1 沿用 M0 wire format:`Vec<u8>` → `number[]`。
// M2 起会演化为 `{ id, data }`,见 ARCHITECTURE §5.2。
export type TerminalDataPayload = number[];
