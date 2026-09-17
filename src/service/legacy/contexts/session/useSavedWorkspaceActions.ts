/**
 * Saved-workspace actions — thin wrappers around the use cases in
 * `src/app/useCases/`. Persistence lives in
 * `src/service/persistence/store.ts`; the use cases mutate it directly.
 *
 * The legacy hook carried a rollback path for in-flight rebuilds
 * (`createRollback` helper) — that logic now lives inside the
 * `loadWorkspace` use case. This hook is purely the surface adapter.
 */
import { useCallback } from "react";
import type {
  SavedWorkspace,
  Session,
  Workspace,
} from "../../../../model/entities";
import { saveWorkspace as saveWorkspaceUseCase } from "../../../../app/useCases/saveWorkspace";
import { loadWorkspace as loadWorkspaceUseCase } from "../../../../app/useCases/loadWorkspace";
import { deleteSavedWorkspace as deleteSavedWorkspaceUseCase } from "../../../../app/useCases/deleteSavedWorkspace";
import { renameSavedWorkspace as renameSavedWorkspaceUseCase } from "../../../../app/useCases/renameSavedWorkspace";

interface UseSavedWorkspaceActionsDeps {
  savedWorkspaces: SavedWorkspace[];
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string | null>>;
  setSavedWorkspaces: React.Dispatch<React.SetStateAction<SavedWorkspace[]>>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  persistSavedWorkspaces: (data: SavedWorkspace[]) => void;
  openFromConfigInternal: (configId: string) => Promise<Session>;
}

export function useSavedWorkspaceActions(_deps: UseSavedWorkspaceActionsDeps) {
  const saveWorkspace = useCallback(
    (workspaceId: string, name: string) => saveWorkspaceUseCase(workspaceId, name),
    [],
  );

  const loadWorkspace = useCallback(
    (savedWorkspaceId: string): Promise<Workspace> => loadWorkspaceUseCase(savedWorkspaceId),
    [],
  );

  const deleteSavedWorkspace = useCallback(
    (id: string) => deleteSavedWorkspaceUseCase(id),
    [],
  );

  const renameSavedWorkspace = useCallback(
    (id: string, name: string) => renameSavedWorkspaceUseCase(id, name),
    [],
  );

  return {
    saveWorkspace,
    loadWorkspace,
    deleteSavedWorkspace,
    renameSavedWorkspace,
  };
}