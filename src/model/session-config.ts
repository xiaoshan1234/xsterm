/**
 * Session connection configurations — the user-input shapes for the
 * New Session dialog.
 *
 * `CreateSessionInput` is the discriminated union the backend IPC
 * accepts; `LocalSessionConfig` / `SSHSessionConfig` / `TmuxCcConfig`
 * are the per-transport config shapes nested in it. `SessionEnvConfig`
 * is shared by local / ssh / tmux-cc.
 *
 * Runtime view-models of an open session live in `./session.ts`; the
 * persisted shape of a user-saved config lives in `./persistence.ts`.
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
