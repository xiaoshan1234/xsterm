import type { ReactNode } from "react";
import type { SavedLaunchConfigsContextType } from "../../../features/launch-config";
import type { LaunchConfigState } from "../../../features/launch-config/composition";
import type { SessionPreferencesContextType } from "../../../features/settings";
import type { TerminalPreferencesState } from "../../../features/settings";
import type { TerminalRuntimeContextType } from "../../../features/terminal";
import type { TerminalSessionState } from "../../../features/terminal/composition";
import type { TmuxRuntimeState } from "../../../features/tmux/composition";
import type { PaneTerminalRef, WorkspaceLayoutContextType } from "../../../features/workspace";
import type { WorkspaceState } from "../../../features/workspace/composition";
import type {
  LocalTerminalConfig,
  SshConfig,
  Terminal,
  TerminalDisplayConfig,
} from "../../../features/terminal";
import type { EditablePaneNode, PaneSplitDirection } from "../../../features/workspace";
import type { SavedTerminalConfig, TerminalGroup } from "../../../features/launch-config";
import type { TmuxSessionConfig } from "../../../features/launch-config";
import type {
  SavedWindowConfig,
  SavedWorkspace,
  Window,
  Workspace,
} from "../../../features/workspace";
export type {
  SavedLaunchConfigsContextType,
  SessionPreferencesContextType,
  TerminalRuntimeContextType,
  WorkspaceLayoutContextType,
};

export interface SessionState {
  launchConfig: LaunchConfigState;
  terminal: TerminalSessionState;
  tmux: TmuxRuntimeState;
  workspace: WorkspaceState;
  preferences: TerminalPreferencesState;
}

export interface SessionPersistence {
  updateConfigs: (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
  updateGroups: (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => void;
  persistSavedWorkspaces: (workspacesData: SavedWorkspace[]) => void;
  persistSavedWindowConfigs: (windowConfigs: SavedWindowConfig[]) => void;
}

export interface SavedLaunchConfigActions {
  saveConfigOnly: (
    type: Terminal["type"],
    config: LocalTerminalConfig | SshConfig | TmuxSessionConfig,
    displayConfig?: TerminalDisplayConfig,
  ) => SavedTerminalConfig;
  removeConfig: (configId: string) => void;
  addToGroup: (groupId: number, configId: string) => void;
  removeFromGroup: (groupId: number, configId: string) => void;
  moveConfigToGroup: (configId: string, groupId: number | null) => void;
  createGroup: (name: string) => void;
  deleteGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  updateConfig: (config: SavedTerminalConfig) => void;
  toggleGroup: (id: number) => void;
}

export interface TerminalRuntimeActions {
  createLocalSession: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSession: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  createLocalSessionOnly: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSessionOnly: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  createTmuxSession: (config: TmuxSessionConfig, save?: boolean) => Promise<Terminal>;
  attachTmuxSession: (config: TmuxSessionConfig, save?: boolean) => Promise<Terminal>;
  detachTmuxSession: (controllerId: number) => Promise<void>;
  reconnectTmuxSession: (controllerId: number) => Promise<Terminal>;
  openFromConfig: (configId: string) => Promise<Terminal>;
  createTerminalFromSavedConfig: (configId: string) => Promise<Terminal>;
  closeTerminal: (id: number) => Promise<void>;
  reconnectSession: (id: number) => Promise<Terminal>;
  renameSession: (id: number, name: string) => void;
  writeTerminal: (id: number, data: string) => Promise<void>;
  resizeTerminal: (id: number, rows: number, cols: number) => Promise<void>;
  uploadImageToSshTerminal: (
    terminalId: number,
    filename: string,
    data: Uint8Array,
  ) => Promise<string>;
  reportTerminalSize: (terminalId: number, rows: number, cols: number) => void;
  applyDisplayConfigToLiveSession: (id: number, patch: Partial<TerminalDisplayConfig>) => void;
  touchTerminalActivity: (id: number) => void;
  dismissTmuxControllerError: (controllerId: number) => void;
}

export interface WorkspaceLayoutActions {
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

export interface SessionActions
  extends SavedLaunchConfigActions, TerminalRuntimeActions, WorkspaceLayoutActions {}

export interface SessionProviderProps {
  children: ReactNode;
}
