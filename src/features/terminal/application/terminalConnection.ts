import { type TerminalConnectionInfo } from "../contracts";
import { type TerminalInfoDto } from "../infrastructure";

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
