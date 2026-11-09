import {
  type SshConfigDto,
  type TerminalInfoDto,
} from "../../terminal/infrastructure/tauriContracts";
import { type BackendTerminalHandle } from "../../terminal/infrastructure/handles";
import { type BackendControllerHandle, type BackendWindowHandle } from "./handles";

export interface TmuxSessionConfigDto {
  name?: string;
  tmuxSessionName?: string;
  socketName?: string;
  startCommand?: string;
  envConfig?: {
    env?: Record<string, string>;
  };
  initialRows?: number;
  initialCols?: number;
  ssh?: SshConfigDto;
  baseConfigId?: string;
}

export interface AttachedTmuxServerDto {
  sessionName: string;
  socketName?: string;
  attachedAt: number;
}

export interface AutoAttachOutcomeDto {
  sessionKey: string;
  info?: TerminalInfoDto;
  error?: string;
}

export interface TmuxControllerExitedEvent {
  controllerHandle: BackendControllerHandle;
  reason?: string;
}

export interface TmuxPaneAddedEvent {
  controllerHandle: BackendControllerHandle;
  terminalHandle: BackendTerminalHandle;
  tmuxPaneId: string;
  parentTmuxWindowId: string;
}

export interface TmuxPaneRemovedEvent {
  controllerHandle: BackendControllerHandle;
  terminalHandle: BackendTerminalHandle;
  tmuxPaneId: string;
}

export interface TmuxWindowAddedEvent {
  controllerHandle: BackendControllerHandle;
  tmuxWindowId: string;
  backendWindowHandle: BackendWindowHandle;
  terminalHandle: BackendTerminalHandle;
  tmuxPaneId: string;
  name: string;
}

export interface TmuxWindowClosedEvent {
  controllerHandle: BackendControllerHandle;
  tmuxWindowId: string;
  backendWindowHandle: BackendWindowHandle;
}

export interface TmuxWindowRenamedEvent {
  controllerHandle: BackendControllerHandle;
  tmuxWindowId: string;
  backendWindowHandle: BackendWindowHandle;
  name: string;
}

export interface TmuxPanePausedEvent {
  tmuxPaneId: string;
}
