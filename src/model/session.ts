/**
 * Session runtime view-model.
 *
 * `Session` is what the React tree reads when it needs the current
 * state of an open terminal connection: identity (id, configId, name),
 * transport (type), connection state (isConnected), backend-advertised
 * `CapabilityFlags`, the user's per-session display config, and the
 * optional `tmuxBackend` handle (set only when `type === "tmux-cc"`).
 *
 * Related shapes live elsewhere:
 * - `LocalSessionConfig` / `SSHSessionConfig` / `TmuxCcConfig` /
 *   `CreateSessionInput` / `SavedSessionConfig` / `SessionGroup`
 *   (user-input + persisted shapes) live in `./session-config.ts`.
 * - `TmuxSessionBackend` (backend-side handle for tmux-cc sessions)
 *   lives in `./tmux-handles.ts`.
 * - `Tmux*Event` payloads, `TmuxControllerError`, `AttachedTmuxServer`,
 *   `TmuxWindowListEntry` (transient event metadata) live in
 *   `./tmux-events.ts`.
 * - `SavedWindow` / `SavedWorkspace` (persisted snapshots) live in
 *   `./window-config.ts` / `./workspace-config.ts`.
 */
import type { CreateSessionInput, SessionDisplayConfig } from "./session-config";
import type { TmuxSessionBackend } from "./tmux-handles";

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

/** A group of saved session configs in the sidebar. */
// (moved to ./session-config.ts — `SessionGroup` is a persisted/UI
//  shape, not a runtime Session view-model.)
