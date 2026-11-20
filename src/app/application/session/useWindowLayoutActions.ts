import { useCallback } from "react";
import {
  createPaneId,
  createWindowId,
  type PaneId,
  type TerminalId,
  type WindowId,
  type WorkspaceId,
} from "../../../models";
import type { Terminal } from "../../../features/terminal";
import type {
  EditablePaneNode,
  PaneTerminalRef,
  Window,
  Workspace,
} from "../../../features/workspace";
import {
  assertSessionNotUsedElsewhere,
  createLeafPane,
  getDefaultWindowName,
  getUniqueWindowName,
  withRecomputedSessionIds,
} from "../../../features/workspace";

interface UseWindowLayoutActionsOptions {
  terminalsRef: React.MutableRefObject<Terminal[]>;
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setTerminals: React.Dispatch<React.SetStateAction<Terminal[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
}

export function useWindowLayoutActions({
  terminalsRef,
  workspacesRef,
  setTerminals,
  setWorkspaces,
}: UseWindowLayoutActionsOptions) {
  const createWindow = useCallback(
    (
      workspaceId: WorkspaceId,
      terminalId?: TerminalId,
      configId?: string,
      name?: string,
      windowType: "terminal" | "init" = "terminal",
    ): Window => {
      if (terminalId !== undefined) {
        assertSessionNotUsedElsewhere(workspacesRef.current, workspaceId, null, terminalId);
      }
      const rootPane = createLeafPane(100, terminalId, configId);
      const baseName =
        name ??
        getDefaultWindowName(
          rootPane,
          terminalsRef.current,
          windowType === "init" ? "New Terminal" : "Window",
        );
      const window: Window = {
        id: createWindowId(crypto.randomUUID()),
        name: baseName,
        rootPane,
        activePaneId: rootPane.id,
        windowType,
      };
      setWorkspaces((previous) => {
        const uniqueName = getUniqueWindowName(previous, workspaceId, baseName);
        const finalWindow: Window = { ...window, name: uniqueName };
        return previous.map((workspace) =>
          workspace.id === workspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                windows: [...workspace.windows, finalWindow],
                activeWindowId: finalWindow.id,
              })
            : workspace,
        );
      });
      return window;
    },
    [setWorkspaces, terminalsRef, workspacesRef],
  );

  const createInitWindow = useCallback((): Window => {
    const windowId = createWindowId(crypto.randomUUID());
    const paneId = createPaneId(crypto.randomUUID());
    return {
      id: windowId,
      name: "New Terminal",
      activePaneId: paneId,
      windowType: "init",
      rootPane: {
        id: paneId,
        type: "leaf",
        size: 100,
      },
    };
  }, []);

  const replaceInitWindowWithTerminal = useCallback(
    (workspaceId: WorkspaceId, windowId: WindowId, terminal: PaneTerminalRef) => {
      assertSessionNotUsedElsewhere(workspacesRef.current, workspaceId, windowId, terminal.id);
      const rootPane = createLeafPane(100, terminal.id, terminal.configId);
      setWorkspaces((previous) =>
        previous.map((workspace) => {
          if (workspace.id !== workspaceId) return workspace;
          const uniqueName = getUniqueWindowName(previous, workspaceId, terminal.name, windowId);
          return withRecomputedSessionIds({
            ...workspace,
            windows: workspace.windows.map((window) =>
              window.id === windowId
                ? {
                    ...window,
                    name: uniqueName,
                    rootPane,
                    activePaneId: rootPane.id,
                    windowType: "terminal",
                  }
                : window,
            ),
          });
        }),
      );
    },
    [setWorkspaces, workspacesRef],
  );

  const reorderWindows = useCallback(
    (workspaceId: WorkspaceId, fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
      setWorkspaces((previous) =>
        previous.map((workspace) => {
          if (workspace.id !== workspaceId) return workspace;
          const windows = [...workspace.windows];
          if (fromIndex >= windows.length || toIndex >= windows.length) return workspace;
          const [moved] = windows.splice(fromIndex, 1);
          windows.splice(toIndex, 0, moved);
          return { ...workspace, windows };
        }),
      );
    },
    [setWorkspaces],
  );

  const setActiveWindow = useCallback(
    (workspaceId: WorkspaceId, windowId: WindowId) => {
      setWorkspaces((previous) =>
        previous.map((workspace) =>
          workspace.id === workspaceId ? { ...workspace, activeWindowId: windowId } : workspace,
        ),
      );
    },
    [setWorkspaces],
  );

  const setActivePane = useCallback(
    (workspaceId: WorkspaceId, windowId: WindowId, paneId: PaneId) => {
      setWorkspaces((previous) =>
        previous.map((workspace) =>
          workspace.id === workspaceId
            ? {
                ...workspace,
                activeWindowId: windowId,
                windows: workspace.windows.map((window) =>
                  window.id === windowId ? { ...window, activePaneId: paneId } : window,
                ),
              }
            : workspace,
        ),
      );

      const workspace = workspacesRef.current.find((candidate) => candidate.id === workspaceId);
      const window = workspace?.windows.find((candidate) => candidate.id === windowId);
      const terminalId = window ? findPaneSessionId(window.rootPane, paneId) : undefined;
      if (terminalId !== undefined) {
        const now = Date.now();
        setTerminals((previous) =>
          previous.map((terminal) =>
            terminal.id === terminalId ? { ...terminal, lastActivityAt: now } : terminal,
          ),
        );
      }
    },
    [setTerminals, setWorkspaces, workspacesRef],
  );

  const renameWindow = useCallback(
    (workspaceId: WorkspaceId, windowId: WindowId, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setWorkspaces((previous) =>
        previous.map((workspace) => {
          if (workspace.id !== workspaceId) return workspace;
          if (!workspace.windows.some((window) => window.id === windowId)) return workspace;
          const uniqueName = getUniqueWindowName(previous, workspaceId, trimmed, windowId);
          return {
            ...workspace,
            windows: workspace.windows.map((window) =>
              window.id === windowId ? { ...window, name: uniqueName } : window,
            ),
          };
        }),
      );
    },
    [setWorkspaces],
  );

  return {
    createWindow,
    createInitWindow,
    replaceInitWindowWithTerminal,
    reorderWindows,
    setActiveWindow,
    setActivePane,
    renameWindow,
  };
}

function findPaneSessionId(pane: EditablePaneNode, paneId: PaneId): TerminalId | undefined {
  if (pane.id === paneId) return pane.terminalId;
  return pane.children?.find((child) => findPaneSessionId(child, paneId))?.terminalId;
}
