import type { LocalTerminalConfig, SshConfig, TerminalDisplayConfig } from "../launch-config";

export type {
  LocalTerminalConfig,
  SshConfig,
  TerminalDisplayConfig,
  TerminalLoggingConfig,
} from "../launch-config";

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
  id: number;
  configId: string;
  name: string;
  isConnected: boolean;
  displayConfig?: TerminalDisplayConfig;
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
  getTerminalSize: (terminalId: number) => { rows: number; cols: number } | undefined;
  getEffectiveLocalEcho: (terminalId: number) => boolean;
  createLocalSession: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSession: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  createLocalSessionOnly: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSessionOnly: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  closeTerminal: (id: number) => Promise<void>;
  reconnectSession: (id: number) => Promise<Terminal>;
  renameSession: (id: number, name: string) => void;
  writeTerminal: (id: number, data: string) => Promise<void>;
  resizeTerminal: (id: number, rows: number, cols: number) => Promise<void>;
  uploadImageToSshTerminal: (
    terminalId: number,
    filename: string,
    data: Uint8Array,
  ) => Promise<string>;
  reportTerminalSize: (terminalId: number, rows: number, cols: number) => void;
  applyDisplayConfigToLiveSession: (id: number, patch: Partial<TerminalDisplayConfig>) => void;
  touchTerminalActivity: (id: number) => void;
}
