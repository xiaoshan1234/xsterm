import type { CapabilityFlags } from "./capabilities";

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
  displayConfig?: SessionDisplayConfig;
  capabilities?: CapabilityFlags;
}

export type SessionType =
  | { type: "local"; config: LocalSessionConfig }
  | { type: "ssh"; config: SSHSessionConfig };

export interface LocalSessionConfig {
  shell?: string;
  cwd?: string;
  args?: string[];
  envConfig?: SessionEnvConfig;
}

export interface SSHSessionConfig {
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "key";
  password?: string;
  key_file?: string;
  passphrase?: string;
  /** Terminal type advertised to the server. @default 'xterm-256color' */
  termType?: string;
  /** Initial terminal rows. @default 24 */
  initialRows?: number;
  /** Initial terminal columns. @default 80 */
  initialCols?: number;
  /** SSH keepalive interval in seconds. @default 0 (disabled) */
  keepaliveInterval?: number;
  /** Connection timeout in seconds. @default 30 */
  connectionTimeout?: number;
  /** Enable zlib compression for the SSH stream. @default false */
  enableCompression?: boolean;
  /** Path to known_hosts file for host key verification (currently unused). */
  knownHostsPath?: string;
  /** SSH proxy jump host (user@host:port) for cascading connections. */
  proxyJump?: string;
}

export interface SessionDisplayConfig {
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: "block" | "underline" | "bar";
  cursorBlink?: boolean;
  scrollback?: number;
  lineHeight?: number;
  letterSpacing?: number;
  cursorWidth?: number;
}

export interface SessionEnvConfig {
  env?: Record<string, string>;
}

export type SavedSessionConfig =
  ({ id: string; name: string; version: number } & SessionType) & {
    displayConfig?: SessionDisplayConfig;
  };

export interface SessionGroup {
  id: number;
  name: string;
  configIds: string[];
  collapsed: boolean;
}
