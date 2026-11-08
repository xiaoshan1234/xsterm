import { useCallback } from "react";
import * as terminalService from "../../../services/terminalService";
import type { Terminal, Workspace } from "../../../types/terminal";
import { clearTerminalOutput } from "../../../shared/utils/terminalOutputBuffer";

interface UseWorkspaceActionsDeps {
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<string | null>>;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
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
          name: "New Terminal",
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
      terminalIds: [],
    };

    setWorkspaces((prev) => [...prev, workspace]);
    setActiveWorkspaceId(workspaceId);
    return workspace;
  }, [setWorkspaces, setActiveWorkspaceId, workspacesRef]);

  const createEmptyWorkspace = useCallback((): Workspace => {
    const existingNames = new Set(workspacesRef.current.map((workspace) => workspace.name));
    let suffix = 1;
    let name = "New Workspace";
    while (existingNames.has(name)) {
      suffix += 1;
      name = `New Workspace ${suffix}`;
    }

    const workspaceId = crypto.randomUUID();
    const windowId = crypto.randomUUID();
    const paneId = crypto.randomUUID();
    const workspace: Workspace = {
      id: workspaceId,
      name,
      windows: [
        {
          id: windowId,
          name: "New Terminal",
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
      terminalIds: [],
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

      if (workspace.terminalIds.length > 0) {
        const idsToClose = new Set(workspace.terminalIds);
        idsToClose.forEach((terminalId) => {
          terminalService
            .closeTerminal(terminalId)
            .catch((e) => console.error("Failed to close terminal:", e));
          establishingSessionsRef.current.delete(terminalId);
          clearTerminalOutput(terminalId);
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
    createEmptyWorkspace,
    setActiveWorkspace,
    closeWorkspace,
  };
}
