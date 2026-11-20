import { useCallback } from "react";
import {
  createPaneId,
  createWindowId,
  createWorkspaceId,
  type TerminalId,
  type WorkspaceId,
} from "../../../models";
import type { Terminal } from "../../../features/terminal";
import type { Workspace } from "../../../features/workspace";
import { clearTerminalOutput } from "../../../features/terminal-surface";

interface UseWorkspaceActionsDeps {
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  setActiveWorkspaceId: React.Dispatch<React.SetStateAction<WorkspaceId | null>>;
  setTerminals: React.Dispatch<React.SetStateAction<Terminal[]>>;
  establishingTerminalsRef: React.MutableRefObject<Set<TerminalId>>;
  closeTerminal: (terminalId: TerminalId) => Promise<void>;
}

export function useWorkspaceActions(deps: UseWorkspaceActionsDeps) {
  const {
    workspacesRef,
    setWorkspaces,
    setActiveWorkspaceId,
    setTerminals,
    establishingTerminalsRef,
    closeTerminal,
  } = deps;

  const createDefaultWorkspace = useCallback((): Workspace => {
    const existingDefault = workspacesRef.current.find((w) => w.name === "default");
    if (existingDefault) {
      setActiveWorkspaceId(existingDefault.id);
      return existingDefault;
    }

    const workspaceId = createWorkspaceId(crypto.randomUUID());
    const windowId = createWindowId(crypto.randomUUID());
    const paneId = createPaneId(crypto.randomUUID());

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

    const workspaceId = createWorkspaceId(crypto.randomUUID());
    const windowId = createWindowId(crypto.randomUUID());
    const paneId = createPaneId(crypto.randomUUID());
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
    (workspaceId: WorkspaceId) => {
      setActiveWorkspaceId(workspaceId);
    },
    [setActiveWorkspaceId],
  );

  const closeWorkspace = useCallback(
    (workspaceId: WorkspaceId) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!workspace || workspace.name === "default") return;

      if (workspace.terminalIds.length > 0) {
        const idsToClose = new Set(workspace.terminalIds);
        idsToClose.forEach((terminalId) => {
          closeTerminal(terminalId).catch((e) => console.error("Failed to close terminal:", e));
          establishingTerminalsRef.current.delete(terminalId);
          clearTerminalOutput(terminalId);
        });
        setTerminals((prev) => prev.filter((s) => !idsToClose.has(s.id)));
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
    [
      setWorkspaces,
      setActiveWorkspaceId,
      workspacesRef,
      setTerminals,
      establishingTerminalsRef,
      closeTerminal,
    ],
  );

  return {
    createDefaultWorkspace,
    createEmptyWorkspace,
    setActiveWorkspace,
    closeWorkspace,
  };
}
