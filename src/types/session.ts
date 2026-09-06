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
  /**
   * backend's xsterm window id (a u32) for tmux-backed windows.
   * Used by the `tmux-window-closed` / `tmux-window-renamed` listeners
   * to find the matching frontend Window. Undefined for non-tmux
   * windows and for tmux bootstrap windows (the bootstrap window's
   * xsterm_window_id is tracked by the backend but not exposed to the
   * frontend, so the bootstrap window cannot be killed via
   * `kill_tmux_window` from the frontend).
   */
  xstermWindowId?: number;
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
  type: "local" | "ssh" | "tmux-cc";
  isConnected: boolean;
  sessionType: SessionType;
  displayConfig?: SessionDisplayConfig;
  capabilities?: CapabilityFlags;
  /** ms epoch — set when PTY/SSH is established */
  createdAt?: number;
  /** ms epoch — updated on pane focus + terminal output */
  lastActivityAt?: number;
  /** tmux pane id (e.g. "%5") when this session is backed by a tmux pane. */
  tmuxPaneId?: string;
  /** controller id that owns this tmux pane; set when `type === "tmux-cc"`. */
  tmuxControllerId?: number;
  /**
   * tmux window id (e.g. "@1") the pane belongs to. Used by the
   * frontend to map a `Session` to its containing `xsterm Window` when
   * processing `tmux-window-closed` (to find every Session that belongs
   * to a closing window). Set for both bootstrap panes and panes
   * created via `create_tmux_window` / `create_tmux_pane`.
   */
  tmuxWindowId?: string;
  /**
   * hidden (bootstrap) tmux panes are not rendered. `tmux -CC new`
   * panes have `is_hidden = false` so they render normally; tmux
   * attaches flag the bootstrap pane as hidden.
   */
  isHidden?: boolean;
}

export type SessionType =
  | { type: "local"; config: LocalSessionConfig }
  | { type: "ssh"; config: SSHSessionConfig }
  | { type: "tmux-cc"; config: TmuxCcConfig };

export interface LocalSessionConfig {
  /** Optional display name. Falls back to the shell basename when omitted. */
  name?: string;
  /** Preset shell type. Use "custom" when providing an explicit shell path. @default 'cmd' */
  shellTemplate?: "powershell" | "cmd" | "git-bash" | "wsl" | "custom";
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
  /** Initial terminal columns. @default 80 */
  initialCols?: number;
  /** Initial terminal rows. @default 24 */
  initialRows?: number;
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

/**
 * tmux control mode (`tmux -CC`) session config. Mirrors the Rust
 * `TmuxCcConfig` struct exactly. All fields optional — empty `TmuxCcConfig {}`
 * produces a `tmux -CC new-session` with default socket and auto-generated name.
 *
 * **Transport is derived from `baseConfigId`** — a tmux session must be
 * created on top of an already-saved SSH or Local shell config; the
 * transport (local PTY vs SSH exec channel) follows the base config's
 * type. The user never picks a transport explicitly when creating a
 * tmux session. The frontend `TmuxForm` lists the user's saved configs
 * filtered to `local` / `ssh` and copies the SSH sub-config (when the
 * base is an SSH config) into the request that reaches the backend.
 *
 * Mirrors `doc/requirements/prd-0.1/req-006-tmux.md` §4.4 D5 + §4.7.
 */
export interface TmuxCcConfig {
  /** Optional display name. Falls back to tmux session name when omitted. */
  name?: string;
  /**
   * Required for any tmux session the user creates through the dialog:
   * id of the saved SSH or Local shell config this tmux session should
   * ride on. The frontend copies the SSH sub-config from the base
   * config into the request that reaches the backend (see
   * `CreateSessionDialog.handleCreate`); the backend then routes
   * through the SSH exec channel when the base was an SSH config and
   * through a local `tokio::process::Command` child otherwise.
   */
  baseConfigId?: string;
  /** tmux session name. Leave blank to auto-generate a new session. */
  tmuxSessionName?: string;
  /** tmux socket name (`-L` flag). Leave blank for tmux's default socket. */
  socketName?: string;
  /** Initial shell command (passed to `tmux -CC new-session -d <cmd>`). */
  startCommand?: string;
  /** Initial environment overrides applied to the tmux pane. */
  envConfig?: SessionEnvConfig;
  /** Initial terminal rows advertised to tmux. @default 24 */
  initialRows?: number;
  /** initial terminal columns advertised to tmux. @default 80 */
  initialCols?: number;
  /**
   * SSH connection config. When set, the controller runs
   * `tmux -CC` on the remote host via an SSH exec channel. When
   * `undefined` (the default), the controller spawns a local
   * `tmux -CC` child. Wired by the Create Session dialog's
   * dedicated "Tmux (SSH)" top tab.
   */
  ssh?: SSHSessionConfig;
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
  /** Show line numbers in the gutter on the left side of the terminal. @default true */
  lineNumberEnabled?: boolean;
  /** Enable automatic line wrapping (DECAWM). @default true */
  autoWrap?: boolean;
  /** Invert foreground/background colors (DECSCNM). @default false */
  reverseVideo?: boolean;

