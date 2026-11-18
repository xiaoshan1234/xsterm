import type { Terminal } from "../../models/runtime/config";
import type { PaneNode, SplitDirection } from "../../models/runtime/pane";
import type {
  SavedWindowConfig,
  SavedWorkspace,
  Window,
  Workspace,
} from "../../models/runtime/workspace";

export interface WorkspaceLayoutContextType {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  savedWorkspaces: SavedWorkspace[];
  savedWindowConfigs: SavedWindowConfig[];
  createWorkspaceFromSession: (terminalId: number, configId: string, name?: string) => Workspace;
  createWindowFromSession: (
    terminalId: number,
    configId: string,
    name?: string,
    targetWorkspaceId?: string,
  ) => Window;
  createWindowFromSavedConfig: (configId: string, name?: string) => Promise<Window>;
  createWindow: (
    workspaceId: string,
    terminalId?: number,
    configId?: string,
    name?: string,
    windowType?: "terminal" | "init",
  ) => Window;
  createDefaultWorkspace: () => Workspace;
  createEmptyWorkspace: () => Workspace;
  createInitWindow: () => Window;
  replaceInitWindowWithTerminal: (
    workspaceId: string,
    windowId: string,
    terminal: Terminal,
  ) => void;
  closeWindow: (workspaceId: string, windowId: string) => void;
  setActiveWindow: (workspaceId: string, windowId: string) => void;
  splitPane: (
    workspaceId: string,
    windowId: string,
    paneId: string,
    direction: SplitDirection,
    terminalId?: number,
    configId?: string,
  ) => void;
  updateWindowPaneTree: (
    workspaceId: string,
    windowId: string,
    updater: (root: PaneNode) => PaneNode,
  ) => void;
  setActivePane: (workspaceId: string, windowId: string, paneId: string) => void;
  setActiveWorkspace: (workspaceId: string) => void;
  saveWorkspace: (workspaceId: string, name: string) => void;
  loadWorkspace: (savedWorkspaceId: string) => Promise<Workspace>;
  closeWorkspace: (workspaceId: string) => void;
  deleteSavedWorkspace: (id: string) => void;
  renameSavedWorkspace: (id: string, name: string) => void;
  saveWindow: (workspaceId: string, windowId: string, name: string) => void;
  saveAllWindows: (workspaceId: string) => void;
  loadWindow: (savedWindowId: string, workspaceId?: string) => Promise<Window>;
  deleteSavedWindow: (id: string) => void;
  renameSavedWindow: (id: string, name: string) => void;
  renameWindow: (workspaceId: string, windowId: string, name: string) => void;
  reorderWindows: (workspaceId: string, fromIndex: number, toIndex: number) => void;
  closePane: (workspaceId: string, windowId: string, paneId: string) => Promise<void>;
}

export interface PaneTarget {
  workspaceId: string;
  windowId: string;
  paneId: string;
}

export interface AttachExistingTerminalRequest extends PaneTarget {
  terminalId: number;
}

export interface SplitPaneWithTerminalRequest extends PaneTarget {
  direction: SplitDirection;
  terminalId: number;
  configId?: string;
}

export interface SplitPaneWithSavedConfigRequest extends PaneTarget {
  direction: SplitDirection;
  configId: string;
}

export interface AttachSavedConfigToPaneRequest extends PaneTarget {
  configId: string;
}

export interface PaneIntentActions {
  attachExistingTerminal: (request: AttachExistingTerminalRequest) => Promise<void>;
  splitPaneWithTerminal: (request: SplitPaneWithTerminalRequest) => Promise<void>;
  splitPaneWithSavedConfig: (request: SplitPaneWithSavedConfigRequest) => Promise<void>;
  attachSavedConfigToPane: (request: AttachSavedConfigToPaneRequest) => Promise<void>;
  closePane: (target: PaneTarget) => Promise<void>;
  closeTerminal: (terminalId: number) => Promise<void>;
  createTmuxWindow: (terminalId: number) => Promise<void>;
  killTmuxWindow: (xstermWindowId: number) => Promise<void>;
  renameTmuxWindow: (xstermWindowId: number, name: string) => Promise<void>;
}
