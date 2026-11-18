import { type SshConfig, type TerminalEnvConfig } from "../launch/TerminalConnectionConfig";

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
