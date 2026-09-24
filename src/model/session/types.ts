/**
 * Session domain — runtime shapes + per-transport user input + display config.
 *
 * **Scope**
 * - Runtime view-model of an open backend connection (`Session`).
 * - Wire shape returned by every session-creating Tauri command
 *   (`SessionInfo`).
 * - Backend-advertised feature flags (`CapabilityFlags`).
 * - Per-transport user-input configs (`LocalSessionConfig`,
 *   `SSHSessionConfig`, `TmuxCcConfig`, `CreateSessionInput`,
 *   `SessionType`).
 * - Per-session visual config (`SessionDisplayConfig`,
 *   `SessionLoggingConfig`).
 *
 * **Out of scope** (lives in sibling domains):
 * - `SavedSessionConfig` / `SessionGroup` — on-disk persisted shapes,
 *   live in `../persistence`.
 * - `TmuxPaneAddedEvent` / `TmuxControllerError` / `TmuxSessionInit` /
 *   `AttachedTmuxServer` / `TmuxWindowListEntry` — tmux-specific event
 *   payloads and metadata, live in `../tmux`.
 * - `ParsedSessionOutput` — runtime PTY output frames, live in
 *   `../output`.
 * - `SavedPaneNode` — frozen pane tree persisted shape, lives in
 *   `../pane`.
 */

/** Transport used to reach the backend — runtime tag on a `Session`. */
export type SessionConnectionType = "local" | "ssh" | "tmux-cc";

/**
 * Backend-advertised capability flags attached to a `Session`.
 *
 * Each flag describes a feature the backend session actually
 * implements. The frontend uses them to decide between alternative UI
 * flows — e.g. `splitPane` looks at `supportsMultiplex` to pick
 * `createTmuxPane` (server-side split) over a UI-only split.
 *
 * Set on the backend's wire shape (`sessionService.SessionInfo`)
 * for `local` and `ssh` sessions; tmux-cc sessions always carry
 * `supportsMultiplex: true`.
 */
export interface CapabilityFlags {
  /**
   * Backend will accept a follow-up resize signal after the session
   * is established. True for `local` PTY and `ssh` exec channels; may
   * be false for restricted SSH configurations.
   */
  supportsResize: boolean;

  /**
   * The session can be re-attached after the underlying transport
   * closes (e.g. SSH reconnect). False for one-shot PTY sessions.
   * Consulted by the `reconnectSession` use case before attempting
   * re-attach.
   */
  supportsReconnect: boolean;

  /**
   * Backend implements its own local-echo (sending input bytes back
   * to the frontend before the remote echoes them). Distinct from
   * xterm.js's `localEcho` render option. Not currently consumed by
   * the frontend — kept for forward-compat with backends that need it.
   */
  supportsLocalEcho: boolean;

  /**
   * The session can be split into multiple panes by the backend.
   * True for tmux-cc sessions (server-side tmux pane split); false
   * for plain `local` / `ssh` sessions (frontend falls back to a
   * UI-only split that produces an empty leaf).
   */
  supportsMultiplex: boolean;
}

/**
 * Wire shape returned by every session-creating Tauri command
 * (`create_session`, `create_tmux_session`, `attach_tmux_session`,
 * `create_tmux_pane`, `create_tmux_window`). Defines the structural
 * shape used by both local/ssh sessions and tmux-backed sessions —
 * the `tmuxPaneId` / `tmuxControllerId` / `tmuxServerWindowId` /
 * `isHidden` fields are populated only for tmux sessions.
 *
 * Mirrors the Rust `SessionInfo` struct on the wire (see
 * `src-tauri/src/models/session.rs`). Converted to the frontend
 * `Session` view-model by `app/rules/sessionRules.ts::buildFrontendSession`.
 */
export interface SessionInfo {
  id: number;
  name: string;
  sessionType: Session["sessionType"];
  isConnected: boolean;
  capabilities?: CapabilityFlags;
  /** tmux pane id (`%<N>`) when this session is backed by a tmux pane. */
  tmuxPaneId?: string;
  /** id of the tmux controller process that owns this pane. */
  tmuxControllerId?: number;
  /** tmux server-side window id (e.g. `@1`) the pane belongs to.
   * Surfaced by `create_tmux_session` / `attach_tmux_session` so the
   * frontend can render the matching xsterm Window synchronously on
   * return (the `tmux-window-added` listener does not fire for the
   * bootstrap window). */
  tmuxServerWindowId?: string;
  /**
   * hidden (bootstrap) tmux panes are not rendered by the frontend.
   * MVP `tmux -CC new` panes have `is_hidden = false`; tmux attaches
   * flag the bootstrap pane as hidden.
   */
  isHidden?: boolean;
}

