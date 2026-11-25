import type { TerminalId, TerminalProperties } from "../../models";
import type { LocalTerminalConfig, SshConfig } from "../launch-config";

export type { LocalTerminalConfig, SshConfig, TerminalDisplayConfig } from "../launch-config";
export type { TerminalLoggingConfig, TerminalProperties } from "../../models";

export interface CapabilityFlags {
  supportsResize: boolean;
  supportsReconnect: boolean;
  supportsLocalEcho: boolean;
  supportsMultiplex: boolean;
}

export type TerminalKind =
  | { type: "local"; shell: string; cwd: string }
  | { type: "ssh"; host: string; port: number; user: string }
  | { type: "wsl"; distribution?: string }
  | { type: "tmux-pane"; sessionId: number; paneId: string };

export interface TerminalBookmark {
  /** 0-indexed absolute scrollback line. */
  line: number;
  /** The line's text content at the moment it was bookmarked. */
  text: string;
}

export interface TmuxPaneRuntimeState {
  controllerId: number;
  paneId: string;
  windowId?: string;
  sessionName?: string;
  windowName?: string;
  windowIndex?: number;
  paneIndex?: number;
  width?: number;
  height?: number;
  command?: string;
  isActive?: boolean;
}

interface TerminalBase {
  id: TerminalId;
  configId: string;
  name: string;
  isConnected: boolean;
  /** Per-terminal settings, copied from the launch config when created. */
  properties: TerminalProperties;
  /** Bookmarked scrollback lines, kept sorted by absolute line. */
  bookmarks?: TerminalBookmark[];
  capabilities?: CapabilityFlags;
  createdAt?: number;
  lastActivityAt?: number;
  isHidden?: boolean;
}

export interface LocalTerminal extends TerminalBase {
  type: "local";
  kind: Extract<TerminalKind, { type: "local" }>;
}

export interface SshTerminal extends TerminalBase {
  type: "ssh";
  kind: Extract<TerminalKind, { type: "ssh" }>;
}

export interface WslTerminal extends TerminalBase {
  type: "wsl";
  kind: Extract<TerminalKind, { type: "wsl" }>;
}

export interface TmuxPaneTerminal extends TerminalBase {
  type: "tmux-pane";
  kind: Extract<TerminalKind, { type: "tmux-pane" }>;
  tmux: TmuxPaneRuntimeState;
}

export type Terminal = LocalTerminal | SshTerminal | WslTerminal | TmuxPaneTerminal;

export function isTmuxPaneTerminal(terminal: Terminal): terminal is TmuxPaneTerminal {
  return terminal.type === "tmux-pane";
}

export type { TerminalConnectionInfo } from "../terminal-stream";

export interface TerminalRuntimeContextType {
  terminals: Terminal[];
  terminalSizesVersion: number;
  getTerminalSize: (terminalId: TerminalId) => { rows: number; cols: number } | undefined;
  getEffectiveLocalEcho: (terminalId: TerminalId) => boolean;
  createLocalSession: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSession: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  createLocalSessionOnly: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSessionOnly: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  closeTerminal: (id: TerminalId) => Promise<void>;
  reconnectSession: (id: TerminalId) => Promise<Terminal>;
  renameSession: (id: TerminalId, name: string) => void;
  writeTerminal: (id: TerminalId, data: string) => Promise<void>;
  resizeTerminal: (id: TerminalId, rows: number, cols: number) => Promise<void>;
  uploadImageToSshTerminal: (
    terminalId: TerminalId,
    filename: string,
    data: Uint8Array,
  ) => Promise<string>;
  reportTerminalSize: (terminalId: TerminalId, rows: number, cols: number) => void;
  updateTerminalProperties: (id: TerminalId, patch: Partial<TerminalProperties>) => void;
  toggleBookmark: (id: TerminalId, line: number, text: string) => void;
  removeBookmark: (id: TerminalId, line: number) => void;
  clearBookmarks: (id: TerminalId) => void;
  touchTerminalActivity: (id: TerminalId) => void;
}
