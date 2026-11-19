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

export interface AttachExistingTerminalToWindowRequest {
  workspaceId: string;
  windowId: string;
  terminalId: number;
}

export interface PaneIntentActions {
  attachExistingTerminal: (request: AttachExistingTerminalRequest) => Promise<void>;
  splitPaneWithTerminal: (request: SplitPaneWithTerminalRequest) => Promise<void>;
  attachExistingTerminalToWindow: (request: AttachExistingTerminalToWindowRequest) => Promise<void>;
  closePane: (target: PaneTarget) => Promise<void>;
  closeTerminal: (terminalId: number) => Promise<void>;
}
