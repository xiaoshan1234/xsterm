import type { LaunchConfigId, PaneId, TerminalId, WindowId, WorkspaceId } from "../../../models";
import type {
  EditablePaneNode,
  PaneSplitDirection,
  PaneTerminalRef,
  SavedWindowConfig,
  SavedWorkspace,
  Window,
  Workspace,
} from "./model";

export interface WorkspaceLayoutContextType {
  workspaces: Workspace[];
  activeWorkspaceId: WorkspaceId | null;
  savedWorkspaces: SavedWorkspace[];
  savedWindowConfigs: SavedWindowConfig[];
  createWorkspaceFromSession: (
    terminalId: TerminalId,
    configId: string,
    name?: string,
  ) => Workspace;
  createWindowFromSession: (
    terminalId: TerminalId,
    configId: string,
    name?: string,
    targetWorkspaceId?: WorkspaceId,
  ) => Window;
  createWindowFromSavedConfig: (configId: string, name?: string) => Promise<Window>;
  createWindow: (
    workspaceId: WorkspaceId,
    terminalId?: TerminalId,
    configId?: string,
    name?: string,
    windowType?: "terminal" | "init",
  ) => Window;
  createDefaultWorkspace: () => Workspace;
  createEmptyWorkspace: () => Workspace;
  createInitWindow: () => Window;
  replaceInitWindowWithTerminal: (
    workspaceId: WorkspaceId,
    windowId: WindowId,
    terminal: PaneTerminalRef,
  ) => void;
  closeWindow: (workspaceId: WorkspaceId, windowId: WindowId) => void;
  setActiveWindow: (workspaceId: WorkspaceId, windowId: WindowId) => void;
  splitPane: (
    workspaceId: WorkspaceId,
    windowId: WindowId,
    paneId: PaneId,
    direction: PaneSplitDirection,
    terminalId?: TerminalId,
    configId?: string,
  ) => void;
  updateWindowPaneTree: (
    workspaceId: WorkspaceId,
    windowId: WindowId,
    updater: (root: EditablePaneNode) => EditablePaneNode,
  ) => void;
  setActivePane: (workspaceId: WorkspaceId, windowId: WindowId, paneId: PaneId) => void;
  setActiveWorkspace: (workspaceId: WorkspaceId) => void;
  saveWorkspace: (workspaceId: WorkspaceId, name: string) => void;
  loadWorkspace: (savedWorkspaceId: LaunchConfigId) => Promise<Workspace>;
  closeWorkspace: (workspaceId: WorkspaceId) => void;
  deleteSavedWorkspace: (id: LaunchConfigId) => void;
  renameSavedWorkspace: (id: LaunchConfigId, name: string) => void;
  saveWindow: (workspaceId: WorkspaceId, windowId: WindowId, name: string) => void;
  saveAllWindows: (workspaceId: WorkspaceId) => void;
  loadWindow: (savedWindowId: LaunchConfigId, workspaceId?: WorkspaceId) => Promise<Window>;
  deleteSavedWindow: (id: LaunchConfigId) => void;
  renameSavedWindow: (id: LaunchConfigId, name: string) => void;
  renameWindow: (workspaceId: WorkspaceId, windowId: WindowId, name: string) => void;
  reorderWindows: (workspaceId: WorkspaceId, fromIndex: number, toIndex: number) => void;
  closePane: (workspaceId: WorkspaceId, windowId: WindowId, paneId: PaneId) => Promise<void>;
}
