export type SplitDirection = "horizontal" | "vertical";

export interface PaneNode {
  id: string;
  type: "leaf" | "split";
  direction?: SplitDirection;
  size: number;
  children?: PaneNode[];
  sessionId?: number;
  configId?: string;
}

export interface SavedWindow {
  id: string;
  name: string;
  rootPane: PaneNode;
}

export interface SavedWindowConfig extends SavedWindow {}

export interface SavedWorkspace {
  id: string;
  name: string;
  windows: SavedWindow[];
}

export interface Window {
  id: string;
  name: string;
  rootPane: PaneNode;
  activePaneId: string | null;
  windowType?: "terminal" | "init";
}

export interface Workspace {
  id: string;
  name: string;
  windows: Window[];
  activeWindowId: string | null;
  sessionIds: number[];
  savedWorkspaceId?: string;
}

export interface Session {
  id: number;
  configId: string;
  name: string;
  type: "local" | "ssh";
  is_connected: boolean;
  session_type: SessionType;
}

export type SessionType =
  | { type: "local"; shell: string; cwd: string }
  | { type: "ssh"; host: string; port: number; user: string };

export interface LocalSessionConfig {
  shell?: string;
  cwd?: string;
  args?: string[];
}

export interface SSHSessionConfig {
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "key";
  password?: string;
  key_file?: string;
  passphrase?: string;
}

export interface SavedSessionConfig {
  id: string;
  name: string;
  type: "local" | "ssh";
  localConfig?: LocalSessionConfig;
  sshConfig?: SSHSessionConfig;
}

export interface SessionGroup {
  id: number;
  name: string;
  configIds: string[];
  collapsed: boolean;
}
