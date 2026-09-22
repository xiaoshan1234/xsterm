/**
 * Session connection configurations + persistence shapes.
 *
 * Holds three responsibilities:
 * - Per-transport user-input configs (`LocalSessionConfig` /
 *   `SSHSessionConfig` / `TmuxCcConfig` / `SessionEnvConfig`) — the
 *   shapes the New Session dialog fills in.
 * - `CreateSessionInput` — the discriminated union the backend IPC
 *   accepts; combines `type` + per-transport `config`.
 * - `SavedSessionConfig` + `SessionGroup` — the on-disk shapes the
 *   `tauri-plugin-store` adapters read and write. Migration logic
 *   lives in `src/infra/store/migrations.ts`.
 *
 * Runtime view-models of an open session (`Session`, `SessionDisplayConfig`)
 * live in `./session.ts`.
 */
/**
 * Persistence shapes (formerly in `./persistence.ts`).
 *
 * `SessionDisplayConfig` is inlined below rather than imported from
 * `./session.ts` to avoid a cycle: `session.ts` imports
 * `CreateSessionInput` from this file.
 */

/** Shared environment overrides; nested under each transport config. */
export interface SessionEnvConfig {
  env?: Record<string, string>;
}

/** Config for a local PTY session. Mirrors the Rust `LocalSessionConfig`. */
export interface LocalSessionConfig {
  /** Optional display name. Falls back to the shell basename when omitted. */
  name?: string;
  /** Preset shell type. Use `"custom"` when providing an explicit shell path. @default 'cmd' */
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

/** Config for an SSH session. Mirrors the Rust `SSHSessionConfig`. */
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
  /** Disable Nagle's algorithm (TCP_NODELAY). @default true */
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
 * `TmuxCcConfig`. Empty `TmuxCcConfig {}` produces a `tmux -CC
 * new-session` with default socket and auto-generated name.
 *
 * **Transport is derived from `baseConfigId`** — a tmux session must
 * be created on top of an already-saved SSH or Local shell config; the
 * transport (local PTY vs SSH exec channel) follows the base config's
 * type.
 */
export interface TmuxCcConfig {
  /** Optional display name. Falls back to tmux session name when omitted. */
  name?: string;
  /**
   * Required for any tmux session the user creates through the dialog:
   * id of the saved SSH or Local shell config this tmux session should
   * ride on.
   */
  baseConfigId?: string;
  /** tmux session name. Leave blank to auto-generate a new session. */
  tmuxSessionName?: string;
  /** tmux socket name (`-L` flag). Leave blank for tmux's default socket. */
  socketName?: string;
  /** Initial shell command (passed to `tmux -CC new-session -d <cmd>`). */
  startCommand?: string;
  envConfig?: SessionEnvConfig;
  /** Initial terminal rows advertised to tmux. @default 24 */
  initialRows?: number;
  /** initial terminal columns advertised to tmux. @default 80 */
  initialCols?: number;
  /**
   * SSH connection config. When set, the controller runs `tmux -CC`
   * on the remote host via an SSH exec channel. When `undefined`,
   * the controller spawns a local `tmux -CC` child.
   */
  ssh?: SSHSessionConfig;
}

/**
 * User-input shape for the New Session dialog. Discriminated by `type`;
 * the `config` field narrows to the matching per-transport config.
 */
export type CreateSessionInput =
  | { type: "local"; config: LocalSessionConfig }
  | { type: "ssh"; config: SSHSessionConfig }
  | { type: "tmux-cc"; config: TmuxCcConfig };

export type SessionType = CreateSessionInput;

// ---------------------------------------------------------------------------
// Persistence shapes (formerly in `./persistence.ts`).

// ---------------------------------------------------------------------------
// Display config — applied to a single session, overriding any UI defaults.

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

/**
 * Persisted shape of a user-saved session config. Adds `id` / `name`
 * / `version` over `CreateSessionInput` (the version drives the
 * `migrateSavedConfig` matrix in `src/infra/store/migrations.ts`).
 */
export type SavedSessionConfig = {
  id: string;
  name: string;
  version: number;
} & CreateSessionInput & {
    /**
     * Inlined SessionDisplayConfig (per-session visual config).
     * The field set is identical to the runtime one — see
     * `./session.ts` `SessionDisplayConfig` for the full schema. Kept
     * inline here to avoid a cycle through `./session.ts`.
     */
    displayConfig?: SessionDisplayConfig;
  };

/** A group of saved session configs in the sidebar. */
export interface SessionGroup {
  id: number;
  name: string;
  /** Ids of `SavedSessionConfig`s in this group. */
  configIds: string[];
  /** Whether the group is collapsed in the sidebar. */
  collapsed: boolean;
}
