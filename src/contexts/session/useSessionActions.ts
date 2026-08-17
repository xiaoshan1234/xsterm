import { useCallback } from "react";
import {
  LocalSessionConfig,
  PaneNode,
  SSHSessionConfig,
  SavedSessionConfig,
  SavedWindowConfig,
  SavedWorkspace,
  Session,
  SessionDisplayConfig,
  SessionType,
  SplitDirection,
  Window,
  Workspace,
} from "../../types/session";
import * as sessionService from "../../services/sessionService";
import {
  collectSessionIdsFromWorkspace,
  createLeafPane,
  createSplitNode,
  findPaneNode,
  forEachPane,
  generateId,
  getDefaultWindowName,
  getLeafPaneIds,
  isSessionUsedInOtherWindow,
  removePaneFromTree,
  removeSessionAndCollapse,
  replacePaneNode,
  replaceSessionIdInPaneTree,
  stripSessionIdFromPaneTree,
  withRecomputedSessionIds,
} from "./paneUtils";
import { clearSessionOutput } from "../../utils/sessionOutputBuffer";
import { SessionActions, SessionPersistence, SessionState } from "./types";

async function dispatchByType(
  type: SessionType["type"],
  local: () => Promise<sessionService.SessionInfo>,
  ssh: () => Promise<sessionService.SessionInfo>,
): Promise<sessionService.SessionInfo> {
  switch (type) {
    case "local":
      return local();
    case "ssh":
      return ssh();
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown session type: ${String(_exhaustive)}`);
    }
  }
}

function getUniqueWindowName(
  workspaces: Workspace[],
  workspaceId: string,
  baseName: string,
  excludeWindowId?: string
): string {
  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return baseName;
  const existing = new Set(
    workspace.windows.filter((w) => w.id !== excludeWindowId).map((w) => w.name)
  );
  if (!existing.has(baseName)) return baseName;
  let suffix = 2;
  while (existing.has(`${baseName}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseName}-${suffix}`;
}

function buildFrontendSession(
  info: sessionService.SessionInfo,
  configId: string,
  type: Session["type"],
  displayConfig?: SessionDisplayConfig
): Session {
  return {
    id: info.id,
    configId,
    name: info.name,
    type,
    is_connected: info.is_connected,
    session_type: info.session_type,
    displayConfig,
  };
}

function assertSessionNotUsedElsewhere(
  workspaces: Workspace[],
  workspaceId: string | null,
  windowId: string | null,
  sessionId: number
): void {
  if (isSessionUsedInOtherWindow(workspaces, workspaceId, windowId, sessionId)) {
    throw new Error("Session is already used in another window");
  }
}

interface UseSessionActionsOptions extends SessionState, SessionPersistence {}

export function useSessionActions({
  savedConfigs,
  setSessions,
  sessionsRef,
  setWorkspaces,
  workspacesRef,
  setActiveWorkspaceId,
  activeWorkspaceId,
  savedWorkspaces,
  setSavedWorkspaces,
  savedWindowConfigs,
  setSavedWindowConfigs,
  nextGroupId,
  setNextGroupId,
  establishingSessionsRef,
  updateConfigs,
  updateGroups,
  persistSavedWorkspaces,
  persistSavedWindowConfigs,
}: UseSessionActionsOptions): SessionActions {
  const openFromConfigInternal = useCallback(
    async (configId: string): Promise<Session> => {
      const config = savedConfigs.find((c) => c.id === configId);
      if (!config) throw new Error("Config not found");

      let info: sessionService.SessionInfo;
      let type: Session["type"];

      info = await dispatchByType(
        config.type,
        () => sessionService.createLocal(config.config as LocalSessionConfig),
        () => sessionService.createSsh(config.config as SSHSessionConfig),
      );
      type = config.type;

      const session = buildFrontendSession(info, configId, type, config.displayConfig);
      setSessions((prev) => [...prev, session]);

      return session;
    },
    [savedConfigs, setSessions]
  );

  const createWindowFromSession = useCallback(
    (sessionId: number, configId: string, name?: string, targetWorkspaceIdParam?: string): Window => {
      assertSessionNotUsedElsewhere(workspacesRef.current, null, null, sessionId);
      const rootPane = createLeafPane(100, sessionId, configId);
      const baseName = name ?? "Window";
      const window: Window = {
        id: generateId(),
        name: baseName,
        rootPane,
        activePaneId: rootPane.id,
      };

      setWorkspaces((prev) => {
        const fallbackWorkspaceId = workspacesRef.current[0]?.id ?? prev[0]?.id ?? null;
        const targetWorkspaceId = targetWorkspaceIdParam ?? fallbackWorkspaceId;
        const workspaceExists = targetWorkspaceId && prev.some((w) => w.id === targetWorkspaceId);
        if (prev.length === 0 || !targetWorkspaceId || !workspaceExists) {
          const uniqueName = getUniqueWindowName(prev, "", baseName);
          const finalWindow: Window = { ...window, name: uniqueName };
          const workspace: Workspace = {
            id: generateId(),
            name: "default",
            windows: [finalWindow],
            activeWindowId: finalWindow.id,
            sessionIds: [sessionId],
          };
          setActiveWorkspaceId(workspace.id);
          return [workspace];
        }
        const uniqueName = getUniqueWindowName(prev, targetWorkspaceId, baseName);
        const finalWindow: Window = { ...window, name: uniqueName };
        return prev.map((workspace) =>
          workspace.id === targetWorkspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                windows: [...workspace.windows, finalWindow],
                activeWindowId: finalWindow.id,
              })
            : workspace
        );
      });
      return window;
    },
    [sessionsRef, setWorkspaces, setActiveWorkspaceId, workspacesRef]
  );

  const createWorkspaceFromSession = useCallback(
    (sessionId: number, configId: string, name?: string): Workspace => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const windowName = name ?? session?.name ?? "Window";
      const rootPane = createLeafPane(100, sessionId, configId);
      const window: Window = {
        id: generateId(),
        name: windowName,
        rootPane,
        activePaneId: rootPane.id,
      };
      const workspace: Workspace = {
        id: generateId(),
        name: name ?? session?.name ?? "Workspace",
        windows: [window],
        activeWindowId: window.id,
        sessionIds: [sessionId],
      };
      setWorkspaces((prev) => [...prev, workspace]);
      setActiveWorkspaceId(workspace.id);
      return workspace;
    },
    [sessionsRef, setWorkspaces, setActiveWorkspaceId]
  );

  const createSessionFromSavedConfig = useCallback(
    async (configId: string): Promise<Session> => {
      return openFromConfigInternal(configId);
    },
    [openFromConfigInternal]
  );

  const createWindowFromSavedConfig = useCallback(
    async (configId: string, name?: string): Promise<Window> => {
      const config = savedConfigs.find((c) => c.id === configId);
      if (!config) throw new Error("Config not found");

      const session = await createSessionFromSavedConfig(configId);
      assertSessionNotUsedElsewhere(workspacesRef.current, null, null, session.id);
      return createWindowFromSession(session.id, session.configId, name ?? config.name, activeWorkspaceId ?? undefined);
    },
    [savedConfigs, createSessionFromSavedConfig, createWindowFromSession, workspacesRef, activeWorkspaceId]
  );

  const setActiveWorkspace = useCallback(
    (workspaceId: string) => {
      setActiveWorkspaceId(workspaceId);
    },
    [setActiveWorkspaceId]
  );

  const setActiveWindow = useCallback(
    (workspaceId: string, windowId: string) => {
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === workspaceId ? { ...workspace, activeWindowId: windowId } : workspace
        )
      );
    },
    [setWorkspaces]
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
                  window.id === windowId ? { ...window, activePaneId: paneId } : window
                ),
              }
            : workspace
        )
      );
    },
    [setWorkspaces]
  );

  /**
   * Split a pane in the workspace
   */
  const splitPane = useCallback(
    (workspaceId: string, windowId: string, paneId: string, direction: SplitDirection, sessionId?: number, configId?: string) => {
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

        const session = sessionId !== undefined ? sessionsRef.current.find((s) => s.id === sessionId) : undefined;
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
                  win.id === windowId ? { ...win, rootPane: newRoot, activePaneId: newPane.id } : win
                ),
              })
            : w
        );
      });
    },
    [sessionsRef, setWorkspaces, workspacesRef]
  );

  const updateWindowPaneTree = useCallback(
    (workspaceId: string, windowId: string, updater: (root: PaneNode) => PaneNode) => {
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === workspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                windows: workspace.windows.map((window) =>
                  window.id === windowId ? { ...window, rootPane: updater(window.rootPane) } : window
                ),
              })
            : workspace
        )
      );
    },
    [setWorkspaces]
  );

  const createWindow = useCallback(
    (workspaceId: string, sessionId?: number, configId?: string, name?: string, windowType: "terminal" | "init" = "terminal"): Window => {
      if (sessionId !== undefined) {
        assertSessionNotUsedElsewhere(workspacesRef.current, workspaceId, null, sessionId);
      }
      const rootPane = createLeafPane(100, sessionId, configId);
      const baseName = name ?? getDefaultWindowName(rootPane, sessionsRef.current, windowType === "init" ? "New Session" : "Window");
      const window: Window = {
        id: generateId(),
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
            : workspace
        );
      });
      return window;
    },
    [sessionsRef, setWorkspaces]
  );

  const createInitWindow = useCallback((): Window => {
    const windowId = generateId();
    const paneId = generateId();
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
                : window
            ),
          });
        })
      );
    },
    [setWorkspaces, workspacesRef]
  );

  const createDefaultWorkspace = useCallback((): Workspace => {
    const existingDefault = workspacesRef.current.find((w) => w.name === "default");
    if (existingDefault) {
      setActiveWorkspaceId(existingDefault.id);
      return existingDefault;
    }

    const workspaceId = generateId();
    const windowId = generateId();
    const paneId = generateId();

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
            const fallback = remaining[closedIndex - 1] ?? remaining[closedIndex] ?? remaining[remaining.length - 1];
            nextActiveId = fallback?.id ?? null;
          }
          return withRecomputedSessionIds({ ...workspace, windows, activeWindowId: nextActiveId });
        })
      );

      sessionIdsToClose.forEach((sessionId) => {
        sessionService.closeSession(sessionId).catch((e) => console.error("Failed to close session:", e));
        establishingSessionsRef.current.delete(sessionId);
        clearSessionOutput(sessionId);
      });
      if (sessionIdsToClose.size > 0) {
        setSessions((prev) => prev.filter((s) => !sessionIdsToClose.has(s.id)));
      }
    },
    [setWorkspaces, setSessions, establishingSessionsRef, workspacesRef]
  );

  const closeWorkspace = useCallback(
    (workspaceId: string) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!workspace || workspace.name === "default") return;

      if (workspace.sessionIds.length > 0) {
        const idsToClose = new Set(workspace.sessionIds);
        idsToClose.forEach((sessionId) => {
          sessionService.closeSession(sessionId).catch((e) => console.error("Failed to close session:", e));
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
        const fallback = remaining[closedIndex - 1] ?? remaining[closedIndex] ?? remaining[remaining.length - 1] ?? null;
        return fallback?.id ?? null;
      });
    },
    [setWorkspaces, setActiveWorkspaceId, workspacesRef, setSessions, establishingSessionsRef]
  );

  /**
   * Save a workspace as a snapshot (persisted to sessions.json)
   *
   * Workspace save flow:
   * 1. Find the target workspace (deep copy the rootPane structure, including all pane and session configId references)
   * 2. Generate a new savedWorkspace object (with a new ID, independent from the original workspace)
   * 3. Append to savedWorkspaces and write to sessions.json via persistSavedWorkspaces
   *
   * Note: configId is saved instead of session ID; sessions are reconstructed via loadWorkspace after restart
   */
  const saveWorkspace = useCallback(
    (workspaceId: string, name: string) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!workspace) return;

      const finalName = name.trim() || workspace.name;
      const isDefault = workspace.name === "default";

      if (finalName === "default") {
        throw new Error("Workspace name is reserved");
      }

      const buildSavedWorkspace = (id: string): SavedWorkspace => ({
        id,
        name: finalName,
        windows: workspace.windows.map((window) => ({
          id: generateId(),
          name: window.name,
          rootPane: stripSessionIdFromPaneTree(window.rootPane),
        })),
      });

      if (isDefault) {
        if (savedWorkspaces.some((w) => w.name.trim() === finalName)) {
          throw new Error("Workspace name already exists");
        }
        const savedWorkspaceData = buildSavedWorkspace(generateId());
        setSavedWorkspaces((prev) => {
          const updated = [...prev, savedWorkspaceData];
          persistSavedWorkspaces(updated);
          return updated;
        });
        return;
      }

      const existingSavedByName = savedWorkspaces.find((w) => w.name.trim() === finalName);
      const savedWorkspaceData = buildSavedWorkspace(existingSavedByName?.id ?? generateId());

      if (existingSavedByName) {
        setSavedWorkspaces((prev) => {
          const updated = prev.map((w) => (w.id === existingSavedByName.id ? savedWorkspaceData : w));
          persistSavedWorkspaces(updated);
          return updated;
        });
      } else {
        setSavedWorkspaces((prev) => {
          const updated = [...prev, savedWorkspaceData];
          persistSavedWorkspaces(updated);
          return updated;
        });
      }
    },
    [workspacesRef, setSavedWorkspaces, persistSavedWorkspaces, savedWorkspaces]
  );

  /**
   * Load a workspace from a snapshot (restored from sessions.json)
   *
   * Full workspace load flow:
   * 1. Find savedWorkspace, traverse the pane tree (buildTree recursion)
   * 2. For each leaf pane: if it contains a configId, call openFromConfigInternal to reconstruct the session (reuse existing sessions to avoid duplicates)
   * 3. buildTree returns a new pane tree (all node IDs regenerated, independent from the original snapshot)
   * 4. Create the workspace, add to workspaces, set as active
   *
   * Exception handling: if any pane reconstruction fails, rollback (close created sessions, revert sessions state)
   */
  const loadWorkspace = useCallback(
    async (savedWorkspaceId: string): Promise<Workspace> => {
      const saved = savedWorkspaces.find((w) => w.id === savedWorkspaceId);
      if (!saved) throw new Error("Saved workspace not found");

      // configId → session already created in this load (each config is created only once)
      const configIdToSession = new Map<string, Session>();

      const rollback = async () => {
        const sessionsToClose = [...configIdToSession.values()];
        const idsToClose = new Set(sessionsToClose.map((s) => s.id));
        await Promise.all(
          sessionsToClose.map((session) =>
            sessionService
              .closeSession(session.id)
              .catch((e) => console.error("Failed to close session during workspace rollback:", e))
          )
        );
        for (const id of idsToClose) {
          establishingSessionsRef.current.delete(id);
          clearSessionOutput(id);
        }
        if (idsToClose.size > 0) {
          setSessions((prev) => prev.filter((s) => !idsToClose.has(s.id)));
        }
      };

      const buildTree = async (node: PaneNode, depth = 0): Promise<PaneNode> => {
        if (node.type === "leaf") {
          if (node.sessionId !== undefined && node.configId === undefined) {
            console.warn(`[loadWorkspace] leaf has sessionId but no configId; session cannot be recreated`);
          }
          const configId = node.configId;
          if (configId) {
            let session = configIdToSession.get(configId);
            if (!session) {
              try {
                session = await openFromConfigInternal(configId);
                configIdToSession.set(configId, session);
              } catch (e) {
                console.error("Failed to recreate session for workspace:", e);
                await rollback();
                throw e;
              }
            }
            return createLeafPane(node.size, session.id, configId);
          }
          return { ...createLeafPane(node.size), id: generateId() };
        }
        const children = await Promise.all((node.children ?? []).map((child) => buildTree(child, depth + 1)));
        return {
          id: generateId(),
          type: "split",
          direction: node.direction,
          size: node.size,
          children,
        };
      };

      const buildWindow = async (savedWindow: { id: string; name: string; rootPane: PaneNode }): Promise<Window> => {
        const rootPane = await buildTree(savedWindow.rootPane);
        return {
          id: generateId(),
          name: savedWindow.name,
          rootPane,
          activePaneId: getLeafPaneIds(rootPane)[0] ?? null,
        };
      };

      const builtWindows = await Promise.all(saved.windows.map((w) => buildWindow(w)));
      const usedNames = new Set<string>();
      const windows = builtWindows.map((w) => {
        if (!usedNames.has(w.name)) {
          usedNames.add(w.name);
          return w;
        }
        let suffix = 2;
        while (usedNames.has(`${w.name}-${suffix}`)) {
          suffix += 1;
        }
        const unique = `${w.name}-${suffix}`;
        usedNames.add(unique);
        return { ...w, name: unique };
      });
      const activeWindow = windows[0] ?? null;
      const workspaceWithoutIds: Workspace = {
        id: generateId(),
        name: saved.name,
        windows,
        activeWindowId: activeWindow?.id ?? null,
        sessionIds: [],
        savedWorkspaceId: saved.id,
      };
      const workspace: Workspace = {
        ...workspaceWithoutIds,
        sessionIds: collectSessionIdsFromWorkspace(workspaceWithoutIds),
      };

      setWorkspaces((prev) => [...prev, workspace]);
      setActiveWorkspaceId(workspace.id);
      return workspace;
    },
    [savedWorkspaces, openFromConfigInternal, setSessions, setWorkspaces, setActiveWorkspaceId, establishingSessionsRef]
  );

  const deleteSavedWorkspace = useCallback(
    (id: string) => {
      setSavedWorkspaces((prev) => {
        const updated = prev.filter((w) => w.id !== id);
        persistSavedWorkspaces(updated);
        return updated;
      });
    },
    [setSavedWorkspaces, persistSavedWorkspaces]
  );

  const renameSavedWorkspace = useCallback(
    (id: string, name: string) => {
      const trimmedName = name.trim();
      if (trimmedName === "default") {
        throw new Error("Workspace name is reserved");
      }
      if (savedWorkspaces.some((w) => w.id !== id && w.name.trim() === trimmedName)) {
        throw new Error("Workspace name already exists");
      }

      setSavedWorkspaces((prev) => {
        const updated = prev.map((w) => (w.id === id ? { ...w, name: trimmedName } : w));
        persistSavedWorkspaces(updated);
        return updated;
      });
    },
    [setSavedWorkspaces, persistSavedWorkspaces, savedWorkspaces]
  );

  const saveWindow = useCallback(
    (workspaceId: string, windowId: string, name: string) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      const window = workspace?.windows.find((w) => w.id === windowId);
      if (!workspace || !window) return;

      const savedWindow: SavedWindowConfig = {
        id: generateId(),
        name: name.trim() || window.name,
        rootPane: stripSessionIdFromPaneTree(window.rootPane),
      };

      setSavedWindowConfigs((prev) => {
        const updated = [...prev, savedWindow];
        persistSavedWindowConfigs(updated);
        return updated;
      });
    },
    [workspacesRef, setSavedWindowConfigs, persistSavedWindowConfigs]
  );

  const saveAllWindows = useCallback(
    (workspaceId: string) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!workspace) return;

      const newConfigs: SavedWindowConfig[] = workspace.windows.map((window) => ({
        id: generateId(),
        name: window.name,
        rootPane: stripSessionIdFromPaneTree(window.rootPane),
      }));

      setSavedWindowConfigs((prev) => {
        const updated = [...prev, ...newConfigs];
        persistSavedWindowConfigs(updated);
        return updated;
      });
    },
    [workspacesRef, setSavedWindowConfigs, persistSavedWindowConfigs]
  );

  const loadWindow = useCallback(
    async (savedWindowId: string, workspaceId?: string): Promise<Window> => {
      const saved = savedWindowConfigs.find((w) => w.id === savedWindowId);
      if (!saved) throw new Error("Saved window config not found");

      const configIdToSession = new Map<string, Session>();

      const rollback = async () => {
        const sessionsToClose = [...configIdToSession.values()];
        const idsToClose = new Set(sessionsToClose.map((s) => s.id));
        await Promise.all(
          sessionsToClose.map((session) =>
            sessionService
              .closeSession(session.id)
              .catch((e) => console.error("Failed to close session during window rollback:", e))
          )
        );
        for (const id of idsToClose) {
          establishingSessionsRef.current.delete(id);
          clearSessionOutput(id);
        }
        if (idsToClose.size > 0) {
          setSessions((prev) => prev.filter((s) => !idsToClose.has(s.id)));
        }
      };

      const buildTree = async (node: PaneNode): Promise<PaneNode> => {
        if (node.type === "leaf") {
          const configId = node.configId;
          if (configId) {
            let session = configIdToSession.get(configId);
            if (!session) {
              try {
                session = await openFromConfigInternal(configId);
                configIdToSession.set(configId, session);
              } catch (e) {
                console.error("Failed to recreate session for window:", e);
                await rollback();
                throw e;
              }
            }
            return createLeafPane(node.size, session.id, configId);
          }
          return { ...createLeafPane(node.size), id: generateId() };
        }
        const children = await Promise.all((node.children ?? []).map((child) => buildTree(child)));
        return {
          id: generateId(),
          type: "split",
          direction: node.direction,
          size: node.size,
          children,
        };
      };

      const rootPane = await buildTree(saved.rootPane);
      const baseName = saved.name || getDefaultWindowName(rootPane, sessionsRef.current, "Window");
      const window: Window = {
        id: generateId(),
        name: baseName,
        rootPane,
        activePaneId: getLeafPaneIds(rootPane)[0] ?? null,
      };

      const targetWorkspaceId = workspaceId ?? workspacesRef.current[0]?.id;
      if (!targetWorkspaceId) throw new Error("No workspace available to load window");

      setWorkspaces((prev) => {
        const uniqueName = getUniqueWindowName(prev, targetWorkspaceId, baseName);
        const finalWindow: Window = { ...window, name: uniqueName };
        return prev.map((workspace) =>
          workspace.id === targetWorkspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                windows: [...workspace.windows, finalWindow],
                activeWindowId: finalWindow.id,
              })
            : workspace
        );
      });
      return window;
    },
    [savedWindowConfigs, openFromConfigInternal, setSessions, setWorkspaces, establishingSessionsRef]
  );

  const deleteSavedWindow = useCallback(
    (id: string) => {
      setSavedWindowConfigs((prev) => {
        const updated = prev.filter((w) => w.id !== id);
        persistSavedWindowConfigs(updated);
        return updated;
      });
    },
    [setSavedWindowConfigs, persistSavedWindowConfigs]
  );

  const renameSavedWindow = useCallback(
    (id: string, name: string) => {
      setSavedWindowConfigs((prev) => {
        const updated = prev.map((w) => (w.id === id ? { ...w, name } : w));
        persistSavedWindowConfigs(updated);
        return updated;
      });
    },
    [setSavedWindowConfigs, persistSavedWindowConfigs]
  );

  /**
   * Core internal method for creating and activating a session
   *
   * Full session creation flow:
   * 1. Generate configId (as unique identifier for the persistent config)
   * 2. Call backend sessionService to create the real session
   * 3. Construct the frontend Session object, add to sessions[]
   * 4. If save=true, persist the config to savedConfigs (survives restarts)
   * 5. Automatically call createWorkspaceFromSession to create a default workspace
   */
  const createAndActivateSession = useCallback(
    async (
      type: Session["type"],
      create: () => Promise<sessionService.SessionInfo>,
      config: LocalSessionConfig | SSHSessionConfig,
      save: boolean,
      skipAutoWindow = false,
      displayConfig?: SessionDisplayConfig
    ): Promise<Session> => {
      const configId = generateId();
      const info = await create();
      const session = buildFrontendSession(info, configId, type, displayConfig);

      setSessions((prev) => [...prev, session]);

      if (save) {
        let savedConfig: SavedSessionConfig;
        if (type === "local") {
          const localConfig = config as LocalSessionConfig;
          savedConfig = { id: configId, name: info.name, version: 1, type: "local", config: localConfig, displayConfig };
        } else {
          const sshConfig = config as SSHSessionConfig;
          savedConfig = { id: configId, name: info.name, version: 1, type: "ssh", config: sshConfig, displayConfig };
        }
        updateConfigs((prev) => [...prev, savedConfig]);
      }

      if (!skipAutoWindow) {
        createWindowFromSession(session.id, session.configId, session.name, activeWorkspaceId ?? undefined);
      }
      return session;
    },
    [updateConfigs, createWindowFromSession, setSessions, activeWorkspaceId]
  );

  /**
   * Create a local session and automatically create a workspace
   *
   * Call chain: createLocalSession → createAndActivateSession("local", ...)
   *  → backend sessionService.createLocal(config) → sessions[] + auto-create workspace
   */
  const createLocalSession = useCallback(
    async (config: LocalSessionConfig, save = true, displayConfig?: SessionDisplayConfig): Promise<Session> => {
      return createAndActivateSession("local", () => sessionService.createLocal(config), config, save, false, displayConfig);
    },
    [createAndActivateSession]
  );

  /**
   * Create an SSH session and automatically create a workspace
   *
   * Call chain: createSshSession → createAndActivateSession("ssh", ...)
   *  → backend sessionService.createSsh(config) → sessions[] + auto-create workspace
   */
  const createSshSession = useCallback(
    async (config: SSHSessionConfig, save = true, displayConfig?: SessionDisplayConfig): Promise<Session> => {
      return createAndActivateSession("ssh", () => sessionService.createSsh(config), config, save, false, displayConfig);
    },
    [createAndActivateSession]
  );

  const createLocalSessionOnly = useCallback(
    async (config: LocalSessionConfig, save = true, displayConfig?: SessionDisplayConfig): Promise<Session> => {
      return createAndActivateSession("local", () => sessionService.createLocal(config), config, save, true, displayConfig);
    },
    [createAndActivateSession]
  );

  const createSshSessionOnly = useCallback(
    async (config: SSHSessionConfig, save = true, displayConfig?: SessionDisplayConfig): Promise<Session> => {
      return createAndActivateSession("ssh", () => sessionService.createSsh(config), config, save, true, displayConfig);
    },
    [createAndActivateSession]
  );

  /**
   * Open a session from a saved config (also creates a default workspace)
   *
   * Difference from createSessionFromSavedConfig: this method additionally calls createWorkspaceFromSession,
   * used for the sidebar "open" operation, which also displays the session UI
   */
  const openFromConfig = useCallback(
    async (configId: string): Promise<Session> => {
      const session = await openFromConfigInternal(configId);
      createWindowFromSession(session.id, session.name, activeWorkspaceId ?? undefined);
      return session;
    },
    [openFromConfigInternal, createWindowFromSession, activeWorkspaceId]
  );

  const removeConfig = useCallback(
    (configId: string) => {
      updateConfigs((prev) => prev.filter((c) => c.id !== configId));
      updateGroups((prev) => prev.map((g) => ({ ...g, configIds: g.configIds.filter((id) => id !== configId) })));
      const session = sessionsRef.current.find((s) => s.configId === configId);
      if (session) {
        sessionService.closeSession(session.id).catch(console.error);
        clearSessionOutput(session.id);
        setSessions((prev) => prev.filter((s) => s.configId !== configId));
        setWorkspaces((prev) =>
          prev.map((workspace) =>
            withRecomputedSessionIds({
              ...workspace,
              windows: workspace.windows.map((window) => {
                const newRoot = removeSessionAndCollapse(window.rootPane, session.id);
                const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                  ? window.activePaneId
                  : (getLeafPaneIds(newRoot)[0] ?? null);
                return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
              }),
            })
          )
        );
      }
    },
    [updateConfigs, updateGroups, sessionsRef, setSessions, setWorkspaces]
  );

  /**
   * Close a session
   *
   * Session close flow:
   * 1. Call backend sessionService.closeSession(id) to close the real session
   * 2. Remove the session from sessions[]
   * 3. Remove panes corresponding to this session in all workspaces (removeSessionAndCollapse), and automatically switch active pane
   *
   * Note: savedConfigs are not automatically deleted (config is preserved, user can reopen)
   */
  const closeSession = useCallback(
    async (id: number): Promise<void> => {
      try {
        await sessionService.closeSession(id);
      } catch (e) {
        console.error("Failed to close session backend:", e);
      } finally {
        clearSessionOutput(id);
        setSessions((prev) => prev.filter((s) => s.id !== id));
        setWorkspaces((prev) =>
          prev.map((workspace) =>
            withRecomputedSessionIds({
              ...workspace,
              windows: workspace.windows.map((window) => {
                const newRoot = removeSessionAndCollapse(window.rootPane, id);
                const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                  ? window.activePaneId
                  : (getLeafPaneIds(newRoot)[0] ?? null);
                return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
              }),
            })
          )
        );
      }
    },
    [setSessions, setWorkspaces]
  );

  const reconnectSession = useCallback(
    async (id: number): Promise<Session> => {
      const oldSession = sessionsRef.current.find((s) => s.id === id);
      if (!oldSession) throw new Error("Session not found");
      if (oldSession.capabilities && !oldSession.capabilities.supportsReconnect) {
        throw new Error("Reconnect not supported for this transport");
      }

      const config = savedConfigs.find((c) => c.id === oldSession.configId);
      if (!config) throw new Error("Saved config not found for session");

      let info: sessionService.SessionInfo;
      let type: Session["type"];

      info = await dispatchByType(
        config.type,
        () => sessionService.createLocal(config.config as LocalSessionConfig),
        () => sessionService.createSsh(config.config as SSHSessionConfig),
      );
      type = config.type;

      const newSession = buildFrontendSession(info, oldSession.configId, type, config.displayConfig);
      setSessions((prev) => [...prev, newSession]);

      setWorkspaces((prev) =>
        prev.map((workspace) =>
          withRecomputedSessionIds({
            ...workspace,
            windows: workspace.windows.map((window) => ({
              ...window,
              rootPane: replaceSessionIdInPaneTree(window.rootPane, id, newSession.id),
            })),
          })
        )
      );

      establishingSessionsRef.current.delete(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));

      try {
        await sessionService.closeSession(id);
      } catch (e) {
        console.error("Failed to close old session backend during reconnect:", e);
      } finally {
        clearSessionOutput(id);
      }

      return newSession;
    },
    [savedConfigs, sessionsRef, setSessions, setWorkspaces, establishingSessionsRef]
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
              const newActivePaneId = window.activePaneId === paneId ? (getLeafPaneIds(newRoot)[0] ?? null) : window.activePaneId;
              return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
            }),
          });
        })
      );
    },
    [workspacesRef, setSessions, setWorkspaces, establishingSessionsRef]
  );

  const renameSession = useCallback(
    (id: number, name: string) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
      const session = sessionsRef.current.find((s) => s.id === id);
      if (session) {
        updateConfigs((prev) => prev.map((c) => (c.id === session.configId ? { ...c, name } : c)));
      }
    },
    [updateConfigs, sessionsRef, setSessions]
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
              w.id === windowId ? { ...w, name: uniqueName } : w
            ),
          };
        })
      );
    },
    [setWorkspaces]
  );

  const createGroup = useCallback(
    (name: string) => {
      const id = nextGroupId;
      setNextGroupId((prev) => prev + 1);
      updateGroups((prev) => [...prev, { id, name, configIds: [], collapsed: false }], id + 1);
    },
    [nextGroupId, setNextGroupId, updateGroups]
  );

  const deleteGroup = useCallback(
    (id: number) => {
      updateGroups((prev) => prev.filter((g) => g.id !== id));
    },
    [updateGroups]
  );

  const addToGroup = useCallback(
    (groupId: number, configId: string) => {
      updateGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, configIds: [...g.configIds, configId] } : g))
      );
    },
    [updateGroups]
  );

  const removeFromGroup = useCallback(
    (groupId: number, configId: string) => {
      updateGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, configIds: g.configIds.filter((cid) => cid !== configId) } : g))
      );
    },
    [updateGroups]
  );

  const moveConfigToGroup = useCallback(
    (configId: string, groupId: number | null) => {
      updateGroups((prev) =>
        prev.map((g) => ({
          ...g,
          configIds: g.configIds.filter((id) => id !== configId),
        }))
      );
      if (groupId !== null) {
        updateGroups((prev) =>
          prev.map((g) => (g.id === groupId ? { ...g, configIds: [...g.configIds, configId] } : g))
        );
      }
    },
    [updateGroups]
  );

  const renameGroup = useCallback(
    (id: number, name: string) => {
      updateGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
    },
    [updateGroups]
  );

  const toggleGroup = useCallback(
    (id: number) => {
      updateGroups((prev) => prev.map((g) => (g.id === id ? { ...g, collapsed: !g.collapsed } : g)));
    },
    [updateGroups]
  );

  const updateConfig = useCallback(
    (config: SavedSessionConfig) => {
      updateConfigs((prev) => prev.map((c) => (c.id === config.id ? config : c)));
    },
    [updateConfigs]
  );

  const writeSession = useCallback(
    async (id: number, data: string): Promise<void> => {
      await sessionService.writeSession(id, data);
    },
    []
  );

  const resizeSession = useCallback(
    async (id: number, rows: number, cols: number): Promise<void> => {
      await sessionService.resizeSession(id, rows, cols);
    },
    []
  );

  return {
    createLocalSession,
    createSshSession,
    createLocalSessionOnly,
    createSshSessionOnly,
    openFromConfig,
    removeConfig,
    closeSession,
    reconnectSession,
    closePane,
    addToGroup,
    removeFromGroup,
    moveConfigToGroup,
    renameSession,
    createGroup,
    deleteGroup,
    renameGroup,
    updateConfig,
    toggleGroup,
    writeSession,
    resizeSession,
    createWindowFromSession,
    createWindowFromSavedConfig,
    createWorkspaceFromSession,
    createSessionFromSavedConfig,
    createWindow,
    createDefaultWorkspace,
    createInitWindow,
    replaceInitWindowWithSession,
    closeWindow,
    setActiveWindow,
    splitPane,
    updateWindowPaneTree,
    setActivePane,
    setActiveWorkspace,
    saveWorkspace,
    loadWorkspace,
    closeWorkspace,
    deleteSavedWorkspace,
    renameSavedWorkspace,
    saveWindow,
    saveAllWindows,
    loadWindow,
    deleteSavedWindow,
    renameSavedWindow,
    renameWindow,
  };
}
