import type {
  PersistedWindowConfig,
  PersistedWorkspace,
  Session,
  Workspace,
} from "../../../../model";
import { useSavedWindowActions } from "./useSavedWindowActions";
import { useSavedWorkspaceActions } from "./useSavedWorkspaceActions";

interface PersistenceActionsHookDeps {
  savedWorkspaces: PersistedWorkspace[];
  savedWindowConfigs: PersistedWindowConfig[];
  workspacesRef: React.MutableRefObject<Workspace[]>;
  sessionsRef: React.MutableRefObject<Session[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string | null>>;
  setSavedWorkspaces: React.Dispatch<React.SetStateAction<PersistedWorkspace[]>>;
  setSavedWindowConfigs: React.Dispatch<React.SetStateAction<PersistedWindowConfig[]>>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  persistSavedWorkspaces: (workspacesData: PersistedWorkspace[]) => void;
  persistSavedWindowConfigs: (windowConfigs: PersistedWindowConfig[]) => void;
  openFromConfigInternal: (configId: string) => Promise<Session>;
}

export function usePersistenceActions(deps: PersistenceActionsHookDeps) {
  const workspaces = useSavedWorkspaceActions(deps);
  const windows = useSavedWindowActions(deps);

  return {
    ...workspaces,
    ...windows,
  };
}
