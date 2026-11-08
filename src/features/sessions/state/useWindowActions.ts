import { useCallback } from "react";
import * as terminalService from "../../../services/terminalService";
import type {
  PaneNode,
  SavedTerminalConfig,
  Terminal,
  Window,
  Workspace,
} from "../../../types/terminal";
import { clearTerminalOutput } from "../../../shared/utils/terminalOutputBuffer";

function findPaneSessionId(pane: PaneNode, paneId: string): number | undefined {
  if (pane.id === paneId) return pane.terminalId;
  return pane.children?.find((c) => findPaneSessionId(c, paneId))?.terminalId;
}
import {
  createLeafPane,
  forEachPane,
  getDefaultWindowName,
  withRecomputedSessionIds,
} from "./paneUtils";
import { assertSessionNotUsedElsewhere, getUniqueWindowName } from "./useTerminalActions.helpers";

interface UseWindowActionsDeps {
  savedConfigs: SavedTerminalConfig[];
  terminalsRef: React.MutableRefObject<Terminal[]>;
  workspacesRef: React.MutableRefObject<Workspace[]>;
  activeWorkspaceId: string | null;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  createTerminalFromSavedConfig: (configId: string) => Promise<Terminal>;
  createWindowFromSession: (
    terminalId: number,
    configId: string,
    name?: string,
    targetWorkspaceId?: string,
  ) => Window;
}

export function useWindowActions(deps: UseWindowActionsDeps) {
  const {
    savedConfigs,
    terminalsRef,
    workspacesRef,
    activeWorkspaceId,
    setSessions,
    setWorkspaces,
    establishingSessionsRef,
    createTerminalFromSavedConfig,
    createWindowFromSession,
  } = deps;

  const createWindowFromSavedConfig = useCallback(
    async (configId: string, name?: string): Promise<Window> => {
      const config = savedConfigs.find((c) => c.id === configId);
      if (!config) throw new Error("Config not found");

      const terminal = await createTerminalFromSavedConfig(configId);
      assertSessionNotUsedElsewhere(workspacesRef.current, null, null, terminal.id);
      return createWindowFromSession(
        terminal.id,
        terminal.configId,
        name ?? config.name,
        activeWorkspaceId ?? undefined,
      );
    },
    [
      savedConfigs,
      createTerminalFromSavedConfig,
      createWindowFromSession,
      workspacesRef,
      activeWorkspaceId,
    ],
  );

  const createWindow = useCallback(
    (
      workspaceId: string,
      terminalId?: number,
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
        id: crypto.randomUUID(),
        name: baseName,
        rootPane,
        activePaneId: rootPane.id,
        windowType,
      };
      setWorkspaces((prev) => {
        const uniqueName = getUniqueWindowName(prev, workspaceId, baseName);
        const finalWindow: Window = { ...window, name: uniqueName };
        return prev.map((workspace) =>
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
    [terminalsRef, workspacesRef, setWorkspaces],
  );

  const createInitWindow = useCallback((): Window => {
    const windowId = crypto.randomUUID();
    const paneId = crypto.randomUUID();
    const window: Window = {
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
    return window;
  }, []);

  const replaceInitWindowWithTerminal = useCallback(
    (workspaceId: string, windowId: string, terminal: Terminal) => {
      assertSessionNotUsedElsewhere(workspacesRef.current, workspaceId, windowId, terminal.id);
      const rootPane = createLeafPane(100, terminal.id, terminal.configId);
      const baseName = terminal.name;
      setWorkspaces((prev) =>
        prev.map((workspace) => {
          if (workspace.id !== workspaceId) return workspace;
          const uniqueName = getUniqueWindowName(prev, workspaceId, baseName, windowId);
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
    [workspacesRef, setWorkspaces],
  );

  const closeWindow = useCallback(
    (workspaceId: string, windowId: string) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      const window = workspace?.windows.find((w) => w.id === windowId);
      if (!window) return;

      const terminalIdsToClose = new Set<number>();
      forEachPane(window.rootPane, (node) => {
        if (node.type === "leaf" && node.terminalId !== undefined) {
          terminalIdsToClose.add(node.terminalId);
        }
      });

      setWorkspaces((prev) =>
        prev.map((workspace) => {
          if (workspace.id !== workspaceId) return workspace;
          const remaining = workspace.windows.filter((w) => w.id !== windowId);
          let nextActiveId = workspace.activeWindowId;
          let windows = remaining;
          if (remaining.length === 0) {
            const initWindow = createInitWindow();
            const uniqueName = getUniqueWindowName(prev, workspaceId, initWindow.name);
            windows = [{ ...initWindow, name: uniqueName }];
            nextActiveId = windows[0].id;
          } else if (nextActiveId === windowId) {
            const closedIndex = workspace.windows.findIndex((w) => w.id === windowId);
            const fallback =
              remaining[closedIndex - 1] ??
              remaining[closedIndex] ??
              remaining[remaining.length - 1];
            nextActiveId = fallback?.id ?? null;
          }
          return withRecomputedSessionIds({ ...workspace, windows, activeWindowId: nextActiveId });
        }),
      );

      terminalIdsToClose.forEach((terminalId) => {
        terminalService
          .closeTerminal(terminalId)
          .catch((e) => console.error("Failed to close terminal:", e));
        establishingSessionsRef.current.delete(terminalId);
        clearTerminalOutput(terminalId);
      });
      if (terminalIdsToClose.size > 0) {
        setSessions((prev) => prev.filter((s) => !terminalIdsToClose.has(s.id)));
      }
    },
    [workspacesRef, setWorkspaces, setSessions, establishingSessionsRef],
  );

  const reorderWindows = useCallback(
    (workspaceId: string, fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      if (fromIndex < 0 || toIndex < 0) return;
      setWorkspaces((prev) =>
        prev.map((workspace) => {
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
    (workspaceId: string, windowId: string) => {
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === workspaceId ? { ...workspace, activeWindowId: windowId } : workspace,
        ),
      );
    },
    [setWorkspaces],
  );

  const setActivePane = useCallback(
    (workspaceId: string, windowId: string, paneId: string) => {
      setWorkspaces((prev) =>
        prev.map((workspace) =>
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

      const ws = workspacesRef.current.find((w) => w.id === workspaceId);
      const win = ws?.windows.find((w) => w.id === windowId);
      const targetSessionId = win ? findPaneSessionId(win.rootPane, paneId) : undefined;
      if (targetSessionId !== undefined) {
        const now = Date.now();
        setSessions((prev) =>
          prev.map((s) => (s.id === targetSessionId ? { ...s, lastActivityAt: now } : s)),
        );
      }
    },
    [setWorkspaces, setSessions, workspacesRef],
  );

  const renameWindow = useCallback(
    (workspaceId: string, windowId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setWorkspaces((prev) =>
        prev.map((workspace) => {
          if (workspace.id !== workspaceId) return workspace;
          const window = workspace.windows.find((w) => w.id === windowId);
          if (!window) return workspace;
          const uniqueName = getUniqueWindowName(prev, workspaceId, trimmed, windowId);
          return {
            ...workspace,
            windows: workspace.windows.map((w) =>
              w.id === windowId ? { ...w, name: uniqueName } : w,
            ),
          };
        }),
      );
    },
    [setWorkspaces],
  );

  return {
    createWindowFromSavedConfig,
    createWindow,
    createInitWindow,
    replaceInitWindowWithTerminal,
    closeWindow,
    reorderWindows,
    setActiveWindow,
    setActivePane,
    renameWindow,
  };
}
