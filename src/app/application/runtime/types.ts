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
import type { TerminalRuntimeContextType, TerminalState } from "../../../features/terminal";
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

export interface ApplicationState {
  launchConfig: LaunchConfigState;
  terminal: TerminalState;
  tmux: TmuxRuntimeState;
  workspace: WorkspaceState;
  preferences: TerminalPreferencesState;
}

export interface ApplicationPersistence {
  isLoaded: boolean;
  error: string | null;
  saveError: ApplicationPersistenceSaveError | null;
  clearSaveError: () => void;
  updateConfigs: (updater: (prev: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
  updateGroups: (updater: (prev: TerminalGroup[]) => TerminalGroup[], nextId?: number) => void;
  persistSavedWorkspaces: (workspacesData: SavedWorkspace[]) => void;
  persistSavedWindowConfigs: (windowConfigs: SavedWindowConfig[]) => void;
}

export interface ApplicationPersistenceSaveError {
  source: "launch-config" | "workspace" | "settings";
  operation: string;
  message: string;
}
