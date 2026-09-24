import type { Dispatch, MutableRefObject, ReactNode, SetStateAction } from "react";
import {
  type LocalSessionConfig,
  type PaneNode,
  type SSHSessionConfig,
  type PersistedSessionConfig,
  type PersistedWindowConfig,
  type PersistedWorkspace,
  type Session,
  type SessionDisplayConfig,
  type SessionGroup,
  type SplitDirection,
  type TmuxCcConfig,
  type TmuxControllerError,
  type TmuxWindowListEntry,
  type Window,
  type Workspace,
} from "../../../../model";

export interface SessionContextType {
  sessions: Session[];
  setSessions: SessionsSetter;
  savedConfigs: PersistedSessionConfig[];
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  savedWorkspaces: PersistedWorkspace[];
  savedWindowConfigs: PersistedWindowConfig[];
  groups: SessionGroup[];
  globalLocalEcho: boolean;
  setGlobalLocalEcho: (enabled: boolean) => void;
  getEffectiveLocalEcho: (sessionId: number) => boolean;
  // tmux retry-banner state. Exposed here (not just on
  // SessionState) so the listener and the banner can read/write
  // it through the regular `useSession()` API.
  tmuxControllerErrors: Map<number, TmuxControllerError>;
  setTmuxControllerErrors: Dispatch<SetStateAction<Map<number, TmuxControllerError>>>;
  tmuxControllerConfigsRef: MutableRefObject<Map<number, TmuxCcConfig>>;
  /**
   * `controllerId → TmuxWindowListEntry[]` cache. Populated by the
   * `tmux-window-list` listener and incrementally refreshed by the
   * per-window `tmux-window-added` / `-closed` / `-renamed` events.
   * Read by `TmuxWindowsControl` (the windows-control card inside
   * the control-window UI) so the card can render rows even before
   * the first `tmux-window-added` arrives. ADR 0009 §2.6.
   */
  tmuxWindowListsRef: MutableRefObject<Map<number, TmuxWindowListEntry[]>>;
  createLocalSession: (config: LocalSessionConfig, save?: boolean) => Promise<Session>;
  createSshSession: (config: SSHSessionConfig, save?: boolean) => Promise<Session>;
  createLocalSessionOnly: (config: LocalSessionConfig, save?: boolean) => Promise<Session>;
  createSshSessionOnly: (config: SSHSessionConfig, save?: boolean) => Promise<Session>;
  createTmuxSession: (config: TmuxCcConfig, save?: boolean) => Promise<Session>;
  createTmuxSessionOnly: (config: TmuxCcConfig, save?: boolean) => Promise<Session>;
  saveConfigOnly: (
    type: Session["type"],
    config: LocalSessionConfig | SSHSessionConfig | TmuxCcConfig,
    displayConfig?: SessionDisplayConfig,
  ) => PersistedSessionConfig;
  openFromConfig: (configId: string) => Promise<Session>;
  removeConfig: (configId: string) => void;
  closeSession: (id: number) => Promise<void>;
  reconnectSession: (id: number) => Promise<Session>;
  closePane: (workspaceId: string, windowId: string, paneId: string) => Promise<void>;
  addToGroup: (groupId: number, configId: string) => void;
  removeFromGroup: (groupId: number, configId: string) => void;
  moveConfigToGroup: (configId: string, groupId: number | null) => void;
  renameSession: (id: number, name: string) => void;
  createGroup: (name: string) => void;
  deleteGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  updateConfig: (config: PersistedSessionConfig) => void;
  toggleGroup: (id: number) => void;
  writeSession: (id: number, data: string) => Promise<void>;
  resizeSession: (id: number, rows: number, cols: number) => Promise<void>;
  applyDisplayConfigToLiveSession: (id: number, patch: Partial<SessionDisplayConfig>) => void;
  createWorkspaceFromSession: (sessionId: number, configId: string, name?: string) => Workspace;
  createSessionFromSavedConfig: (configId: string) => Promise<Session>;
  createWindowFromSession: (
    sessionId: number,
    configId: string,
    name?: string,
    targetWorkspaceId?: string,
  ) => Window;
  createWindowFromSavedConfig: (configId: string, name?: string) => Promise<Window>;
  createWindow: (
    workspaceId: string,
    sessionId?: number,
    configId?: string,
    name?: string,
    windowType?: "terminal" | "init",
    tmuxControlWindowId?: number,
  ) => Window;
  createDefaultWorkspace: () => Workspace;
  createInitWindow: () => Window;
  replaceInitWindowWithSession: (workspaceId: string, windowId: string, session: Session) => void;
  closeWindow: (workspaceId: string, windowId: string) => void;
  setActiveWindow: (workspaceId: string, windowId: string) => void;
  splitPane: (
    workspaceId: string,
    windowId: string,
    paneId: string,
    direction: SplitDirection,
    sessionId?: number,
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

export type PersistedConfigsSetter = Dispatch<SetStateAction<PersistedSessionConfig[]>>;
export type SessionsSetter = Dispatch<SetStateAction<Session[]>>;
export type WorkspacesSetter = Dispatch<SetStateAction<Workspace[]>>;
export type PersistedWorkspacesSetter = Dispatch<SetStateAction<PersistedWorkspace[]>>;
export type PersistedWindowConfigsSetter = Dispatch<SetStateAction<PersistedWindowConfig[]>>;
export type GroupsSetter = Dispatch<SetStateAction<SessionGroup[]>>;

export interface SessionState {
  savedConfigs: PersistedSessionConfig[];
  setSavedConfigs: PersistedConfigsSetter;
  sessions: Session[];
  setSessions: SessionsSetter;
  workspaces: Workspace[];
  setWorkspaces: WorkspacesSetter;
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: Dispatch<SetStateAction<string | null>>;
  savedWorkspaces: PersistedWorkspace[];
  setSavedWorkspaces: PersistedWorkspacesSetter;
  savedWindowConfigs: PersistedWindowConfig[];
  setSavedWindowConfigs: PersistedWindowConfigsSetter;
  groups: SessionGroup[];
  setGroups: GroupsSetter;
  nextGroupId: number;
  setNextGroupId: Dispatch<SetStateAction<number>>;
  globalLocalEcho: boolean;
  setGlobalLocalEcho: Dispatch<SetStateAction<boolean>>;
  sessionLocalEchoOverrides: Map<number, boolean>;
  sessionsRef: MutableRefObject<Session[]>;
  workspacesRef: MutableRefObject<Workspace[]>;
  establishingSessionsRef: MutableRefObject<Set<number>>;
  getEffectiveLocalEcho: (sessionId: number) => boolean;
  /**
   * pending tmux-controller errors keyed by `controllerId`.
   * Populated by the `tmux-controller-exit` listener; the retry
   * banner reads it to render the Retry / Dismiss affordances.
   */
  tmuxControllerErrors: Map<number, TmuxControllerError>;
  setTmuxControllerErrors: Dispatch<SetStateAction<Map<number, TmuxControllerError>>>;
  /**
   * `controllerId → TmuxCcConfig` map. Populated by
   * `createTmuxSession` / `attachTmuxSession` so the retry banner
   * can re-call the backend with the same config. Survives pane
   * teardown so the banner can still retry after the `Session`
   * rows are gone.
   */
  tmuxControllerConfigsRef: MutableRefObject<Map<number, TmuxCcConfig>>;
  /**
   * `controllerId → TmuxWindowListEntry[]` cache. Populated by the
   * `tmux-window-list` listener and incrementally refreshed by the
   * per-window `tmux-window-added` / `-closed` / `-renamed` events.
   * Read by `TmuxWindowsControl` (the windows-control card inside
   * the control-window UI) so the card can render rows even before
   * the first `tmux-window-added` arrives. ADR 0009 §2.6.
   */
  tmuxWindowListsRef: MutableRefObject<Map<number, TmuxWindowListEntry[]>>;
}

export interface SessionPersistence {
  updateConfigs: (updater: (prev: PersistedSessionConfig[]) => PersistedSessionConfig[]) => void;
  updateGroups: (updater: (prev: SessionGroup[]) => SessionGroup[], nextId?: number) => void;
  persistSavedWorkspaces: (workspacesData: PersistedWorkspace[]) => void;
  persistSavedWindowConfigs: (windowConfigs: PersistedWindowConfig[]) => void;
}

export interface SessionActions {
  createLocalSession: (config: LocalSessionConfig, save?: boolean) => Promise<Session>;
  createSshSession: (config: SSHSessionConfig, save?: boolean) => Promise<Session>;
  createLocalSessionOnly: (config: LocalSessionConfig, save?: boolean) => Promise<Session>;
  createSshSessionOnly: (config: SSHSessionConfig, save?: boolean) => Promise<Session>;
  createTmuxSession: (config: TmuxCcConfig, save?: boolean) => Promise<Session>;
  createTmuxSessionOnly: (config: TmuxCcConfig, save?: boolean) => Promise<Session>;
  saveConfigOnly: (
    type: Session["type"],
    config: LocalSessionConfig | SSHSessionConfig | TmuxCcConfig,
    displayConfig?: SessionDisplayConfig,
  ) => PersistedSessionConfig;
  openFromConfig: (configId: string) => Promise<Session>;
  removeConfig: (configId: string) => void;
  closeSession: (id: number) => Promise<void>;
  reconnectSession: (id: number) => Promise<Session>;
  closePane: (workspaceId: string, windowId: string, paneId: string) => Promise<void>;
  addToGroup: (groupId: number, configId: string) => void;
  removeFromGroup: (groupId: number, configId: string) => void;
  moveConfigToGroup: (configId: string, groupId: number | null) => void;
  renameSession: (id: number, name: string) => void;
  createGroup: (name: string) => void;
  deleteGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  updateConfig: (config: PersistedSessionConfig) => void;
  toggleGroup: (id: number) => void;
  writeSession: (id: number, data: string) => Promise<void>;
  resizeSession: (id: number, rows: number, cols: number) => Promise<void>;
  applyDisplayConfigToLiveSession: (id: number, patch: Partial<SessionDisplayConfig>) => void;
  createWorkspaceFromSession: (sessionId: number, configId: string, name?: string) => Workspace;
  createSessionFromSavedConfig: (configId: string) => Promise<Session>;
  createWindowFromSession: (
    sessionId: number,
    configId: string,
    name?: string,
    targetWorkspaceId?: string,
  ) => Window;
  createWindowFromSavedConfig: (configId: string, name?: string) => Promise<Window>;
  createWindow: (
    workspaceId: string,
    sessionId?: number,
    configId?: string,
    name?: string,
    windowType?: "terminal" | "init",
    tmuxControlWindowId?: number,
  ) => Window;
  createDefaultWorkspace: () => Workspace;
  createInitWindow: () => Window;
  replaceInitWindowWithSession: (workspaceId: string, windowId: string, session: Session) => void;
  closeWindow: (workspaceId: string, windowId: string) => void;
  setActiveWindow: (workspaceId: string, windowId: string) => void;
  splitPane: (
    workspaceId: string,
    windowId: string,
    paneId: string,
    direction: SplitDirection,
    sessionId?: number,
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
