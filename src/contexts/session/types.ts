import type { Dispatch, MutableRefObject, ReactNode, SetStateAction } from "react";
import {
  LocalSessionConfig,
  PaneNode,
  SSHSessionConfig,
  SavedSessionConfig,
  SavedWindowConfig,
  SavedWorkspace,
  Session,
  SessionGroup,
  SplitDirection,
  Window,
  Workspace,
} from "../../types/session";

export interface SessionContextType {
  sessions: Session[];
  savedConfigs: SavedSessionConfig[];
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  savedWorkspaces: SavedWorkspace[];
  savedWindowConfigs: SavedWindowConfig[];
  groups: SessionGroup[];
  globalLocalEcho: boolean;
  setGlobalLocalEcho: (enabled: boolean) => void;
  getEffectiveLocalEcho: (sessionId: number) => boolean;
  createLocalSession: (config: LocalSessionConfig, save?: boolean) => Promise<Session>;
  createSshSession: (config: SSHSessionConfig, save?: boolean) => Promise<Session>;
  createLocalSessionOnly: (config: LocalSessionConfig, save?: boolean) => Promise<Session>;
  createSshSessionOnly: (config: SSHSessionConfig, save?: boolean) => Promise<Session>;
  openFromConfig: (configId: string) => Promise<Session>;
  removeConfig: (configId: string) => void;
  closeSession: (id: number) => Promise<void>;
  closePane: (workspaceId: string, windowId: string, paneId: string) => Promise<void>;
  addToGroup: (groupId: number, configId: string) => void;
  removeFromGroup: (groupId: number, configId: string) => void;
  moveConfigToGroup: (configId: string, groupId: number | null) => void;
  renameSession: (id: number, name: string) => void;
  createGroup: (name: string) => void;
  deleteGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  updateConfig: (config: SavedSessionConfig) => void;
  toggleGroup: (id: number) => void;
  writeSession: (id: number, data: string) => Promise<void>;
  resizeSession: (id: number, rows: number, cols: number) => Promise<void>;
  createWorkspaceFromSession: (sessionId: number, configId: string, name?: string) => Workspace;
  createSessionFromSavedConfig: (configId: string) => Promise<Session>;
  createWindowFromSession: (sessionId: number, configId: string, name?: string, targetWorkspaceId?: string) => Window;
  createWindowFromSavedConfig: (configId: string, name?: string) => Promise<Window>;
  createWindow: (workspaceId: string, sessionId?: number, configId?: string, name?: string, windowType?: "terminal" | "init") => Window;
  createDefaultWorkspace: () => Workspace;
  createInitWindow: () => Window;
  replaceInitWindowWithSession: (workspaceId: string, windowId: string, session: Session) => void;
  closeWindow: (workspaceId: string, windowId: string) => void;
  setActiveWindow: (workspaceId: string, windowId: string) => void;
  splitPane: (workspaceId: string, windowId: string, paneId: string, direction: SplitDirection, sessionId?: number, configId?: string) => void;
  updateWindowPaneTree: (workspaceId: string, windowId: string, updater: (root: PaneNode) => PaneNode) => void;
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
}

export type SetSavedConfigs = Dispatch<SetStateAction<SavedSessionConfig[]>>;
export type SetSessions = Dispatch<SetStateAction<Session[]>>;
export type SetWorkspaces = Dispatch<SetStateAction<Workspace[]>>;
export type SetSavedWorkspaces = Dispatch<SetStateAction<SavedWorkspace[]>>;
export type SetSavedWindowConfigs = Dispatch<SetStateAction<SavedWindowConfig[]>>;
export type SetGroups = Dispatch<SetStateAction<SessionGroup[]>>;

export interface SessionState {
  savedConfigs: SavedSessionConfig[];
  setSavedConfigs: SetSavedConfigs;
  sessions: Session[];
  setSessions: SetSessions;
  workspaces: Workspace[];
  setWorkspaces: SetWorkspaces;
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: Dispatch<SetStateAction<string | null>>;
  savedWorkspaces: SavedWorkspace[];
  setSavedWorkspaces: SetSavedWorkspaces;
  savedWindowConfigs: SavedWindowConfig[];
  setSavedWindowConfigs: SetSavedWindowConfigs;
  groups: SessionGroup[];
  setGroups: SetGroups;
  nextGroupId: number;
  setNextGroupId: Dispatch<SetStateAction<number>>;
  globalLocalEcho: boolean;
  setGlobalLocalEcho: Dispatch<SetStateAction<boolean>>;
  sessionLocalEchoOverrides: Map<number, boolean>;
  sessionsRef: MutableRefObject<Session[]>;
  workspacesRef: MutableRefObject<Workspace[]>;
  establishingSessionsRef: MutableRefObject<Set<number>>;
  getEffectiveLocalEcho: (sessionId: number) => boolean;
}

export interface SessionPersistence {
  updateConfigs: (updater: (prev: SavedSessionConfig[]) => SavedSessionConfig[]) => void;
  updateGroups: (updater: (prev: SessionGroup[]) => SessionGroup[], nextId?: number) => void;
  persistSavedWorkspaces: (workspacesData: SavedWorkspace[]) => void;
  persistSavedWindowConfigs: (windowConfigs: SavedWindowConfig[]) => void;
}

export interface SessionActions {
  createLocalSession: (config: LocalSessionConfig, save?: boolean) => Promise<Session>;
  createSshSession: (config: SSHSessionConfig, save?: boolean) => Promise<Session>;
  createLocalSessionOnly: (config: LocalSessionConfig, save?: boolean) => Promise<Session>;
  createSshSessionOnly: (config: SSHSessionConfig, save?: boolean) => Promise<Session>;
  openFromConfig: (configId: string) => Promise<Session>;
  removeConfig: (configId: string) => void;
  closeSession: (id: number) => Promise<void>;
  closePane: (workspaceId: string, windowId: string, paneId: string) => Promise<void>;
  addToGroup: (groupId: number, configId: string) => void;
  removeFromGroup: (groupId: number, configId: string) => void;
  moveConfigToGroup: (configId: string, groupId: number | null) => void;
  renameSession: (id: number, name: string) => void;
  createGroup: (name: string) => void;
  deleteGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  updateConfig: (config: SavedSessionConfig) => void;
  toggleGroup: (id: number) => void;
  writeSession: (id: number, data: string) => Promise<void>;
  resizeSession: (id: number, rows: number, cols: number) => Promise<void>;
  createWorkspaceFromSession: (sessionId: number, configId: string, name?: string) => Workspace;
  createSessionFromSavedConfig: (configId: string) => Promise<Session>;
  createWindowFromSession: (sessionId: number, configId: string, name?: string, targetWorkspaceId?: string) => Window;
  createWindowFromSavedConfig: (configId: string, name?: string) => Promise<Window>;
  createWindow: (workspaceId: string, sessionId?: number, configId?: string, name?: string, windowType?: "terminal" | "init") => Window;
  createDefaultWorkspace: () => Workspace;
  createInitWindow: () => Window;
  replaceInitWindowWithSession: (workspaceId: string, windowId: string, session: Session) => void;
  closeWindow: (workspaceId: string, windowId: string) => void;
  setActiveWindow: (workspaceId: string, windowId: string) => void;
  splitPane: (workspaceId: string, windowId: string, paneId: string, direction: SplitDirection, sessionId?: number, configId?: string) => void;
  updateWindowPaneTree: (workspaceId: string, windowId: string, updater: (root: PaneNode) => PaneNode) => void;
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
}

export interface SessionProviderProps {
  children: ReactNode;
}
