import type { CreatedTerminalRef, LocalTerminalConfig, SshConfig } from "../../launch-config";
import { type PaneSplitDirection } from "./model";

export interface PaneTarget {
  workspaceId: string;
  windowId: string;
  paneId: string;
}

export interface AttachExistingTerminalRequest extends PaneTarget {
  terminalId: number;
}

export interface SplitPaneWithTerminalRequest extends PaneTarget {
  direction: PaneSplitDirection;
  terminalId: number;
  configId?: string;
}

export interface SplitPaneWithSavedConfigRequest extends PaneTarget {
  direction: PaneSplitDirection;
  configId: string;
}

export interface AttachSavedConfigToPaneRequest extends PaneTarget {
  configId: string;
}

export interface CreateSavedConfigForWindowRequest {
  workspaceId: string;
  windowId: string;
  configId: string;
}

export interface CreateLocalTerminalForPaneRequest extends PaneTarget {
  config: LocalTerminalConfig;
  save?: boolean;
}

export interface CreateSshTerminalForPaneRequest extends PaneTarget {
  config: SshConfig;
  save?: boolean;
}

export interface CreateLocalTerminalForWindowRequest {
  workspaceId: string;
  windowId: string;
  config: LocalTerminalConfig;
  save?: boolean;
}

export interface AttachExistingTerminalToWindowRequest {
  workspaceId: string;
  windowId: string;
  terminalId: number;
}

export interface CreateSshTerminalForWindowRequest {
  workspaceId: string;
  windowId: string;
  config: SshConfig;
  save?: boolean;
}

export interface PaneIntentActions {
  attachExistingTerminal: (request: AttachExistingTerminalRequest) => Promise<void>;
  splitPaneWithTerminal: (request: SplitPaneWithTerminalRequest) => Promise<void>;
  splitPaneWithSavedConfig: (request: SplitPaneWithSavedConfigRequest) => Promise<void>;
  attachSavedConfigToPane: (request: AttachSavedConfigToPaneRequest) => Promise<void>;
  createSavedConfigForWindow: (request: CreateSavedConfigForWindowRequest) => Promise<void>;
  attachExistingTerminalToWindow: (request: AttachExistingTerminalToWindowRequest) => Promise<void>;
  createLocalTerminalForPane: (
    request: CreateLocalTerminalForPaneRequest,
  ) => Promise<CreatedTerminalRef>;
  createSshTerminalForPane: (
    request: CreateSshTerminalForPaneRequest,
  ) => Promise<CreatedTerminalRef>;
  createLocalTerminalForWindow: (
    request: CreateLocalTerminalForWindowRequest,
  ) => Promise<CreatedTerminalRef>;
  createSshTerminalForWindow: (
    request: CreateSshTerminalForWindowRequest,
  ) => Promise<CreatedTerminalRef>;
  closePane: (target: PaneTarget) => Promise<void>;
  closeTerminal: (terminalId: number) => Promise<void>;
  createTmuxWindow: (terminalId: number) => Promise<void>;
  killTmuxWindow: (xstermWindowId: number) => Promise<void>;
  renameTmuxWindow: (xstermWindowId: number, name: string) => Promise<void>;
}
