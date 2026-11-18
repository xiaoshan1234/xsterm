export type PaneSplitDirection = "horizontal" | "vertical";

export interface EditablePaneNode {
  id: string;
  type: "leaf" | "split";
  direction?: PaneSplitDirection;
  size: number;
  children?: EditablePaneNode[];
  terminalId?: number;
  configId?: string;
}

export function createEditableLeafPane(
  id: string,
  size: number,
  terminalId?: number,
  configId?: string,
): EditablePaneNode {
  return {
    id,
    type: "leaf",
    size,
    terminalId,
    configId,
  };
}

export function createEditableSplitNode(
  id: string,
  direction: PaneSplitDirection,
  first: EditablePaneNode,
  second: EditablePaneNode,
): EditablePaneNode {
  return {
    id,
    type: "split",
    direction,
    size: first.size + second.size,
    children: [first, second],
  };
}

export interface SavedWindowConfig {
  id: string;
  name: string;
  rootPane: EditablePaneNode;
}

export interface SavedWorkspace {
  id: string;
  name: string;
  windows: SavedWindowConfig[];
}

export interface Window {
  id: string;
  name: string;
  rootPane: EditablePaneNode;
  activePaneId: string | null;
  windowType?: "terminal" | "init";
  xstermWindowId?: number;
}

export interface Workspace {
  id: string;
  name: string;
  windows: Window[];
  activeWindowId: string | null;
  terminalIds: number[];
  savedWorkspaceId?: string;
}

export interface PaneTerminalRef {
  id: number;
  configId: string;
  name: string;
}

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
    terminal: PaneTerminalRef,
  ) => void;
  closeWindow: (workspaceId: string, windowId: string) => void;
  setActiveWindow: (workspaceId: string, windowId: string) => void;
  splitPane: (
    workspaceId: string,
    windowId: string,
    paneId: string,
    direction: PaneSplitDirection,
    terminalId?: number,
    configId?: string,
  ) => void;
  updateWindowPaneTree: (
    workspaceId: string,
    windowId: string,
    updater: (root: EditablePaneNode) => EditablePaneNode,
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

export interface PaneIntentActions {
  attachExistingTerminal: (request: AttachExistingTerminalRequest) => Promise<void>;
  splitPaneWithTerminal: (request: SplitPaneWithTerminalRequest) => Promise<void>;
  splitPaneWithSavedConfig: (request: SplitPaneWithSavedConfigRequest) => Promise<void>;
  attachSavedConfigToPane: (request: AttachSavedConfigToPaneRequest) => Promise<void>;
  createSavedConfigForWindow: (request: CreateSavedConfigForWindowRequest) => Promise<void>;
  closePane: (target: PaneTarget) => Promise<void>;
  closeTerminal: (terminalId: number) => Promise<void>;
  createTmuxWindow: (terminalId: number) => Promise<void>;
  killTmuxWindow: (xstermWindowId: number) => Promise<void>;
  renameTmuxWindow: (xstermWindowId: number, name: string) => Promise<void>;
}
