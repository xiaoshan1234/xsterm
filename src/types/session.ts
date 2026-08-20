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
  isConnected: boolean;
  sessionType: SessionType;
  displayConfig?: SessionDisplayConfig;
  capabilities?: CapabilityFlags;
}

export type SessionType =
  { type: "local"; config: LocalSessionConfig } | { type: "ssh"; config: SSHSessionConfig };

export interface LocalSessionConfig {
  /** Optional display name. Falls back to the shell basename when omitted. */
  name?: string;
  /** Preset shell type. Use "custom" when providing an explicit shell path. @default 'powershell' on Windows, 'bash' otherwise */
  shellTemplate?: "powershell" | "powershell7" | "cmd" | "wsl" | "bash" | "zsh" | "sh" | "custom";
  /** Explicit shell executable path (used when shellTemplate is "custom"). */
  shell?: string;
  cwd?: string;
  args?: string[];
  /** Terminal type advertised to the PTY. @default 'xterm-256color' */
  termType?: string;
  /** Character encoding for the PTY. @default 'utf-8' */
  charset?: string;
  /** Command to run immediately after the shell starts. */
  startupCommand?: string;
  /** Milliseconds to wait after PTY spawn before sending startupCommand. */
  startupDelayMs?: number;
  envConfig?: SessionEnvConfig;
}

export interface SSHSessionConfig {
  /** Optional display name. Falls back to `user@host` when omitted. */
  name?: string;
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
  /** Connection timeout in seconds. @default 20 */
  connectionTimeout?: number;
  /** Disable Nagle's algorithm (TCP_NODELAY). Reduces latency at the cost of more packets. @default true */
  tcpNoDelay?: boolean;
  /** Enable SO_KEEPALIVE on the socket. @default false */
  soKeepalive?: boolean;
  /** Send null SSH packets to keep the connection alive when SO_KEEPALIVE is unavailable. @default false */
  nullPacketKeepalive?: boolean;
  /** Character encoding for the SSH stream. @default 'utf-8' */
  charset?: string;
  /** Enable zlib compression for the SSH stream. @default false */
  enableCompression?: boolean;
  /** Path to known_hosts file for host key verification (currently unused). */
  knownHostsPath?: string;
  /** SSH proxy jump host (user@host:port) for cascading connections. */
  proxyJump?: string;
}

export interface SessionDisplayConfig {
  // --- Existing fields (preserve as-is) ---
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: "block" | "underline" | "bar";
  cursorBlink?: boolean;
  scrollback?: number;
  lineHeight?: number;
  letterSpacing?: number;
  cursorWidth?: number;

  // Timestamp
  /** Show a timestamp prefix on each output line. @default false */
  lineTimestamp?: boolean;
  /** Format string for per-line timestamps (xterm datetime format). @default "[HH:mm:ss]" */
  timeFormat?: string;
  /** Full datetime format used when lineTimestamp is enabled. @default "yyyy-MM-dd HH:mm:ss" */
  dateTimeFormat?: string;

  // Display
  /** Enable automatic line wrapping (DECAWM). @default true */
  autoWrap?: boolean;
  /** Invert foreground/background colors (DECSCNM). @default false */
  reverseVideo?: boolean;

  // Mouse
  /** Number of lines scrolled per mouse wheel tick. @default 1 */
  mouseWheelScrollLines?: number;

  // Window
  /** Fit the terminal to the window on resize (DECFRS). @default true */
  fitOnResize?: boolean;
  /** Sync the window title with the remote terminal (DCS title). @default true */
  syncRemoteTitle?: boolean;

  // Keyboard
  /** Backspace key sends BS or DEL. @default "auto" */
  backspaceSends?: "auto" | "backspace" | "delete";
  /** Delete key sends BS or DEL. @default "auto" */
  deleteSends?: "auto" | "backspace" | "delete";
  /** Line feed mode — Enter sends CR+LF (LNM). @default false */
  lineFeedMode?: boolean;
  /** Cursor key mode: normal (DECCKM) or application. @default "normal" */
  cursorKeyMode?: "normal" | "application";
  /** Numeric keypad mode: normal (DECNKM) or application. @default "normal" */
  keypadMode?: "normal" | "application";
  /** Format for modified other-keys sequences. @default "xterm" */
  modifyOtherKeysFormat?: "xterm" | "fixterm";
  /** Alt key sends the ESC prefix. @default true */
  altSendsEscape?: boolean;

  // Word Separation
  /** Characters that separate words for double-click selection. @default ` !@#$%^&*()_+-=[]{};:'",.<>/?` */
  wordSeparatorChars?: string;
  /** Word separators for alternate screen. Defaults to wordSeparatorChars when unset. */
  altScreenWordSeparatorChars?: string;

  // Security
  /** Whether to allow the terminal to read from the clipboard. @default "ask" */
  clipboardRead?: "ask" | "allow" | "deny";
  /** Whether to allow the terminal to write to the clipboard. @default "ask" */
  clipboardWrite?: "ask" | "allow" | "deny";

  // Logging
  /** Session output logging configuration. */
  logging?: SessionLoggingConfig;
}

export interface SessionLoggingConfig {
  /** Whether to record session output. @default false */
  enabled?: boolean;
  /** Overwrite or append to the log file. @default true */
  append?: boolean;
  /** Log file name template. Supports %n (session name), %Y (year), etc. @default "%n_%Y-%m-%d_%H-%M-%S.log" */
  fileNameTemplate?: string;
  /** Maximum log file size in MB. 0 or unset means unlimited. @default 10 */
  maxSizeMb?: number;
  /** Format string for log lines. %v is the actual output content. @default "[%Y-%m-%d %H:%M:%S] %v" */
  lineFormat?: string;
}

export interface SessionEnvConfig {
  env?: Record<string, string>;
}

export type SavedSessionConfig = ({ id: string; name: string; version: number } & SessionType) & {
  displayConfig?: SessionDisplayConfig;
};

export interface SessionGroup {
  id: number;
  name: string;
  configIds: string[];
  collapsed: boolean;
}
