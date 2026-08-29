import { useCallback } from "react";
import * as sessionService from "../../services/sessionService";
import type { SavedSessionConfig, Session, Window, Workspace } from "../../types/session";
import { clearSessionOutput } from "../../utils/sessionOutputBuffer";
import {
  createLeafPane,
  forEachPane,
  getDefaultWindowName,
  withRecomputedSessionIds,
} from "./paneUtils";
import { assertSessionNotUsedElsewhere, getUniqueWindowName } from "./useSessionActions.helpers";

interface UseWindowActionsDeps {
  savedConfigs: SavedSessionConfig[];
  sessionsRef: React.MutableRefObject<Session[]>;
  workspacesRef: React.MutableRefObject<Workspace[]>;
  activeWorkspaceId: string | null;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  createSessionFromSavedConfig: (configId: string) => Promise<Session>;
  createWindowFromSession: (
    sessionId: number,
    configId: string,
    name?: string,
    targetWorkspaceId?: string,
  ) => Window;
}

export function useWindowActions(deps: UseWindowActionsDeps) {
  const {
    savedConfigs,
    sessionsRef,
    workspacesRef,
    activeWorkspaceId,
    setSessions,
    setWorkspaces,
    establishingSessionsRef,
    createSessionFromSavedConfig,
    createWindowFromSession,
  } = deps;

  const createWindowFromSavedConfig = useCallback(
    async (configId: string, name?: string): Promise<Window> => {
      const config = savedConfigs.find((c) => c.id === configId);
      if (!config) throw new Error("Config not found");

      const session = await createSessionFromSavedConfig(configId);
      assertSessionNotUsedElsewhere(workspacesRef.current, null, null, session.id);
      return createWindowFromSession(
        session.id,
        session.configId,
        name ?? config.name,
        activeWorkspaceId ?? undefined,
      );
    },
    [
      savedConfigs,
      createSessionFromSavedConfig,
      createWindowFromSession,
      workspacesRef,
      activeWorkspaceId,
    ],
  );

  const createWindow = useCallback(
    (
      workspaceId: string,
      sessionId?: number,
      configId?: string,
      name?: string,
      windowType: "terminal" | "init" = "terminal",
    ): Window => {
      if (sessionId !== undefined) {
        assertSessionNotUsedElsewhere(workspacesRef.current, workspaceId, null, sessionId);
      }
      const rootPane = createLeafPane(100, sessionId, configId);
      const baseName =
        name ??
        getDefaultWindowName(
          rootPane,
          sessionsRef.current,
          windowType === "init" ? "New Session" : "Window",
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
    [sessionsRef, workspacesRef, setWorkspaces],
  );

  const createInitWindow = useCallback((): Window => {
    const windowId = crypto.randomUUID();
    const paneId = crypto.randomUUID();
    const window: Window = {
      id: windowId,
      name: "New Session",
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

  const replaceInitWindowWithSession = useCallback(
    (workspaceId: string, windowId: string, session: Session) => {
      assertSessionNotUsedElsewhere(workspacesRef.current, workspaceId, windowId, session.id);
      const rootPane = createLeafPane(100, session.id, session.configId);
      const baseName = session.name;
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

      const sessionIdsToClose = new Set<number>();
      forEachPane(window.rootPane, (node) => {
        if (node.type === "leaf" && node.sessionId !== undefined) {
          sessionIdsToClose.add(node.sessionId);
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

      sessionIdsToClose.forEach((sessionId) => {
        sessionService
          .closeSession(sessionId)
          .catch((e) => console.error("Failed to close session:", e));
        establishingSessionsRef.current.delete(sessionId);
        clearSessionOutput(sessionId);
      });
      if (sessionIdsToClose.size > 0) {
        setSessions((prev) => prev.filter((s) => !sessionIdsToClose.has(s.id)));
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
    },
    [setWorkspaces],
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
    replaceInitWindowWithSession,
    closeWindow,
    reorderWindows,
    setActiveWindow,
    setActivePane,
    renameWindow,
  };
}
