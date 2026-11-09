import type { Dispatch, MutableRefObject, ReactNode, SetStateAction } from "react";
import {
  type LocalTerminalConfig,
  type PaneNode,
  type SshConfig,
  type SavedTerminalConfig,
  type SavedWindowConfig,
  type SavedWorkspace,
  type Terminal,
  type TerminalDisplayConfig,
  type TerminalGroup,
  type SplitDirection,
  type TmuxSessionConfig,
  type Window,
  type Workspace,
} from "../../../models/legacy/terminal";

export interface SessionPreferencesContextType {
  globalLocalEcho: boolean;
  setGlobalLocalEcho: (enabled: boolean) => void;
}

export interface SavedLaunchConfigsContextType {
  savedConfigs: SavedTerminalConfig[];
  groups: TerminalGroup[];
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

export interface TerminalRuntimeContextType {
  terminals: Terminal[];
  terminalSizesRef: MutableRefObject<Map<number, { rows: number; cols: number }>>;
  terminalSizesVersion: number;
  getEffectiveLocalEcho: (terminalId: number) => boolean;
  tmuxControllerErrors: Map<number, TmuxControllerError>;
  createLocalSession: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSession: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  createLocalSessionOnly: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSessionOnly: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  createTmuxSession: (config: TmuxSessionConfig, save?: boolean) => Promise<Terminal>;
  attachTmuxSession: (config: TmuxSessionConfig, save?: boolean) => Promise<Terminal>;
  detachTmuxSession: (controllerId: number) => Promise<void>;
  openFromConfig: (configId: string) => Promise<Terminal>;
  createTerminalFromSavedConfig: (configId: string) => Promise<Terminal>;
  closeTerminal: (id: number) => Promise<void>;
  reconnectSession: (id: number) => Promise<Terminal>;
  renameSession: (id: number, name: string) => void;
  writeTerminal: (id: number, data: string) => Promise<void>;
  resizeTerminal: (id: number, rows: number, cols: number) => Promise<void>;
  reportTerminalSize: (terminalId: number, rows: number, cols: number) => void;
  applyDisplayConfigToLiveSession: (id: number, patch: Partial<TerminalDisplayConfig>) => void;
  touchTerminalActivity: (id: number) => void;
  dismissTmuxControllerError: (controllerId: number) => void;
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

export interface TerminalContextType
  extends
    SessionPreferencesContextType,
    SavedLaunchConfigsContextType,
    TerminalRuntimeContextType,
    WorkspaceLayoutContextType {}

export type SetSavedConfigs = Dispatch<SetStateAction<SavedTerminalConfig[]>>;
export type SetSessions = Dispatch<SetStateAction<Terminal[]>>;
export type SetWorkspaces = Dispatch<SetStateAction<Workspace[]>>;
export type SetSavedWorkspaces = Dispatch<SetStateAction<SavedWorkspace[]>>;
export type SetSavedWindowConfigs = Dispatch<SetStateAction<SavedWindowConfig[]>>;
export type SetGroups = Dispatch<SetStateAction<TerminalGroup[]>>;

/**
 * a tmux controller that has exited unexpectedly (e.g. tmux
 * died with a `%exit reason` message). Holds the config that can be
 * passed back to `attachTmux` / `createTmux` for a retry.
 */
export interface TmuxControllerError {
  /** The original config the controller was built from. */
  config: TmuxSessionConfig;
  /** Reported reason (the `reason` field from the `tmux-controller-exit` event). */
  reason?: string;
  /** ms epoch when the error was first surfaced. */
  timestamp: number;
}

export interface TerminalState {
  savedConfigs: SavedTerminalConfig[];
  setSavedConfigs: SetSavedConfigs;
  terminals: Terminal[];
  setSessions: SetSessions;
  workspaces: Workspace[];
  setWorkspaces: SetWorkspaces;
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: Dispatch<SetStateAction<string | null>>;
  savedWorkspaces: SavedWorkspace[];
  setSavedWorkspaces: SetSavedWorkspaces;
  savedWindowConfigs: SavedWindowConfig[];
  setSavedWindowConfigs: SetSavedWindowConfigs;
  groups: TerminalGroup[];
  setGroups: SetGroups;
  nextGroupId: number;
  setNextGroupId: Dispatch<SetStateAction<number>>;
  globalLocalEcho: boolean;
  setGlobalLocalEcho: Dispatch<SetStateAction<boolean>>;
  sessionLocalEchoOverrides: Map<number, boolean>;
  terminalsRef: MutableRefObject<Terminal[]>;
  workspacesRef: MutableRefObject<Workspace[]>;
  establishingSessionsRef: MutableRefObject<Set<number>>;
  getEffectiveLocalEcho: (terminalId: number) => boolean;
  /**
   * pending tmux-controller errors keyed by `controllerId`.
   * Populated by the `tmux-controller-exit` listener; the retry
   * banner reads it to render the Retry / Dismiss affordances.
   */
  tmuxControllerErrors: Map<number, TmuxControllerError>;
  setTmuxControllerErrors: Dispatch<SetStateAction<Map<number, TmuxControllerError>>>;
  /**
   * `controllerId → TmuxSessionConfig` map. Populated by
   * `attachTmuxSession` so the retry banner
   * can re-call the backend with the same config. Survives pane
   * teardown so the banner can still retry after the `Terminal`
   * rows are gone.
   */
  tmuxControllerConfigsRef: MutableRefObject<Map<number, TmuxSessionConfig>>;
  /**
   * `controllerId` -> `configId` map. Populated by `attachTmuxSession` so
   * event-driven tmux panes can be linked back to their saved config.
   */
  tmuxControllerConfigIdsRef: MutableRefObject<Map<number, string>>;
  /** Controllers intentionally detached/closed; suppresses retry banners. */
  tmuxControllersClosingRef: MutableRefObject<Set<number>>;
  /** Last fitted xterm dimensions per terminal. */
  terminalSizesRef: MutableRefObject<Map<number, { rows: number; cols: number }>>;
  /** Bumped whenever a terminal reports a new fitted size. */
  terminalSizesVersion: number;
  reportTerminalSize: (terminalId: number, rows: number, cols: number) => void;
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
  openFromConfig: (configId: string) => Promise<Terminal>;
  createTerminalFromSavedConfig: (configId: string) => Promise<Terminal>;
  closeTerminal: (id: number) => Promise<void>;
  reconnectSession: (id: number) => Promise<Terminal>;
  renameSession: (id: number, name: string) => void;
  writeTerminal: (id: number, data: string) => Promise<void>;
  resizeTerminal: (id: number, rows: number, cols: number) => Promise<void>;
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

export interface SessionActions
  extends SavedLaunchConfigActions, TerminalRuntimeActions, WorkspaceLayoutActions {}

export interface SessionProviderProps {
  children: ReactNode;
}
