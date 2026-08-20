import { useCallback } from "react";
import * as sessionService from "../../services/sessionService";
import type { Session, Workspace } from "../../types/session";
import { clearSessionOutput } from "../../utils/sessionOutputBuffer";

interface UseWorkspaceActionsDeps {
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string | null>>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
}

export function useWorkspaceActions(deps: UseWorkspaceActionsDeps) {
  const {
    workspacesRef,
    setWorkspaces,
    setActiveWorkspaceId,
    setSessions,
    establishingSessionsRef,
  } = deps;

  const createDefaultWorkspace = useCallback((): Workspace => {
    const existingDefault = workspacesRef.current.find((w) => w.name === "default");
    if (existingDefault) {
      setActiveWorkspaceId(existingDefault.id);
      return existingDefault;
    }

    const workspaceId = crypto.randomUUID();
    const windowId = crypto.randomUUID();
    const paneId = crypto.randomUUID();

    const workspace: Workspace = {
      id: workspaceId,
      name: "default",
      windows: [
        {
          id: windowId,
          name: "New Session",
          activePaneId: paneId,
          windowType: "init",
          rootPane: {
            id: paneId,
            type: "leaf",
            size: 100,
          },
        },
      ],
      activeWindowId: windowId,
      sessionIds: [],
    };

    setWorkspaces((prev) => [...prev, workspace]);
    setActiveWorkspaceId(workspaceId);
    return workspace;
  }, [setWorkspaces, setActiveWorkspaceId, workspacesRef]);

  const setActiveWorkspace = useCallback(
    (workspaceId: string) => {
      setActiveWorkspaceId(workspaceId);
    },
    [setActiveWorkspaceId],
  );

  const closeWorkspace = useCallback(
    (workspaceId: string) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!workspace || workspace.name === "default") return;

      if (workspace.sessionIds.length > 0) {
        const idsToClose = new Set(workspace.sessionIds);
        idsToClose.forEach((sessionId) => {
          sessionService
            .closeSession(sessionId)
            .catch((e) => console.error("Failed to close session:", e));
          establishingSessionsRef.current.delete(sessionId);
          clearSessionOutput(sessionId);
        });
        setSessions((prev) => prev.filter((s) => !idsToClose.has(s.id)));
      }
      setWorkspaces((prev) => prev.filter((w) => w.id !== workspaceId));
      setActiveWorkspaceId((current) => {
        if (current !== workspaceId) return current;
        const currentWorkspaces = workspacesRef.current;
        const closedIndex = currentWorkspaces.findIndex((w) => w.id === workspaceId);
        const remaining = currentWorkspaces.filter((w) => w.id !== workspaceId);
        const fallback =
          remaining[closedIndex - 1] ??
          remaining[closedIndex] ??
          remaining[remaining.length - 1] ??
          null;
        return fallback?.id ?? null;
      });
    },
    [setWorkspaces, setActiveWorkspaceId, workspacesRef, setSessions, establishingSessionsRef],
  );

  return {
    createDefaultWorkspace,
    setActiveWorkspace,
    closeWorkspace,
  };
}
