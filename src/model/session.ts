/**
 * Session runtime view-model.
 *
 * `Session` is what the React tree reads when it needs the current
 * state of an open terminal connection: identity (id, configId, name),
 * transport (type), connection state (isConnected), backend-advertised
 * capabilities, the user's per-session display config, and the optional
 * `tmuxBackend` handle (set only when `type === "tmux-cc"`).
 *
 * Two related shapes live elsewhere:
 * - `LocalSessionConfig` / `SSHSessionConfig` / `TmuxCcConfig` /
 *   `CreateSessionInput` (the user-input shapes for the New Session
 *   dialog) live in `./session-config.ts`.
 * - `TmuxTerminalBackend` / `TmuxSessionBackend` (backend-side
 *   handles) live in `./tmux-handles.ts`.
 * - `Tmux*Event` payloads, `TmuxControllerError`, `AttachedTmuxServer`,
 *   `TmuxWindowListEntry` (transient event metadata) live in
 *   `./tmux-events.ts`.
 */
import type { CapabilityFlags } from "./capabilities";
import type { CreateSessionInput } from "./session-config";
import type { TmuxSessionBackend } from "./tmux-handles";

/** Transport used to reach the backend — runtime tag on a `Session`. */
export type SessionConnectionType = "local" | "ssh" | "tmux-cc";

/**
 * One open terminal session in the frontend.
 *
 * `tmuxBackend` is set only when `type === "tmux-cc"`; for
 * `local` / `ssh` sessions the field is undefined. TS narrowing on
 * `type` lets consumers branch without a null check.
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
  /** Backend-side tmux handle. Set only when `type === "tmux-cc"`. */
  tmuxBackend?: TmuxSessionBackend;
}

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

/** A group of saved session configs in the sidebar. */
// (moved to ./session-config.ts — `SessionGroup` is a persisted/UI
//  shape, not a runtime Session view-model.)
