import { useCallback } from "react";
import * as sessionService from "../../services/sessionService";
import type { PaneNode, SavedSessionConfig, Session, Window, Workspace } from "../../types/session";
import { clearSessionOutput } from "../../utils/sessionOutputBuffer";

function findPaneSessionId(pane: PaneNode, paneId: string): number | undefined {
  if (pane.id === paneId) return pane.sessionId;
  return pane.children?.find((c) => findPaneSessionId(c, paneId))?.sessionId;
}
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
      tmuxControlWindowId?: number,
    ): Window => {
      // ADR 0009 §2.4 + Phase D step (9): when `tmuxControlWindowId` is
      // provided, the caller wants to create a real tmux window on the
      // server, not a local-only Window. The actual `Window` row is
      // produced by the `tmux-window-added` event after the backend
      // confirms; here we just issue the backend call and return a
      // placeholder Window so the caller's TypeScript signature stays
      // intact (the placeholder is never inserted into `workspaces`).
      if (tmuxControlWindowId !== undefined) {
        sessionService
          .createTmuxWindow(tmuxControlWindowId, name)
          .catch((e) => console.error("Failed to create tmux window:", e));
        return {
          id: crypto.randomUUID(),
          name: name ?? "Window",
          rootPane: createLeafPane(100, sessionId, configId),
          activePaneId: "",
          windowType,
          xstermWindowId: undefined,
        };
      }
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

      // ADR 0009 §2.4 — three-branch close semantics:
//
// 1. tmux-control window: confirm-gated by the caller; close every
//    ordinary tmux-window in this workspace that belongs to the same
//    controller (which detaches each leaf's session), drop the
//    control-window itself, and unmark the attached tmux server so the
//    next startup does not ghost-reconnect. tmux server-side session
//    + windows stay alive.
//
// 2. ordinary tmux-window (xstermWindowId !== undefined): just close
//    the leaf sessions. No `kill_tmux_window` (destructive ops are
//    invoked explicitly via the Pane context menu).
//
// 3. everything else (init / non-tmux terminal): close leaf sessions
//    + drop the Window.

      if (window.windowType === "tmux-control" && window.tmuxControlWindowId !== undefined) {
        const controllerId = window.tmuxControlWindowId;
        const sessionIdsToClose = new Set<number>();
        const windowsToDrop: string[] = [windowId];
        const siblingWindows = workspacesRef.current
          .find((w) => w.id === workspaceId)
          ?.windows ?? [];
        for (const w of siblingWindows) {
          if (w.id === windowId) continue;
          if (w.windowType === "tmux-control") continue;
          forEachPane(w.rootPane, (node) => {
            if (node.type === "leaf" && node.sessionId !== undefined) {
              sessionIdsToClose.add(node.sessionId);
            }
          });
          windowsToDrop.push(w.id);
        }

        setWorkspaces((prev) =>
          prev.map((ws) => {
            if (ws.id !== workspaceId) return ws;
            const remaining = ws.windows.filter((w) => !windowsToDrop.includes(w.id));
            let nextActiveId = ws.activeWindowId;
            let windows = remaining;
            if (remaining.length === 0) {
              const initWindow = createInitWindow();
              const uniqueName = getUniqueWindowName(prev, workspaceId, initWindow.name);
              windows = [{ ...initWindow, name: uniqueName }];
              nextActiveId = windows[0].id;
            } else if (windowsToDrop.includes(ws.activeWindowId ?? "")) {
              const closedIndex = ws.windows.findIndex((w) => windowsToDrop.includes(w.id));
              const fallback =
                remaining[closedIndex - 1] ??
                remaining[closedIndex] ??
                remaining[remaining.length - 1];
              nextActiveId = fallback?.id ?? null;
            }
            return withRecomputedSessionIds({
              ...ws,
              windows,
              activeWindowId: nextActiveId,
            });
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
        sessionService
          .unmarkAttachedTmux(controllerId)
          .catch((e) => console.error("Failed to unmark attached tmux:", e));
        return;
      }

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
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      const window = workspace?.windows.find((w) => w.id === windowId);
      // ADR 0009 §2.10 / §2.4: a tmux-window rename has to round-trip
      // through the tmux server (`rename-window`). The frontend
      // state update is driven by the resulting `tmux-window-renamed`
      // event — we do NOT pre-apply the new name locally to keep the
      // server's `windows-control` list and the UI in sync via a
      // single source of truth.
      if (window?.xstermWindowId !== undefined) {
        sessionService
          .renameTmuxWindow(window.xstermWindowId, trimmed)
          .catch((e) => console.error("Failed to rename tmux window:", e));
        return;
      }
      // Control-windows + non-tmux windows keep the local-only
      // rename path (no backend equivalent — control-window name is
      // just the tab label, a regular terminal Window's name is a
      // local free-form label).
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
    [setWorkspaces, workspacesRef],
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
