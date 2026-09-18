/**
 * Session-shaped data types.
 *
 * `Session` is the **frontend view-model** of an open terminal
 * connection — what the React tree reads. Its shape is roughly the
 * sum of: a backend-side live session, the `SavedSessionConfig` it
 * was opened from, and any backend-specific metadata the UI needs
 * to render (capabilities, tmux pane ids, etc.).
 *
 * The persisted / saved form lives in `./persistence.ts` as
 * `SavedSessionConfig`.
 */
import type { CapabilityFlags } from "./capabilities";

/**
 * How the frontend reached the backend. `"local"` and `"ssh"` are
 * the two transports the backend offers directly; `"tmux-cc"` is a
 * mark that the session rides on top of a tmux controller — see
 * `Session.tmuxBackend` for the actual handle.
 *
 * The `"tmux-cc"` variant does NOT carry its own config here; tmux
 * session configs are user-saved separately as
 * `SavedSessionConfig` of `type: "tmux-cc"` and referenced by id
 * when reopening. The runtime `Session` is created from
 * `create_tmux_session` / `attach_tmux_session` and stays attached
 * to the backend.
 */
export type SessionType = "local" | "ssh" | "tmux-cc";

/**
 * tmux-side handle attached to a `Session` of `type === "tmux-cc"`.
 * Identifies the pane inside the tmux controller and lets the
 * frontend route UI events to the right backend session.
 *
 * Lives on `Session.tmuxBackend` (optional) so a plain local/ssh
 * session doesn't carry any tmux metadata.
 */
export interface TmuxSessionBackend {
  /** tmux pane id (e.g. `"%5"`). */
  tmuxPaneId: string;
  /** Owning tmux controller id (`TmuxController::controller_id`). */
  tmuxControllerId: number;
  /** tmux window id (e.g. `"@1"`) this pane belongs to. */
  tmuxWindowId: string;
  /**
   * Backend-assigned xsterm window id paired with `tmuxWindowId`.
   * Surfaced by `create_tmux_session` / `attach_tmux_session` so the
   * frontend can install the matching `TerminalWindow` synchronously
   * on return — the `tmux-window-added` listener does not fire for
   * the bootstrap window.
   */
  xstermWindowId: number;
  /** `true` for the bootstrap pane; UI renders nothing for it. */
  isHidden?: boolean;
}

/**
 * One open terminal session in the frontend.
 *
 * The model is intentionally close to the wire shape returned by
 * the backend (`sessionService.SessionInfo`); the canonical tmux
 * fields are in `tmuxBackend`, but the legacy flat fields are also
 * exposed as optional mirrors so existing call-sites keep compiling.
 * Future commits will migrate consumers to `tmuxBackend` and drop
 * the legacy mirrors.
 */
export interface Session {
  /** Backend-assigned id; matches the row in `useSessionStore.sessions`. */
  id: number;
  /** Saved config id the session was opened from. Empty string for ad-hoc sessions. */
  configId: string;
  /** Display label shown in the tab. */
  name: string;
  /** Transport used to reach the backend. */
  sessionType: SessionType;
  /** Connection state — flips false on `session-disconnected`. */
  isConnected: boolean;
  /** Backend-advertised feature flags (resize / reconnect / local-echo / multiplex). */
  capabilities?: CapabilityFlags;
  /** Per-session visual config (font, scrollback, cursor, logging, …). */
  displayConfig?: SessionDisplayConfig;
  /** ms epoch — set when the PTY/SSH/tmux child is established. */
  createdAt?: number;
  /** ms epoch — updated on pane focus + terminal output (debounced). */
  lastActivityAt?: number;

  /**
   * Canonical tmux-side handle. Set only when `sessionType === "tmux-cc"`.
   * For `local` / `ssh` sessions the field is undefined — ts narrowing
   * lets consumers branch on `sessionType` without checking for null.
   */
  tmuxBackend?: TmuxSessionBackend;

  // --- Legacy flat fields (deprecated) ---
  // These mirror `tmuxBackend.*` for the tmux fields. Kept optional so
  // existing call-sites keep compiling while consumers migrate to
  // `tmuxBackend`. Will be removed in a follow-up commit.
  /** @deprecated Use `tmuxBackend?.tmuxPaneId` */
  tmuxPaneId?: string;
  /** @deprecated Use `tmuxBackend?.tmuxControllerId` */
  tmuxControllerId?: number;
  /** @deprecated Use `tmuxBackend?.tmuxWindowId` */
  tmuxWindowId?: string;
  /** @deprecated Use `tmuxBackend?.xstermWindowId` */
  xstermWindowId?: number;
  /** @deprecated Use `tmuxBackend?.isHidden` */
  isHidden?: boolean;

  // --- Legacy field aliases (deprecated) ---
  /** @deprecated Old `type` field used by SessionInfo wire shape. Use `sessionType`. */
  type?: string;
  /** @deprecated Old `kind` alias from pre-refactor model. */
  kind?: string;
}

// ---------------------------------------------------------------------------
// Display config — applies to a single session, overriding any UI defaults.

