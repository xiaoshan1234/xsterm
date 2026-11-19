import type { Terminal } from "../../../features/terminal";
import type { TerminalId, WorkspaceId } from "../../../models";
import type { SavedWindowConfig, SavedWorkspace, Workspace } from "../contracts";
import { useSavedWindowActions } from "./useSavedWindowActions";
import { useSavedWorkspaceActions } from "./useSavedWorkspaceActions";

interface UsePersistenceActionsDeps {
  savedWorkspaces: SavedWorkspace[];
  savedWindowConfigs: SavedWindowConfig[];
  workspacesRef: React.MutableRefObject<Workspace[]>;
  terminalsRef: React.MutableRefObject<Terminal[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<WorkspaceId | null>>;
  setSavedWorkspaces: React.Dispatch<React.SetStateAction<SavedWorkspace[]>>;
  setSavedWindowConfigs: React.Dispatch<React.SetStateAction<SavedWindowConfig[]>>;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<TerminalId>>;
  persistSavedWorkspaces: (workspacesData: SavedWorkspace[]) => void;
  persistSavedWindowConfigs: (windowConfigs: SavedWindowConfig[]) => void;
  openFromConfigInternal: (configId: string) => Promise<Terminal>;
  closeTerminal: (terminalId: TerminalId) => Promise<void>;
}

export function usePersistenceActions(deps: UsePersistenceActionsDeps) {
  const workspaces = useSavedWorkspaceActions(deps);
  const windows = useSavedWindowActions(deps);

  return {
    ...workspaces,
    ...windows,
  };
}
