import { createTerminalId, type TerminalId } from "../../../models";
import {
  type TerminalCapabilitiesDto,
  type TerminalInfoDto,
  type TerminalKindDto,
} from "../infrastructure";

export type TerminalConnectionKind =
  | Extract<TerminalKindDto, { type: "local" }>
  | Extract<TerminalKindDto, { type: "ssh" }>
  | Extract<TerminalKindDto, { type: "wsl" }>
  | Extract<TerminalKindDto, { type: "tmux-pane" }>;

export interface TerminalConnectionInfo {
  id: TerminalId;
  name: string;
  kind: TerminalConnectionKind;
  isConnected: boolean;
  capabilities: TerminalCapabilitiesDto;
  tmuxWindowId?: string;
  tmuxSessionName?: string;
  isHidden?: boolean;
}

export function toTerminalConnectionInfo(info: TerminalInfoDto): TerminalConnectionInfo {
  return {
    id: createTerminalId(Number(info.id)),
    name: info.name,
    kind: toTerminalConnectionKind(info.kind),
    isConnected: info.isConnected,
    capabilities: info.capabilities,
    ...(info.tmuxWindowId !== undefined ? { tmuxWindowId: info.tmuxWindowId } : {}),
    ...(info.tmuxSessionName !== undefined ? { tmuxSessionName: info.tmuxSessionName } : {}),
    ...(info.isHidden !== undefined ? { isHidden: info.isHidden } : {}),
  };
}

function toTerminalConnectionKind(kind: TerminalKindDto): TerminalConnectionKind {
  return kind;
}
