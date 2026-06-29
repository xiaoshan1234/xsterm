import type { SSHSessionConfig } from "./session";

/**
 * Configuration for creating a local tmux control-mode session.
 */
export interface TmuxSessionConfig {
  name?: string;
  socket?: string;
  command: string;
  target?: string;
}

/**
 * Configuration for creating an SSH tmux control-mode session.
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
 * Frontend snapshot of the tmux control-mode state.
 *
 * The tree is keyed by string identifiers so it can be updated incrementally
 * as `%` notifications arrive from tmux. Maps are used instead of plain
 * objects to preserve insertion order and to make lookups cheap while the
 * reducer applies events.
 */
export interface TmuxState {
  sessions: Map<string, TmuxSessionState>;
  windows: Map<string, TmuxWindow>;
  panes: Map<string, TmuxPane>;
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

/**
 * Discriminated union of tmux control-mode events produced by the Rust backend
 * and applied to the frontend TmuxState.
 */
export type TmuxControlEvent =
  | { type: "SessionChanged"; sessionId: string; name: string }
  | { type: "SessionRenamed"; name: string }
  | { type: "WindowAdded"; window: TmuxWindow }
  | { type: "WindowClosed"; windowId: string }
  | { type: "WindowRenamed"; windowId: string; name: string }
  | { type: "WindowActivated"; windowId: string }
  | { type: "LayoutChanged"; windowId: string; layout: string }
  | { type: "PaneAdded"; pane: TmuxPane }
  | { type: "PaneClosed"; paneId: string }
  | { type: "PaneTitleChanged"; paneId: string; title: string }
  | { type: "PaneModeChanged"; paneId: string; inCopyMode: boolean }
  | { type: "PanePaused"; paneId: string }
  | { type: "PaneContinued"; paneId: string }
  | { type: "WindowList"; windows: TmuxWindowListEntry[] }
  | { type: "PaneList"; panes: TmuxPaneListEntry[] }
  | { type: "CommandError"; cmdNum: number; message: string }
  | { type: "Exit"; reason?: string }
  | { type: "Unknown"; raw: string };
