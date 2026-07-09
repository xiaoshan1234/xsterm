import type { SSHSessionConfig } from "./session";

/**
 * Status of a tmux underlay session's connection to its target tmux session.
 */
export type TmuxUnderlayStatus = "idle" | "connecting" | "connected" | "error" | "disconnected";

/**
 * Frontend state for a single tmux underlay session.
 */
export interface TmuxUnderlayState {
  sessionId: number;
  targetSession: string;
  status: TmuxUnderlayStatus;
  error?: string;
}

/**
 * Configuration for creating a local tmux underlay session.
 */
export interface TmuxSessionConfig {
  name?: string;
  socket?: string;
  command: string;
  target?: string;
}

/**
 * Configuration for creating an SSH tmux underlay session.
 */
export interface SshTmuxSessionConfig {
  ssh?: SSHSessionConfig;
  tmux: TmuxSessionConfig;
}

/**
 * A single tmux pane as tracked by the frontend state tree.
 */
export interface TmuxPane {
  id: string;
  sessionId: string;
  windowId: string;
  title: string;
  isActive: boolean;
  isPaused: boolean;
  inCopyMode: boolean;
  width: number;
  height: number;
}

/**
 * A single tmux window as tracked by the frontend state tree.
 */
export interface TmuxWindow {
  id: string;
  sessionId: string;
  name: string;
  activePaneId?: string;
  layout: string;
  panes: string[];
  isActive: boolean;
}

/**
 * A single tmux session as tracked by the frontend state tree.
 */
export interface TmuxSessionState {
  id: string;
  tmuxSessionId?: string;
  name: string;
  activeWindowId?: string;
  windows: string[];
}

/**
 * Raw session entry in a tmux state snapshot delivered by the Rust backend.
 */
export interface TmuxStateSnapshotSession {
  id: string;
  name: string;
}

/**
 * Raw window entry in a tmux state snapshot delivered by the Rust backend.
 */
export interface TmuxStateSnapshotWindow {
  id: string;
  sessionId: string;
  name: string;
  active: boolean;
  layout: string;
}

/**
 * Raw pane entry in a tmux state snapshot delivered by the Rust backend.
 */
export interface TmuxStateSnapshotPane {
  id: string;
  windowId: string;
  sessionId: string;
  title: string;
  active: boolean;
  width: number;
  height: number;
}

/**
 * Complete tmux state snapshot delivered by the Rust backend through the
 * `tmux-state-sync` event.
 */
export interface TmuxStateSnapshot {
  sessions: Record<string, TmuxStateSnapshotSession>;
  windows: Record<string, TmuxStateSnapshotWindow>;
  panes: Record<string, TmuxStateSnapshotPane>;
}

/**
 * Frontend snapshot of the tmux underlay state.
 *
 * The tree is keyed by string identifiers so it can be updated incrementally
 * as `tmux-state-sync` snapshots arrive from the Rust backend. Maps are used
 * instead of plain objects to preserve insertion order and to make lookups
 * cheap while the reducer applies events.
 */
export interface TmuxState {
  sessions: Map<string, TmuxSessionState>;
  windows: Map<string, TmuxWindow>;
  panes: Map<string, TmuxPane>;
  underlays: Map<number, TmuxUnderlayState>;
}

/**
 * Event emitted by the Rust backend when the tmux underlay poller produces a
 * new state snapshot.
 */
export interface TmuxStateSyncEvent {
  type: "StateSync";
  snapshot: TmuxStateSnapshot;
}

/**
 * Event emitted by the Rust backend when the tmux underlay connection fails.
 */
export interface TmuxConnectionErrorEvent {
  type: "ConnectionError";
  message: string;
}

/**
 * Metadata returned by `list-windows`.
 */
export interface TmuxWindowListEntry {
  windowId: string;
  sessionId: string;
  name: string;
  active: boolean;
  layout: string;
}

/**
 * Metadata returned by `list-panes`.
 */
export interface TmuxPaneListEntry {
  paneId: string;
  windowId: string;
  sessionId: string;
  title: string;
  active: boolean;
  width: number;
  height: number;
}