export interface SessionDisplayConfig {
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: "block" | "underline" | "bar";
  cursorBlink?: boolean;
  scrollback?: number;
  lineHeight?: number;
  letterSpacing?: number;
  cursorWidth?: number;

  /** Show a timestamp prefix on each output line. @default false */
  lineTimestamp?: boolean;
  timeFormat?: string;
  dateTimeFormat?: string;

  lineNumberEnabled?: boolean;
  autoWrap?: boolean;
  reverseVideo?: boolean;

  mouseWheelScrollLines?: number;

  syncRemoteTitle?: boolean;
  sizingMode?: "auto" | "fixed";
  cols?: number;
  rows?: number;

  backspaceSends?: "auto" | "backspace" | "delete";
  deleteSends?: "auto" | "backspace" | "delete";
  lineFeedMode?: boolean;
  cursorKeyMode?: "normal" | "application";
  keypadMode?: "normal" | "application";
  modifyOtherKeysFormat?: "xterm" | "fixterm";
  altSendsEscape?: boolean;

  wordSeparatorChars?: string;
  altScreenWordSeparatorChars?: string;

  clipboardRead?: "ask" | "allow" | "deny";
  clipboardWrite?: "ask" | "allow" | "deny";

  logging?: SessionLoggingConfig;
  /** Whether to render the per-pane sidebar. @default true */
  showSidebar?: boolean;
}

export interface SessionLoggingConfig {
  enabled?: boolean;
  append?: boolean;
  fileNameTemplate?: string;
  maxSizeMb?: number;
  lineFormat?: string;
}

export interface SessionEnvConfig {
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Session creation configs — what the user fills in the New Session dialog.
// These are user-input shapes (separate from `Session` which is the
// runtime view-model).

export interface LocalSessionConfig {
  name?: string;
  shellTemplate?: "powershell" | "cmd" | "git-bash" | "wsl" | "custom";
  shell?: string;
  cwd?: string;
  args?: string[];
  termType?: string;
  charset?: string;
  startupCommand?: string;
  startupDelayMs?: number;
  envConfig?: SessionEnvConfig;
  initialCols?: number;
  initialRows?: number;
}

export interface SSHSessionConfig {
  name?: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "key";
  password?: string;
  key_file?: string;
  passphrase?: string;
  termType?: string;
  initialRows?: number;
  initialCols?: number;
  keepaliveInterval?: number;
  connectionTimeout?: number;
  tcpNoDelay?: boolean;
  soKeepalive?: boolean;
  nullPacketKeepalive?: boolean;
  charset?: string;
  enableCompression?: boolean;
  knownHostsPath?: string;
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
 * type.
 */
export interface TmuxCcConfig {
  name?: string;
  baseConfigId?: string;
  tmuxSessionName?: string;
  socketName?: string;
  startCommand?: string;
  envConfig?: SessionEnvConfig;
  initialRows?: number;
  initialCols?: number;
  /** When set, the controller runs `tmux -CC` on the remote host via an SSH exec channel. */
  ssh?: SSHSessionConfig;
}

/**
 * User-input shape for the New Session dialog. Discriminated by
 * `type`: `local` and `ssh` carry their full config inline; `tmux-cc`
 * only references a saved base config (the user's `local` or `ssh`
 * record) plus a few tmux-specific knobs.
 *
 * The backend IPC accepts this exact shape; `Session` is constructed
 * by `buildFrontendSession` from the backend's reply.
 */
export type CreateSessionInput =
  | { type: "local"; config: LocalSessionConfig }
  | { type: "ssh"; config: SSHSessionConfig }
  | { type: "tmux-cc"; config: TmuxCcConfig };

// ---------------------------------------------------------------------------
// Tmux runtime metadata — independent from `Session`, lives alongside.

/**
 * Held in `useTmuxStore.tmuxControllerErrors` when a tmux controller
 * exits unexpectedly. Keeps the original config so the user can
 * retry via `attachTmux` / `createTmux`.
 */
export interface TmuxControllerError {
  config: TmuxCcConfig;
  reason?: string;
  timestamp: number;
}

/**
 * One row in the `windows` array of a `tmux-window-list` event
 * payload (ADR 0009 §2.6 / §2.8). Populated by the bridge module
 * `emit_tmux_window_added_for_list` from the bootstrap
 * `list-windows -F #{DEFAULT_WINDOW_LIST_FORMAT}` reply, and
 * incrementally refreshed by the per-window `tmux-window-added` /
 * `tmux-window-closed` / `tmux-window-renamed` events.
 */
export interface TmuxWindowListEntry {
  tmuxWindowId: string;
  xstermWindowId: number;
  xstermSessionId?: number;
  tmuxPaneId?: string;
  name: string;
}

/**
 * Persisted by the backend in `attached_tmux.json`; the frontend
 * reads it at startup to drive the auto-attach flow.
 */
export interface AttachedTmuxServer {
  sessionName: string;
  socketName?: string;
  attachedAt: number;
}