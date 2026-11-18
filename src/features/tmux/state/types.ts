import type { TmuxSessionConfig } from "../../../features/launch-config";

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
