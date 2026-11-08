import type { CapabilityFlags } from "../../../types/capabilities";

/**
 * Capability flags for tmux `-CC` panes. Mirrors the backend's
 * `CapabilityFlags::for_tmux()`.
 *
 * Used only by the event-driven paths (`tmux-pane-added`,
 * `create_tmux_pane`) where the frontend must build a `Session` without a
 * `SessionInfo` payload. Sessions created through a backend command take
 * their capabilities from `SessionInfo.capabilities` via
 * `buildFrontendSession`.
 */
export const TMUX_PANE_CAPABILITIES: CapabilityFlags = {
  supportsResize: true,
  supportsReconnect: true,
  supportsLocalEcho: false,
  supportsMultiplex: true,
};
