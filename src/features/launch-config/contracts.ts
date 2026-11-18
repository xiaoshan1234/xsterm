import {
  type LocalTerminalConfig,
  type SavedTerminalConfig,
  type SshConfig,
  type Terminal,
  type TerminalDisplayConfig,
  type TerminalGroup,
  type TmuxSessionConfig,
} from "../../models/runtime/terminal";

export interface SavedLaunchConfigsContextType {
  savedConfigs: SavedTerminalConfig[];
  groups: TerminalGroup[];
  saveConfigOnly: (
    type: Terminal["type"],
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
