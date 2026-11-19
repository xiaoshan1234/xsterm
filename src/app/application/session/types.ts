import type {
  LaunchConfigState,
  SavedLaunchConfigsContextType,
  SavedTerminalConfig,
  TerminalGroup,
} from "../../../features/launch-config";
import type {
  SessionPreferencesContextType,
  TerminalPreferencesState,
} from "../../../features/settings";
import type { TerminalRuntimeContextType, TerminalSessionState } from "../../../features/terminal";
import type { TmuxRuntimeState } from "../../../features/tmux";
import type {
  SavedWindowConfig,
  SavedWorkspace,
  WorkspaceLayoutContextType,
  WorkspaceState,
} from "../../../features/workspace";

export type {
  SavedLaunchConfigsContextType,
  SessionPreferencesContextType,
  TerminalRuntimeContextType,
  WorkspaceLayoutContextType,
};

export interface SessionState {
  launchConfig: LaunchConfigState;
  terminal: TerminalSessionState;
  tmux: TmuxRuntimeState;
  workspace: WorkspaceState;
  preferences: TerminalPreferencesState;
}

export interface SessionPersistence {
  updateConfigs: (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
  updateGroups: (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => void;
  persistSavedWorkspaces: (workspacesData: SavedWorkspace[]) => void;
  persistSavedWindowConfigs: (windowConfigs: SavedWindowConfig[]) => void;
}
