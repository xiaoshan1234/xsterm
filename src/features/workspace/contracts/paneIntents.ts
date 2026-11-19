import type { PaneId, TerminalId, WindowId, WorkspaceId } from "../../../models";
import { type PaneSplitDirection } from "./model";

export interface PaneTarget {
  workspaceId: WorkspaceId;
  windowId: WindowId;
  paneId: PaneId;
}

export interface AttachExistingTerminalRequest extends PaneTarget {
  terminalId: TerminalId;
}

export interface SplitPaneWithTerminalRequest extends PaneTarget {
  direction: PaneSplitDirection;
  terminalId: TerminalId;
  configId?: string;
}

export interface AttachExistingTerminalToWindowRequest {
  workspaceId: WorkspaceId;
  windowId: WindowId;
  terminalId: TerminalId;
}

export interface PaneIntentActions {
  attachExistingTerminal: (request: AttachExistingTerminalRequest) => Promise<void>;
  splitPaneWithTerminal: (request: SplitPaneWithTerminalRequest) => Promise<void>;
  attachExistingTerminalToWindow: (request: AttachExistingTerminalToWindowRequest) => Promise<void>;
  closePane: (target: PaneTarget) => Promise<void>;
  closeTerminal: (terminalId: TerminalId) => Promise<void>;
}
