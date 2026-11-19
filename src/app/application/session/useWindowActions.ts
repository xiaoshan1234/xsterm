import { useCallback } from "react";
import { createApplicationError } from "../../../models/applicationError";
import {
  createPaneId,
  createWindowId,
  type PaneId,
  type TerminalId,
  type WindowId,
  type WorkspaceId,
} from "../../../models";
import type { Terminal } from "../../../features/terminal";
import type { PaneTerminalRef } from "../../../features/workspace";
import type { EditablePaneNode } from "../../../features/workspace";
import type { SavedTerminalConfig } from "../../../features/launch-config";
import type { Window, Workspace } from "../../../features/workspace";
import { clearTerminalOutput } from "../../../features/terminal-surface";

function findPaneSessionId(pane: EditablePaneNode, paneId: PaneId): TerminalId | undefined {
  if (pane.id === paneId) return pane.terminalId;
  return pane.children?.find((c) => findPaneSessionId(c, paneId))?.terminalId;
}
import {
  assertSessionNotUsedElsewhere,
  createLeafPane,
  forEachPane,
  getDefaultWindowName,
  getUniqueWindowName,
  withRecomputedSessionIds,
} from "../../../features/workspace";

interface UseWindowActionsDeps {
  savedConfigs: SavedTerminalConfig[];
  terminalsRef: React.MutableRefObject<Terminal[]>;
  workspacesRef: React.MutableRefObject<Workspace[]>;
  activeWorkspaceId: WorkspaceId | null;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<TerminalId>>;
  createTerminalFromSavedConfig: (configId: string) => Promise<Terminal>;
  closeTerminal: (terminalId: TerminalId) => Promise<void>;
  killTmuxWindow: (xstermWindowId: number) => Promise<void>;
  createWindowFromSession: (
    terminalId: TerminalId,
    configId: string,
    name?: string,
    targetWorkspaceId?: WorkspaceId,
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
    closeTerminal,
    killTmuxWindow,
    createWindowFromSession,
  } = deps;

  const createWindowFromSavedConfig = useCallback(
    async (configId: string, name?: string): Promise<Window> => {
      const config = savedConfigs.find((c) => c.id === configId);
      if (!config) throw createApplicationError("not-found", "Config not found");

      const terminal = await createTerminalFromSavedConfig(configId);
      if (config.type === "tmux-pane") {
        // tmux attach is event-driven; the listeners create the real
        // windows. Return a lightweight placeholder for callers that expect
        // a `Window` without inserting it into workspace state.
        const rootPane = createLeafPane(100, terminal.id, terminal.configId);
        return {
          id: createWindowId(crypto.randomUUID()),
          name: name ?? config.name,
          rootPane,
          activePaneId: rootPane.id,
          windowType: "terminal" as const,
        };
      }
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
    const windowId = createWindowId(crypto.randomUUID());
    const paneId = createPaneId(crypto.randomUUID());
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
    (workspaceId: WorkspaceId, windowId: WindowId, terminal: PaneTerminalRef) => {
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
    (workspaceId: WorkspaceId, windowId: WindowId) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      const window = workspace?.windows.find((w) => w.id === windowId);
      if (!window) return;
      const tmuxWindowId = window.xstermWindowId;
      const isTmuxWindow = tmuxWindowId !== undefined;
      if (tmuxWindowId !== undefined) {
        killTmuxWindow(tmuxWindowId).catch((e) => console.error("Failed to kill tmux window:", e));
      }

      const terminalIdsToClose = new Set<TerminalId>();
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
        if (!isTmuxWindow) {
          closeTerminal(terminalId).catch((e) => console.error("Failed to close terminal:", e));
        }
        establishingSessionsRef.current.delete(terminalId);
        clearTerminalOutput(terminalId);
      });
      if (terminalIdsToClose.size > 0) {
        setSessions((prev) => prev.filter((s) => !terminalIdsToClose.has(s.id)));
      }
    },
    [
      workspacesRef,
      setWorkspaces,
      setSessions,
      establishingSessionsRef,
      createInitWindow,
      closeTerminal,
      killTmuxWindow,
    ],
  );

  const reorderWindows = useCallback(
    (workspaceId: WorkspaceId, fromIndex: number, toIndex: number) => {
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
    (workspaceId: WorkspaceId, windowId: WindowId) => {
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === workspaceId ? { ...workspace, activeWindowId: windowId } : workspace,
        ),
      );
    },
    [setWorkspaces],
  );

  const setActivePane = useCallback(
    (workspaceId: WorkspaceId, windowId: WindowId, paneId: PaneId) => {
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
    (workspaceId: WorkspaceId, windowId: WindowId, name: string) => {
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
