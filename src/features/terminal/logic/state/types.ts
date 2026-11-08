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
} from "../../../../types/terminal";

export interface TerminalContextType {
  terminals: Terminal[];
  setSessions: SetSessions;
  savedConfigs: SavedTerminalConfig[];
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  savedWorkspaces: SavedWorkspace[];
  savedWindowConfigs: SavedWindowConfig[];
  groups: TerminalGroup[];
  globalLocalEcho: boolean;
  setGlobalLocalEcho: (enabled: boolean) => void;
  getEffectiveLocalEcho: (terminalId: number) => boolean;
  // tmux retry-banner state. Exposed here (not just on
  // TerminalState) so the listener and the banner can read/write
  // it through the regular `useSession()` API.
  tmuxControllerErrors: Map<number, TmuxControllerError>;
  setTmuxControllerErrors: Dispatch<SetStateAction<Map<number, TmuxControllerError>>>;
  tmuxControllerConfigsRef: MutableRefObject<Map<number, TmuxSessionConfig>>;
  createLocalSession: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSession: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  createLocalSessionOnly: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSessionOnly: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  createTmuxSession: (config: TmuxSessionConfig, save?: boolean) => Promise<Terminal>;
  createTmuxSessionOnly: (config: TmuxSessionConfig, save?: boolean) => Promise<Terminal>;
  saveConfigOnly: (
    type: Terminal["type"],
    config: LocalTerminalConfig | SshConfig | TmuxSessionConfig,
    displayConfig?: TerminalDisplayConfig,
  ) => SavedTerminalConfig;
  openFromConfig: (configId: string) => Promise<Terminal>;
  removeConfig: (configId: string) => void;
  closeTerminal: (id: number) => Promise<void>;
  reconnectSession: (id: number) => Promise<Terminal>;
  closePane: (workspaceId: string, windowId: string, paneId: string) => Promise<void>;
  addToGroup: (groupId: number, configId: string) => void;
  removeFromGroup: (groupId: number, configId: string) => void;
  moveConfigToGroup: (configId: string, groupId: number | null) => void;
  renameSession: (id: number, name: string) => void;
  createGroup: (name: string) => void;
  deleteGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  updateConfig: (config: SavedTerminalConfig) => void;
  toggleGroup: (id: number) => void;
  writeTerminal: (id: number, data: string) => Promise<void>;
  resizeTerminal: (id: number, rows: number, cols: number) => Promise<void>;
  applyDisplayConfigToLiveSession: (id: number, patch: Partial<TerminalDisplayConfig>) => void;
  createWorkspaceFromSession: (terminalId: number, configId: string, name?: string) => Workspace;
  createTerminalFromSavedConfig: (configId: string) => Promise<Terminal>;
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
}

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
   * `createTmuxSession` / `attachTmuxSession` so the retry banner
   * can re-call the backend with the same config. Survives pane
   * teardown so the banner can still retry after the `Terminal`
   * rows are gone.
   */
  tmuxControllerConfigsRef: MutableRefObject<Map<number, TmuxSessionConfig>>;
}

export interface SessionPersistence {
  updateConfigs: (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
  updateGroups: (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => void;
  persistSavedWorkspaces: (workspacesData: SavedWorkspace[]) => void;
  persistSavedWindowConfigs: (windowConfigs: SavedWindowConfig[]) => void;
}

export interface SessionActions {
  createLocalSession: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSession: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  createLocalSessionOnly: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSessionOnly: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  createTmuxSession: (config: TmuxSessionConfig, save?: boolean) => Promise<Terminal>;
  createTmuxSessionOnly: (config: TmuxSessionConfig, save?: boolean) => Promise<Terminal>;
  saveConfigOnly: (
    type: Terminal["type"],
    config: LocalTerminalConfig | SshConfig | TmuxSessionConfig,
    displayConfig?: TerminalDisplayConfig,
  ) => SavedTerminalConfig;
  openFromConfig: (configId: string) => Promise<Terminal>;
  removeConfig: (configId: string) => void;
  closeTerminal: (id: number) => Promise<void>;
  reconnectSession: (id: number) => Promise<Terminal>;
  closePane: (workspaceId: string, windowId: string, paneId: string) => Promise<void>;
  addToGroup: (groupId: number, configId: string) => void;
  removeFromGroup: (groupId: number, configId: string) => void;
  moveConfigToGroup: (configId: string, groupId: number | null) => void;
  renameSession: (id: number, name: string) => void;
  createGroup: (name: string) => void;
  deleteGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  updateConfig: (config: SavedTerminalConfig) => void;
  toggleGroup: (id: number) => void;
  writeTerminal: (id: number, data: string) => Promise<void>;
  resizeTerminal: (id: number, rows: number, cols: number) => Promise<void>;
  applyDisplayConfigToLiveSession: (id: number, patch: Partial<TerminalDisplayConfig>) => void;
  createWorkspaceFromSession: (terminalId: number, configId: string, name?: string) => Workspace;
  createTerminalFromSavedConfig: (configId: string) => Promise<Terminal>;
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
}

export interface SessionProviderProps {
  children: ReactNode;
}
