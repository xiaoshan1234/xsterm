import type { SavedWindowConfig, SavedWorkspace, Session, Workspace } from "../../types/session";
import { useSavedWindowActions } from "./useSavedWindowActions";
import { useSavedWorkspaceActions } from "./useSavedWorkspaceActions";

interface UsePersistenceActionsDeps {
  savedWorkspaces: SavedWorkspace[];
  savedWindowConfigs: SavedWindowConfig[];
  workspacesRef: React.MutableRefObject<Workspace[]>;
  sessionsRef: React.MutableRefObject<Session[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string | null>>;
  setSavedWorkspaces: React.Dispatch<React.SetStateAction<SavedWorkspace[]>>;
  setSavedWindowConfigs: React.Dispatch<React.SetStateAction<SavedWindowConfig[]>>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  persistSavedWorkspaces: (workspacesData: SavedWorkspace[]) => void;
  persistSavedWindowConfigs: (windowConfigs: SavedWindowConfig[]) => void;
  openFromConfigInternal: (configId: string) => Promise<Session>;
}

export function usePersistenceActions(deps: UsePersistenceActionsDeps) {
  const workspaces = useSavedWorkspaceActions(deps);
  const windows = useSavedWindowActions(deps);

  return {
    ...workspaces,
    ...windows,
  };
}
