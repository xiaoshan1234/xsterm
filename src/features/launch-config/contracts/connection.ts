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

export interface CreatedTerminalRef {
  id: number;
  configId: string;
  name: string;
}
