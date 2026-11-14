import { type SshConfigDto } from "../../terminal/infrastructure/tauriContracts";
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
  transport?: "local" | "wsl";
  wslDistribution?: string;
  ssh?: SshConfigDto;
  baseConfigId?: string;
}

export interface AttachedTmuxServerDto {
  sessionName: string;
  socketName?: string;
  transport?: "local" | "wsl";
  wslDistribution?: string;
  attachedAt: number;
}

export interface TmuxControllerExitedEvent {
  controllerHandle: BackendControllerHandle;
  reason?: string;
}

export interface TmuxPaneMetadata {
  windowIndex: number;
  paneIndex: number;
  width: number;
  height: number;
  x: number;
  y: number;
  currentCommand?: string;
  isActive?: boolean;
  windowName?: string;
}

export interface TmuxPaneAddedEvent extends TmuxPaneMetadata {
  controllerHandle: BackendControllerHandle;
  terminalHandle: BackendTerminalHandle;
  tmuxPaneId: string;
  parentTmuxWindowId: string;
  sessionName?: string;
}

export interface TmuxPaneRemovedEvent {
  controllerHandle: BackendControllerHandle;
  terminalHandle: BackendTerminalHandle;
  tmuxPaneId: string;
}

export interface TmuxWindowPaneDto extends TmuxPaneMetadata {
  terminalHandle: BackendTerminalHandle;
  tmuxPaneId: string;
}

export interface TmuxWindowAddedEvent {
  controllerHandle: BackendControllerHandle;
  tmuxWindowId: string;
  backendWindowHandle: BackendWindowHandle;
  name: string;
  sessionName?: string;
  panes: readonly TmuxWindowPaneDto[];
  layout: string;
}

export interface TmuxLayoutChangedEvent {
  controllerHandle: BackendControllerHandle;
  tmuxWindowId: string;
  sessionName?: string;
  panes: readonly TmuxWindowPaneDto[];
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
