import type { CreatedTerminalRef, LocalTerminalConfig, SshConfig } from "../../launch-config";
import type { PaneSplitDirection } from "./model";
import type { PaneTarget } from "./paneIntents";

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

export interface CreateSshTerminalForWindowRequest {
  workspaceId: string;
  windowId: string;
  config: SshConfig;
  save?: boolean;
}

export interface PaneSessionIntentActions {
  splitPaneWithSavedConfig: (request: SplitPaneWithSavedConfigRequest) => Promise<void>;
  attachSavedConfigToPane: (request: AttachSavedConfigToPaneRequest) => Promise<void>;
  createSavedConfigForWindow: (request: CreateSavedConfigForWindowRequest) => Promise<void>;
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
}
