import type { Terminal } from "../../features/terminal";
import type { TmuxSessionConfig } from "../../features/launch-config";
import { type OpenTmuxSession, type TmuxControllerError } from "./state/types";

export interface TmuxRuntimeContextType {
  openTmuxSessions: readonly OpenTmuxSession[];
  tmuxControllerErrors: Map<number, TmuxControllerError>;
  createTmuxSession: (config: TmuxSessionConfig, save?: boolean) => Promise<Terminal>;
  attachTmuxSession: (config: TmuxSessionConfig, save?: boolean) => Promise<Terminal>;
  detachTmuxSession: (controllerId: number) => Promise<void>;
  reconnectTmuxSession: (controllerId: number) => Promise<Terminal>;
  createTmuxWindow: (controllerId: number) => Promise<void>;
  killTmuxWindow: (xstermWindowId: number) => Promise<void>;
  renameTmuxWindow: (xstermWindowId: number, name: string) => Promise<void>;
  resizeTmuxWindow: (controllerId: number, cols: number, rows: number) => Promise<void>;
  dismissTmuxControllerError: (controllerId: number) => void;
}
