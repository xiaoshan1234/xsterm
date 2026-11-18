import { type BackendTerminalHandle } from "./handles";

export interface TerminalCapabilitiesDto {
  supportsResize: boolean;
  supportsReconnect: boolean;
  supportsLocalEcho: boolean;
  supportsMultiplex: boolean;
}

export type TerminalKindDto =
  | {
      type: "local";
      shell: string;
      cwd: string;
    }
  | {
      type: "ssh";
      host: string;
      port: number;
      user: string;
    }
  | {
      type: "wsl";
      distribution?: string;
    }
  | {
      type: "tmux-pane";
      sessionId: number;
      paneId: string;
    };

export interface TerminalInfoDto {
  id: BackendTerminalHandle;
  name: string;
  kind: TerminalKindDto;
  isConnected: boolean;
  capabilities: TerminalCapabilitiesDto;
  tmuxWindowId?: string;
  tmuxSessionName?: string;
  isHidden?: boolean;
}

export interface SshConfigDto {
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
