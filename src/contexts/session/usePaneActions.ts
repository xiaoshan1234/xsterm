import { useCallback } from "react";
import * as sessionService from "../../services/sessionService";
import type { PaneNode, Session, SplitDirection, Workspace } from "../../types/session";
import { clearSessionOutput } from "../../utils/sessionOutputBuffer";
import {
  createLeafPane,
  createSplitNode,
  findPaneNode,
  getLeafPaneIds,
  removePaneFromTree,
  replacePaneNode,
  withRecomputedSessionIds,
} from "./paneUtils";
import { assertSessionNotUsedElsewhere } from "./useSessionActions.helpers";

interface UsePaneActionsDeps {
  sessionsRef: React.MutableRefObject<Session[]>;
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
}

export function usePaneActions(deps: UsePaneActionsDeps) {
  const { sessionsRef, workspacesRef, setSessions, setWorkspaces, establishingSessionsRef } = deps;

  /**
   * Split a pane in the workspace
   */
  const splitPane = useCallback(
    (
      workspaceId: string,
      windowId: string,
      paneId: string,
      direction: SplitDirection,
      sessionId?: number,
      configId?: string,
    ) => {
      if (sessionId !== undefined) {
        assertSessionNotUsedElsewhere(workspacesRef.current, workspaceId, windowId, sessionId);
      }
      setWorkspaces((prev) => {
        const workspace = prev.find((w) => w.id === workspaceId);
        if (!workspace) return prev;

        const window = workspace.windows.find((w) => w.id === windowId);
        if (!window) return prev;

        const target = findPaneNode(window.rootPane, paneId);
        if (!target || target.type !== "leaf") return prev;

        const session =
          sessionId !== undefined ? sessionsRef.current.find((s) => s.id === sessionId) : undefined;
        const halfSize = target.size / 2;
        const originalPane = { ...target, size: halfSize };
        const newPane = createLeafPane(halfSize, sessionId, configId ?? session?.configId);
        const splitNode = createSplitNode(direction, originalPane, newPane);
        const newRoot = replacePaneNode(window.rootPane, paneId, splitNode);

        return prev.map((w) =>
          w.id === workspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                activeWindowId: windowId,
                windows: workspace.windows.map((win) =>
                  win.id === windowId
                    ? { ...win, rootPane: newRoot, activePaneId: newPane.id }
                    : win,
                ),
              })
            : w,
        );
      });
    },
    [sessionsRef, workspacesRef, setWorkspaces],
  );

  const updateWindowPaneTree = useCallback(
    (workspaceId: string, windowId: string, updater: (root: PaneNode) => PaneNode) => {
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === workspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                windows: workspace.windows.map((window) =>
                  window.id === windowId
                    ? { ...window, rootPane: updater(window.rootPane) }
                    : window,
                ),
              })
            : workspace,
        ),
      );
    },
    [setWorkspaces],
  );

  const closePane = useCallback(
    async (workspaceId: string, windowId: string, paneId: string): Promise<void> => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      const window = workspace?.windows.find((w) => w.id === windowId);
      const pane = window ? findPaneNode(window.rootPane, paneId) : null;
      if (!pane) return;

      const sessionId = pane.sessionId;
      if (sessionId !== undefined) {
        try {
          await sessionService.closeSession(sessionId);
        } catch (e) {
          console.error("Failed to close session backend:", e);
        } finally {
          establishingSessionsRef.current.delete(sessionId);
        }
        clearSessionOutput(sessionId);
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      }

      setWorkspaces((prev) =>
        prev.map((workspace) => {
          if (workspace.id !== workspaceId) return workspace;
          return withRecomputedSessionIds({
            ...workspace,
            windows: workspace.windows.map((window) => {
              if (window.id !== windowId) return window;
              const newRoot = removePaneFromTree(window.rootPane, paneId);
              const newActivePaneId =
                window.activePaneId === paneId
                  ? (getLeafPaneIds(newRoot)[0] ?? null)
                  : window.activePaneId;
              return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
            }),
          });
        }),
      );
    },
    [workspacesRef, setSessions, setWorkspaces, establishingSessionsRef],
  );

  const writeSession = useCallback(async (id: number, data: string): Promise<void> => {
    await sessionService.writeSession(id, data);
  }, []);

  const resizeSession = useCallback(
    async (id: number, rows: number, cols: number): Promise<void> => {
      await sessionService.resizeSession(id, rows, cols);
    },
    [],
  );

  return {
    splitPane,
    updateWindowPaneTree,
    closePane,
    writeSession,
    resizeSession,
  };
}
