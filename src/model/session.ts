import type { CapabilityFlags } from "./capabilities";

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

export type SessionType =
  | { type: "local"; config: LocalSessionConfig }
  | { type: "ssh"; config: SSHSessionConfig }
  | { type: "tmux-cc"; config: TmuxCcConfig };

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
   * xsterm window id paired with `tmuxWindowId`. Surfaced by
   * `create_tmux_session` / `attach_tmux_session` so the frontend can
   * install the matching xsterm Window synchronously on return — the
   * `tmux-window-added` listener does not fire for the bootstrap
   * window (Bug fix 2026-09-13).
   */
  xstermWindowId?: number;
  /**
   * hidden (bootstrap) tmux panes are not rendered. `tmux -CC new`
   * panes have `is_hidden = false` so they render normally; tmux
   * attaches flag the bootstrap pane as hidden.
   */
  isHidden?: boolean;
}

/**
 * a tmux controller that has exited unexpectedly (e.g. tmux
 * died with a `%exit reason` message). Holds the config that can be
 * passed back to `attachTmux` / `createTmux` for a retry.
 */
export interface TmuxControllerError {
  /** The original config the controller was built from. */
  config: TmuxCcConfig;
  /** Reported reason (the `reason` field from the `tmux-controller-exit` event). */
  reason?: string;
  /** ms epoch when the error was first surfaced. */
  timestamp: number;
}

/**
 * Record of a tmux server the user has attached to (or
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

/**
 * One row in the `windows` array of a `tmux-window-list` event
 * payload (ADR 0009 §2.6 / §2.8). Populated by the bridge module
 * `emit_tmux_window_added_for_list` from the bootstrap
 * `list-windows -F #{DEFAULT_WINDOW_LIST_FORMAT}` reply, and
 * incrementally refreshed by the per-window `tmux-window-added` /
 * `tmux-window-closed` / `tmux-window-renamed` events.
 *
 * The frontend's `TmuxWindowsControl` component reads these to render
 * the per-window rename / disconnect / delete actions. The xsterm
 * window id (`xstermWindowId`) is the integer the frontend uses to
 * bind the row to its `Window` entry via `Window.xstermWindowId`.
 */
export interface TmuxWindowListEntry {
  /** tmux server-side window id (e.g. `"@1"`). */
  tmuxWindowId: string;
  /** xsterm-allocated window id (matches `Window.xstermWindowId`). */
  xstermWindowId: number;
  /** xsterm session id of the window's first pane, when known. */
  xstermSessionId?: number;
  /** tmux pane id of the window's first pane, when known. */
  tmuxPaneId?: string;
  /** current tmux window name. */
  name: string;
}
