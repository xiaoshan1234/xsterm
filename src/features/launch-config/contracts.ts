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

export interface TerminalEnvConfig {
  env?: Record<string, string>;
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

export interface TmuxSessionConfig {
  name?: string;
  baseConfigId?: string;
  tmuxSessionName?: string;
  socketName?: string;
  startCommand?: string;
  envConfig?: TerminalEnvConfig;
  initialRows?: number;
  initialCols?: number;
  transport?: "local" | "wsl";
  wslDistribution?: string;
  ssh?: SshConfig;
}

export type SavedTerminalKind =
  | { type: "local"; config: LocalTerminalConfig }
  | { type: "ssh"; config: SshConfig }
  | { type: "tmux-pane"; config: TmuxSessionConfig };

export type SavedTerminalConfig = ({
  id: string;
  name: string;
  version: number;
} & SavedTerminalKind) & {
  displayConfig?: TerminalDisplayConfig;
};

export interface TerminalGroup {
  id: number;
  name: string;
  configIds: string[];
  collapsed: boolean;
}

export interface SavedLaunchConfigsContextType {
  savedConfigs: SavedTerminalConfig[];
  groups: TerminalGroup[];
  saveConfigOnly: (
    type: "local" | "ssh" | "wsl" | "tmux-pane",
    config: LocalTerminalConfig | SshConfig | TmuxSessionConfig,
    displayConfig?: TerminalDisplayConfig,
  ) => SavedTerminalConfig;
  removeConfig: (configId: string) => void;
  addToGroup: (groupId: number, configId: string) => void;
  removeFromGroup: (groupId: number, configId: string) => void;
  moveConfigToGroup: (configId: string, groupId: number | null) => void;
  createGroup: (name: string) => void;
  deleteGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  updateConfig: (config: SavedTerminalConfig) => void;
  toggleGroup: (id: number) => void;
}
