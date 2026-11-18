import { type LocalTerminalConfig, type SshConfig, type TerminalDisplayConfig } from "./config";
import { type TmuxSessionConfig } from "./tmux";

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
