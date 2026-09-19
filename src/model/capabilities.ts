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
