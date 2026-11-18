import type {
  LocalTerminalConfig,
  SshConfig,
  TerminalDisplayConfig,
} from "../launch-config/contracts";

export type {
  LocalTerminalConfig,
  SshConfig,
  TerminalDisplayConfig,
  TerminalLoggingConfig,
} from "../launch-config/contracts";

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

export interface Terminal {
  id: number;
  configId: string;
  name: string;
  type: "local" | "ssh" | "wsl" | "tmux-pane";
  isConnected: boolean;
  kind: TerminalKind;
  displayConfig?: TerminalDisplayConfig;
  capabilities?: CapabilityFlags;
  createdAt?: number;
  lastActivityAt?: number;
  tmuxPaneId?: string;
  tmuxSessionId?: number;
  tmuxWindowId?: string;
  tmuxSessionName?: string;
  tmuxWindowName?: string;
  tmuxWindowIndex?: number;
  tmuxPaneIndex?: number;
  tmuxPaneWidth?: number;
  tmuxPaneHeight?: number;
  tmuxPaneCommand?: string;
  tmuxPaneActive?: boolean;
  isHidden?: boolean;
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
