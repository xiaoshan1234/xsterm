import type { ShellKind } from "./shell";

export type SessionId = number;

export interface SessionInfo {
  id: SessionId;
  shellKind: ShellKind;
  alive: boolean;
}
