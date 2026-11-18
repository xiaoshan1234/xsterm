import { type MutableRefObject } from "react";
import type {
  LocalTerminalConfig,
  SshConfig,
  Terminal,
  TerminalDisplayConfig,
} from "../../models/runtime/config";
import type { TmuxSessionConfig } from "../../models/tmux/TmuxSessionConfig";
import { type OpenTmuxSession, type TmuxControllerError } from "../tmux";

export type { TerminalConnectionInfo } from "../terminal-stream";

export interface TerminalRuntimeContextType {
  terminals: Terminal[];
  openTmuxSessions: readonly OpenTmuxSession[];
  terminalSizesRef: MutableRefObject<Map<number, { rows: number; cols: number }>>;
  terminalSizesVersion: number;
  getEffectiveLocalEcho: (terminalId: number) => boolean;
  tmuxControllerErrors: Map<number, TmuxControllerError>;
  createLocalSession: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSession: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  createLocalSessionOnly: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSessionOnly: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  createTmuxSession: (config: TmuxSessionConfig, save?: boolean) => Promise<Terminal>;
  attachTmuxSession: (config: TmuxSessionConfig, save?: boolean) => Promise<Terminal>;
  detachTmuxSession: (controllerId: number) => Promise<void>;
  reconnectTmuxSession: (controllerId: number) => Promise<Terminal>;
  openFromConfig: (configId: string) => Promise<Terminal>;
  createTerminalFromSavedConfig: (configId: string) => Promise<Terminal>;
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
  dismissTmuxControllerError: (controllerId: number) => void;
}
