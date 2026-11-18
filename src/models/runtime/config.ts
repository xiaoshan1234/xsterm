import { type CapabilityFlags } from "./capabilities";

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

export type TerminalInfoKind =
  | { type: "local"; shell: string; cwd: string }
  | { type: "ssh"; host: string; port: number; user: string }
  | { type: "wsl"; distribution?: string }
  | { type: "tmux-pane"; sessionId: number; paneId: string };

export type TerminalKind = TerminalInfoKind;

export interface LocalTerminalConfig {
  name?: string;
  shellTemplate?: "powershell" | "cmd" | "git-bash" | "wsl" | "custom";
  shell?: string;
  cwd?: string;
  args?: string[];
  termType?: string;
  charset?: string;
  startupCommand?: string;
  startupDelayMs?: number;
  envConfig?: TerminalEnvConfig;
  initialCols?: number;
  initialRows?: number;
}

export interface SshConfig {
  name?: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "key";
  password?: string;
  key_file?: string;
  passphrase?: string;
  termType?: string;
  initialRows?: number;
  initialCols?: number;
  keepaliveInterval?: number;
  connectionTimeout?: number;
  tcpNoDelay?: boolean;
  soKeepalive?: boolean;
  nullPacketKeepalive?: boolean;
  charset?: string;
  enableCompression?: boolean;
  knownHostsPath?: string;
  proxyJump?: string;
}

export interface TerminalDisplayConfig {
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: "block" | "underline" | "bar";
  cursorBlink?: boolean;
  scrollback?: number;
  lineHeight?: number;
  letterSpacing?: number;
  cursorWidth?: number;
  lineTimestamp?: boolean;
  timeFormat?: string;
  dateTimeFormat?: string;
  lineNumberEnabled?: boolean;
  autoWrap?: boolean;
  reverseVideo?: boolean;
  mouseWheelScrollLines?: number;
  syncRemoteTitle?: boolean;
  sizingMode?: "auto" | "fixed";
  cols?: number;
  rows?: number;
  backspaceSends?: "auto" | "backspace" | "delete";
  deleteSends?: "auto" | "backspace" | "delete";
  lineFeedMode?: boolean;
  cursorKeyMode?: "normal" | "application";
  keypadMode?: "normal" | "application";
  modifyOtherKeysFormat?: "xterm" | "fixterm";
  altSendsEscape?: boolean;
  wordSeparatorChars?: string;
  altScreenWordSeparatorChars?: string;
  clipboardRead?: "ask" | "allow" | "deny";
  clipboardWrite?: "ask" | "allow" | "deny";
  logging?: TerminalLoggingConfig;
  showSidebar?: boolean;
}

export interface TerminalLoggingConfig {
  enabled?: boolean;
  append?: boolean;
  fileNameTemplate?: string;
  maxSizeMb?: number;
  lineFormat?: string;
}

export interface TerminalEnvConfig {
  env?: Record<string, string>;
}