  // Mouse
  /** Number of lines scrolled per mouse wheel tick. @default 1 */
  mouseWheelScrollLines?: number;

  // Window
  /** Sync the window title with the remote terminal (DCS title). @default true */
  syncRemoteTitle?: boolean;
  /** Terminal sizing strategy. "auto" tracks the container via ResizeObserver;
   * "fixed" locks to `cols` × `rows` regardless of container size. @default "auto" */
  sizingMode?: "auto" | "fixed";
  /** Locked column count when `sizingMode === "fixed"`. Ignored in "auto" mode. */
  cols?: number;
  /** Locked row count when `sizingMode === "fixed"`. Ignored in "auto" mode. */
  rows?: number;

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

  // Terminal
  // `terminalType` and `charset` intentionally live only on
  // LocalSessionConfig / SSHSessionConfig (consumed by the Rust backend to
  // set `TERM` / `LC_ALL` env on the PTY). The TerminalTab UI dispatches
  // edits to the connection-specific config based on its `connectionType`
  // prop — see src/components/dialogs/TerminalTab.tsx.

  // Logging
  /** Session output logging configuration. */
  logging?: SessionLoggingConfig;

  /** Whether to render the per-pane sidebar. @default true */
  showSidebar?: boolean;
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

/**
 * Payload of the `tmux-pane-added` event emitted by the
 * `TmuxController` dispatch task on `%window-pane-changed`.
 *
 * The frontend listener in `useTauriListeners.ts` is idempotent: if a
 * `Session` with the same `xstermSessionId` already exists (because
 * the backend's `create_tmux_session` return value populated React
 * state for the bootstrap pane), the listener short-circuits. This
 * means the same payload shape covers BOTH the bootstrap pane and
 * user-driven split panes; only the listener's behavior differs.
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxPaneAddedEvent {
  controllerId: number;
  tmuxPaneId: string;
  xstermSessionId: number;
  parentTmuxWindowId: string;
}

/**
 * Payload of the `tmux-pane-removed` event emitted by the
 * `TmuxController` dispatch task on `%pane-exited` /
 * `%pane-died` (and on a successful `kill_pane` round-trip). The
 * frontend listener drops the matching `Session` from React state and
 * collapses the corresponding leaf in the pane tree.
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxPaneRemovedEvent {
  controllerId: number;
  tmuxPaneId: string;
  xstermSessionId: number;
}

/**
 * Payload of the `tmux-window-added` event emitted by the
 * `TmuxController` dispatch task when a user-driven `new-window`
 * request resolves. The frontend listener creates a new xsterm Window
 * in the same workspace as the controller's other panes (if any) and
 * attaches the Session to it. Bootstrap windows do NOT fire this
 * event (the frontend already owns the corresponding xsterm Window).
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxWindowAddedEvent {
  controllerId: number;
  tmuxWindowId: string;
  xstermWindowId: number;
  xstermSessionId: number;
  xstermPaneId: string;
}

/**
 * Payload of the `tmux-window-closed` event emitted by the
 * `TmuxController` dispatch task on `%window-close`. The frontend
 * listener finds every Session with `tmuxWindowId === payload.tmuxWindowId`,
 * drops them from React state, then drops the matching xsterm Window
 * (collapsing the workspace to an init window if it becomes empty).
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxWindowClosedEvent {
  controllerId: number;
  tmuxWindowId: string;
  xstermWindowId: number;
}

/**
 * Payload of the `tmux-window-renamed` event emitted by the
 * `TmuxController` dispatch task on `%window-renamed`. The frontend
 * listener updates the matching xsterm Window's `name`.
 *
 * Mirrors req-006 §4.6.
 */
export interface TmuxWindowRenamedEvent {
  controllerId: number;
  tmuxWindowId: string;
  xstermWindowId: number;
  name: string;
}

/**
 * record of a tmux server the user has attached to (or
 * `create_tmux`'d). Persisted by the backend in `attached_tmux.json`;
 * the frontend reads it at startup to drive the auto-attach flow and
 * `sessionService.getAttachedTmuxServers` projects the live
 * `TmuxController` registry into the same shape.
 */
export interface AttachedTmuxServer {
  /** tmux session name (the `-s <name>` arg) — required to re-attach. */
  sessionName: string;
  /** Optional tmux socket name (the `-L <socket>` arg). */
  socketName?: string;
  /** ms epoch when the user last attached / created this server. */
  attachedAt: number;
}
