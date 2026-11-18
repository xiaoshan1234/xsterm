import { type BackendTerminalHandle } from "../../terminal-stream/adapterContracts";

export type {
  SshConfigDto,
  TerminalCapabilitiesDto,
  TerminalInfoDto,
  TerminalKindDto,
} from "../../terminal-stream/adapterContracts";

export interface LocalTerminalConfigDto {
  name?: string;
  shell?: string;
  cwd?: string;
  args?: string[];
  envConfig?: {
    env?: Record<string, string>;
  };
  shellTemplate?: "powershell" | "cmd" | "git-bash" | "wsl" | "custom";
  termType?: string;
  charset?: string;
  startupCommand?: string;
  startupDelayMs?: number;
  initialRows?: number;
  initialCols?: number;
}

export interface TerminalLoggingConfigDto {
  enabled?: boolean;
  append?: boolean;
  fileNameTemplate?: string;
  maxSizeMb?: number;
  lineFormat?: string;
}

export interface TerminalOutputEvent {
  terminalHandle: BackendTerminalHandle;
  data: Uint8Array;
}

export interface TerminalDisconnectedEvent {
  terminalHandle: BackendTerminalHandle;
}

export interface TerminalClosedEvent {
  terminalHandle: BackendTerminalHandle;
}
