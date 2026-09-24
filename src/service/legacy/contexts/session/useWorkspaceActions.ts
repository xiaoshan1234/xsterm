/**
 * Workspace actions — thin wrapper hook that delegates to the use cases
 * in `src/app/useCases/`. State lives in `src/service/workspace/store.ts`
 * and `src/service/session/store.ts`; the use cases mutate it directly.
 *
 * The legacy hook also exported `createDefaultWorkspace` which the
 * tmux-create flow uses to install the control-window + bootstrap pane
 * synchronously when no workspace exists yet. That logic now lives
 * inside `app/useCases/createTmuxSession.ts`; this hook just re-exports
 * the plain factory use case for the rest of the legacy surface.
 */
import { useCallback } from "react";
import type { Workspace, Session } from "../../../../model";
import {
  createDefaultWorkspace as createDefaultWorkspaceUseCase,
  createWorkspace as createWorkspaceUseCase,
} from "../../../../app/useCases/createWorkspace";
import { closeWorkspace as closeWorkspaceUseCase } from "../../../../app/useCases/closeWorkspace";
import { useWorkspaceStore } from "../../../../service/workspace/store";

interface WorkspaceActionsHookDeps {
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string | null>>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
}

export function useWorkspaceActions(_deps: WorkspaceActionsHookDeps) {
  const createDefaultWorkspace = useCallback(() => createDefaultWorkspaceUseCase(), []);
  // Legacy alias for `createWorkspace({variant:"fromSession", sessionId, configId, name})`.
  const createWorkspaceFromSession = useCallback(
    (sessionId: number, configId: string, name?: string) =>
      createWorkspaceUseCase({
        variant: "fromSession",
        sessionId,
        configId,
        name,
      }),
    [],
  );
  const setActiveWorkspace = useCallback(
    (workspaceId: string) => useWorkspaceStore.getState().setActiveWorkspace(workspaceId),
    [],
  );
  const closeWorkspace = useCallback(
    (workspaceId: string) => closeWorkspaceUseCase(workspaceId),
    [],
  );

  return {
    createDefaultWorkspace,
    createWorkspaceFromSession,
    setActiveWorkspace,
    closeWorkspace,
  };
}