/**
 * One open terminal session in the frontend.
 *
 * The tmux-cc-only fields (`tmuxControllerId`, `tmuxPaneId`,
 * `tmuxServerWindowId`, `isHidden`) are flat on the shape rather than
 * nested under a `tmuxBackend` wrapper so that IPC client wrappers
 * can read them directly without dereferencing a nested object. TS
 * narrowing on `type === "tmux-cc"` lets consumers branch without a
 * null check.
 *
 * # Identifier namespaces on a tmux-cc Session
 *
 * The parallel backend u32 (previously `xsterm_window_id` /
 * `tmuxWindowId`) was removed by the Rust commit
 * `2871e76 refactor tmux controller to replace xsterm_id with
 * session_id` — the controller no longer allocates its own per-window
 * id; the tmux server-side id (`"@1"`) IS the Window identity on the
 * wire. Consequence: the matching `xsterm Window` is keyed by
 * `tmuxServerWindowId` (the string), not by a parallel u32.
 *
 * - `id: number` — backend-allocated u32, stable for the lifetime of
 *   the in-process session; used as the React store key and as the
 *   primary key in `session-output` / `session-closed` events.
 * - `tmuxControllerId: number` — backend tmux controller u32; sent on
 *   every tmux IPC command alongside the server-side id.
 * - `tmuxPaneId: string` — tmux server-side pane id (e.g. `"%5"`).
 *   Used for `kill_tmux_pane` / `capture_tmux_pane` / parent pane in
 *   `create_tmux_pane` / `resize_tmux_pane`.
 * - `tmuxServerWindowId: string` — tmux server-side window id (e.g.
 *   `"@1"`). Used for `kill_tmux_window` / `rename_tmux_window` and
 *   for matching `tmux-window-added` / `-closed` / `-renamed` events
 *   to xsterm Windows.
 */
export interface Session {
  /** Backend-assigned id; matches the row in `useSessionStore.sessions`. */
  id: number;
  /** Saved config id the session was opened from. Empty string for ad-hoc sessions. */
  configId: string;
  /** Display label shown in the tab. */
  name: string;
  type: SessionConnectionType;
  /** Connection state — flips false on `session-disconnected`. */
  isConnected: boolean;
  /**
   * Per-session input shape carried alongside the runtime view-model so
   * the New Session dialog can reconstruct a `SavedSessionConfig` from a
   * live `Session` without re-fetching.
   */
  sessionType: CreateSessionInput;
  /** Backend-advertised feature flags (resize / reconnect / local-echo / multiplex). */
  capabilities?: CapabilityFlags;
  /** Per-session visual config (font, scrollback, cursor, logging, …). */
  displayConfig?: SessionDisplayConfig;
  /** ms epoch — set when the PTY/SSH/tmux child is established. */
  createdAt?: number;
  /** ms epoch — updated on pane focus + terminal output (debounced). */
  lastActivityAt?: number;
  /** Backend tmux controller u32. */
  tmuxControllerId?: number;
  /** tmux server-side pane id (e.g. `"%5"`). */
  tmuxPaneId?: string;
  /** tmux server-side window id (e.g. `"@1"`). */
  tmuxServerWindowId?: string;
  /** `true` for the bootstrap pane; UI renders nothing for it. */
  isHidden?: boolean;
}

// ---------------------------------------------------------------------------
// User-input shapes for the New Session dialog.
//
// These mirror the Rust `LocalSessionConfig` / `SSHSessionConfig` /
// `TmuxCcConfig` and the discriminated union that the IPC accepts.
// Persisted shapes (which add `id` / `name` / `version`) live in
// `../persistence/types.ts`.

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

/**
 * Marker interface for the legacy `{ isHidden }` shape carried on
 * bootstrap tmux panes. Canonical definition lives in
 * `../tmux/types.ts`; re-exported here so existing imports of
 * `TmuxSessionBackend` from `../../model/session` keep resolving.
 */
export type { TmuxSessionBackend } from "../tmux";
