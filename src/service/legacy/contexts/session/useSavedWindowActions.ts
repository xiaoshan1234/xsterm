/**
 * Saved-window actions — thin wrappers around the use cases in
 * `src/app/useCases/`. Persistence lives in
 * `src/service/persistence/store.ts`; the use cases mutate it directly.
 */
import { useCallback } from "react";
import type { PersistedWindowConfig, Session, Window, Workspace } from "../../../../model";
import { saveWindow as saveWindowUseCase } from "../../../../app/useCases/saveWindow";
import { loadWindow as loadWindowUseCase } from "../../../../app/useCases/loadWindow";
import { deleteSavedWindow as deleteSavedWindowUseCase } from "../../../../app/useCases/deleteSavedWindow";
import { usePersistenceStore } from "../../../../service/persistence/store";
import { useWorkspaceStore } from "../../../../service/workspace/store";

interface PersistedWindowActionsHookDeps {
  savedWindowConfigs: PersistedWindowConfig[];
  workspacesRef: React.MutableRefObject<Workspace[]>;
  sessionsRef: React.MutableRefObject<Session[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setSavedWindowConfigs: React.Dispatch<React.SetStateAction<PersistedWindowConfig[]>>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  persistSavedWindowConfigs: (data: PersistedWindowConfig[]) => void;
  openFromConfigInternal: (configId: string) => Promise<Session>;
}

export function useSavedWindowActions(_deps: PersistedWindowActionsHookDeps) {
  const saveWindow = useCallback(
    (workspaceId: string, windowId: string, name: string) =>
      saveWindowUseCase(workspaceId, windowId, name),
    [],
  );

  /**
   * saveAllWindows — snapshot every window in the given workspace to
   * the persistence store. Loops through the workspace store and calls
   * `saveWindow` for each window.
   */
  const saveAllWindows = useCallback((workspaceId: string) => {
    const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
    if (!ws) return;
    ws.windows.forEach((win) => saveWindowUseCase(workspaceId, win.id, win.name));
  }, []);

  const loadWindow = useCallback(
    (savedWindowId: string, workspaceId?: string): Promise<Window> =>
      loadWindowUseCase(savedWindowId, workspaceId),
    [],
  );

  const deleteSavedWindow = useCallback((id: string) => deleteSavedWindowUseCase(id), []);

  /**
   * renameSavedWindow — direct mutation of the persistence store. There
   * is no dedicated use case for this (it's a one-liner that just calls
   * the store action), so we route through the store directly to avoid
   * creating a single-use use case file.
   */
  const renameSavedWindow = useCallback((id: string, name: string) => {
    usePersistenceStore.getState().renameSavedWindowConfig(id, name);
  }, []);

  return {
    saveWindow,
    saveAllWindows,
    loadWindow,
    deleteSavedWindow,
    renameSavedWindow,
  };
}
