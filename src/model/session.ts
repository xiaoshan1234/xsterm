/**
 * Session runtime view-model.
 *
 * `Session` is what the React tree reads when it needs the current
 * state of an open terminal connection: identity (id, configId, name),
 * transport (type), connection state (isConnected), backend-advertised
 * `CapabilityFlags`, the user's per-session display config, and (when
 * `type === "tmux-cc"`) the tmux-cc metadata fields directly on the
 * shape.
 *
 * Related shapes live elsewhere:
 * - `LocalSessionConfig` / `SSHSessionConfig` / `TmuxCcConfig` /
 *   `CreateSessionInput` / `SavedSessionConfig` / `SessionGroup`
 *   (user-input + persisted shapes) live in `./session-config.ts`.
 * - `TmuxSessionBackend` (a small `{ isHidden }` marker kept for
 *   documentation) lives in `./tmux-handles.ts`.
 * - `Tmux*Event` payloads, `TmuxControllerError`, `AttachedTmuxServer`,
 *   `TmuxWindowListEntry` (transient event metadata) live in
 *   `./tmux-events.ts`.
 * - `SavedWindow` / `SavedWorkspace` (persisted snapshots) live in
 *   `./window-config.ts` / `./workspace-config.ts`.
 */
import type { CreateSessionInput, SessionDisplayConfig } from "./session-config";
import { TmuxSessionBackend } from "./tmux";

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
  tmuxBackend?: TmuxSessionBackend;
}

/** A group of saved session configs in the sidebar. */
// (moved to ./session-config.ts — `SessionGroup` is a persisted/UI
//  shape, not a runtime Session view-model.)
