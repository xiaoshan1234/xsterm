import {
  type TerminalCapabilitiesDto,
  type TerminalInfoDto,
  type TerminalKindDto,
} from "../infrastructure";

export interface TerminalConnectionInfo {
  id: number;
  name: string;
  kind: TerminalKindDto;
  isConnected: boolean;
  capabilities: TerminalCapabilitiesDto;
  tmuxWindowId?: string;
  tmuxSessionName?: string;
  isHidden?: boolean;
}

export function toTerminalConnectionInfo(info: TerminalInfoDto): TerminalConnectionInfo {
  return {
    id: Number(info.id),
    name: info.name,
    kind: info.kind,
    isConnected: info.isConnected,
    capabilities: info.capabilities,
    ...(info.tmuxWindowId !== undefined ? { tmuxWindowId: info.tmuxWindowId } : {}),
    ...(info.tmuxSessionName !== undefined ? { tmuxSessionName: info.tmuxSessionName } : {}),
    ...(info.isHidden !== undefined ? { isHidden: info.isHidden } : {}),
  };
}
