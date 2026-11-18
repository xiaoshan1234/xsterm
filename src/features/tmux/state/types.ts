import type { TmuxSessionConfig } from "../../../models/tmux/TmuxSessionConfig";

export interface TmuxControllerError {
  config: TmuxSessionConfig;
  reason?: string;
  timestamp: number;
}

export interface OpenTmuxSession {
  controllerId: number;
  configId?: string;
  config: TmuxSessionConfig;
}
