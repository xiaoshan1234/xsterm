import { type LocalTerminalConfig, type SshConfig } from "./connection";
import { type TerminalDisplayConfig } from "./display";
import { type SavedTerminalConfig, type TerminalGroup } from "./saved";
import { type TmuxSessionConfig } from "./tmux";

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
