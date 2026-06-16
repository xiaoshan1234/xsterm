export interface Session {
  id: number;
  configId: string;
  name: string;
  type: "local" | "ssh" | "tmux";
  is_connected: boolean;
  session_type: SessionType;
}

export type SessionType =
  | { type: "local"; shell: string; cwd: string }
  | { type: "ssh"; host: string; port: number; user: string }
  | { type: "tmux"; socket?: string; command: string };

export interface TmuxSessionConfig {
  name?: string;
  socket?: string;
  command: string;
  target?: string;
}

export interface TmuxPane {
  id: string;
  sessionId: string;
  windowId: string;
  title: string;
  isActive: boolean;
  isPaused: boolean;
  width: number;
  height: number;
}

export interface TmuxWindow {
  id: string;
  sessionId: string;
  name: string;
  activePaneId?: string;
  layout: string;
  panes: string[];
  isActive: boolean;
}

export interface TmuxSessionState {
  id: string;
  name: string;
  activeWindowId?: string;
  windows: string[];
}

export interface TmuxState {
  sessions: Map<string, TmuxSessionState>;
  windows: Map<string, TmuxWindow>;
  panes: Map<string, TmuxPane>;
}

export type TmuxControlEvent =
  | { type: "SessionChanged"; sessionId: string; name: string }
  | { type: "SessionRenamed"; name: string }
  | { type: "WindowAdded"; window: TmuxWindow }
  | { type: "WindowClosed"; windowId: string }
  | { type: "WindowRenamed"; windowId: string; name: string }
  | { type: "WindowActivated"; windowId: string }
  | { type: "LayoutChanged"; windowId: string; layout: string }
  | { type: "PaneAdded"; pane: TmuxPane }
  | { type: "PaneClosed"; paneId: string }
  | { type: "PaneTitleChanged"; paneId: string; title: string }
  | { type: "PaneModeChanged"; paneId: string; inCopyMode: boolean }
  | { type: "PanePaused"; paneId: string }
  | { type: "PaneContinued"; paneId: string }
  | { type: "Exit"; reason?: string }
  | { type: "Unknown"; raw: string };

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
  type: "local" | "ssh" | "tmux";
  localConfig?: LocalSessionConfig;
  sshConfig?: SSHSessionConfig;
  tmuxConfig?: TmuxSessionConfig;
}

export interface SessionGroup {
  id: number;
  name: string;
  configIds: string[];
  collapsed: boolean;
}
