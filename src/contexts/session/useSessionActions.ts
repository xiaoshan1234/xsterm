import { useCallback } from "react";
import {
  LocalSessionConfig,
  PaneNode,
  SSHSessionConfig,
  SavedSessionConfig,
  SavedWindowConfig,
  SavedWorkspace,
  Session,
  SplitDirection,
  Window,
  Workspace,
} from "../../types/session";
import { SshTmuxSessionConfig, TmuxSessionConfig } from "../../types/tmux";
import * as sessionService from "../../services/sessionService";
import * as tmuxService from "../../services/tmuxService";
import { cloneTmuxState } from "../tmuxStateReducer";
import {
  createLeafPane,
  createSplitNode,
  findPaneNode,
  generateId,
  getDefaultWindowName,
  getLeafPaneIds,
  removeSessionAndCollapse,
  replacePaneNode,
} from "./paneUtils";
import { SessionActions, SessionPersistence, SessionState } from "./types";

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

function buildFrontendSession(info: sessionService.SessionInfo, configId: string, type: Session["type"]): Session {
  return {
    id: info.id,
    configId,
    name: info.name,
    type,
    is_connected: info.is_connected,
    session_type: info.session_type,
  };
}

interface UseSessionActionsOptions extends SessionState, SessionPersistence {}

export function useSessionActions({
  savedConfigs,
  setSessions,
  sessionsRef,
  setWorkspaces,
  workspacesRef,
  setActiveWorkspaceId,
  savedWorkspaces,
  setSavedWorkspaces,
  savedWindowConfigs,
  setSavedWindowConfigs,
  nextGroupId,
  setNextGroupId,
  setTmuxState,
  setActiveTmuxWindowIds,
  establishingSessionsRef,
  tmuxListTimeoutsRef,
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

      if (config.type === "local" && config.localConfig) {
        info = await sessionService.createLocal(config.localConfig);
        type = "local";
      } else if (config.type === "ssh" && config.sshConfig) {
        info = await sessionService.createSsh(config.sshConfig);
        type = "ssh";
      } else if (config.type === "tmux" && config.tmuxConfig) {
        info = await tmuxService.createTmux(config.tmuxConfig);
        type = "tmux";
        establishingSessionsRef.current.add(info.id);
      } else if (config.type === "ssh_tmux" && config.sshTmuxConfig) {
        info = await tmuxService.createSshTmuxSession(config.sshTmuxConfig);
        type = "ssh_tmux";
        establishingSessionsRef.current.add(info.id);
      } else {
        throw new Error("Invalid config");
      }

      const session = buildFrontendSession(info, configId, type);
      setSessions((prev) => [...prev, session]);

      if (type === "tmux" || type === "ssh_tmux") {
        const timeoutId = window.setTimeout(() => {
          tmuxListTimeoutsRef.current.delete(session.id);
          tmuxService.listSessions(session.id).catch(console.error);
        }, 500);
        tmuxListTimeoutsRef.current.set(session.id, timeoutId);
      }

      return session;
    },
    [savedConfigs, setSessions, establishingSessionsRef, tmuxListTimeoutsRef]
  );

  const createWindowFromSession = useCallback(
    (sessionId: number, name?: string): Window => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const rootPane = createLeafPane(100, sessionId, session?.configId);
      const baseName = name ?? getDefaultWindowName(rootPane, sessionsRef.current, "Window");
      const window: Window = {
        id: generateId(),
        name: baseName,
        rootPane,
        activePaneId: rootPane.id,
      };

      setWorkspaces((prev) => {
        const targetWorkspaceId = workspacesRef.current[0]?.id ?? prev[0]?.id ?? null;
        if (prev.length === 0 || !targetWorkspaceId) {
          const uniqueName = getUniqueWindowName(prev, "", baseName);
          const finalWindow: Window = { ...window, name: uniqueName };
          const workspace: Workspace = {
            id: generateId(),
            name: "Default",
            windows: [finalWindow],
            activeWindowId: finalWindow.id,
          };
          setActiveWorkspaceId(workspace.id);
          return [workspace];
        }
        const uniqueName = getUniqueWindowName(prev, targetWorkspaceId, baseName);
        const finalWindow: Window = { ...window, name: uniqueName };
        return prev.map((workspace) =>
          workspace.id === targetWorkspaceId
            ? {
                ...workspace,
                windows: [...workspace.windows, finalWindow],
                activeWindowId: finalWindow.id,
              }
            : workspace
        );
      });
      return window;
    },
    [sessionsRef, setWorkspaces, setActiveWorkspaceId, workspacesRef]
  );

  const createWorkspaceFromSession = useCallback(
    (sessionId: number, name?: string): Workspace => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const windowName = name ?? session?.name ?? "Window";
      const rootPane = createLeafPane(100, sessionId, session?.configId);
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
      return createWindowFromSession(session.id, name ?? config.name);
    },
    [savedConfigs, createSessionFromSavedConfig, createWindowFromSession]
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
   * 在工作区中拆分面板（split pane）
   */
  const splitPane = useCallback(
    (workspaceId: string, windowId: string, paneId: string, direction: SplitDirection, sessionId?: number) => {
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
        const newPane = createLeafPane(halfSize, sessionId, session?.configId);
        const splitNode = createSplitNode(direction, originalPane, newPane);
        const newRoot = replacePaneNode(window.rootPane, paneId, splitNode);

        return prev.map((w) =>
          w.id === workspaceId
            ? {
                ...workspace,
                activeWindowId: windowId,
                windows: workspace.windows.map((win) =>
                  win.id === windowId ? { ...win, rootPane: newRoot, activePaneId: newPane.id } : win
                ),
              }
            : w
        );
      });
    },
    [sessionsRef, setWorkspaces]
  );

  const updateWindowPaneTree = useCallback(
    (workspaceId: string, windowId: string, updater: (root: PaneNode) => PaneNode) => {
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === workspaceId
            ? {
                ...workspace,
                windows: workspace.windows.map((window) =>
                  window.id === windowId ? { ...window, rootPane: updater(window.rootPane) } : window
                ),
              }
            : workspace
        )
      );
    },
    [setWorkspaces]
  );

  const createWindow = useCallback(
    (workspaceId: string, sessionId?: number, name?: string, windowType: "terminal" | "init" = "terminal"): Window => {
      const session = sessionId !== undefined ? sessionsRef.current.find((s) => s.id === sessionId) : undefined;
      const rootPane = createLeafPane(100, sessionId, session?.configId);
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
            ? { ...workspace, windows: [...workspace.windows, finalWindow], activeWindowId: finalWindow.id }
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
    (workspaceId: string, windowId: string, sessionId: number) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const rootPane = createLeafPane(100, sessionId, session?.configId);
      const baseName = getDefaultWindowName(rootPane, sessionsRef.current, "Window");
      setWorkspaces((prev) =>
        prev.map((workspace) => {
          if (workspace.id !== workspaceId) return workspace;
          const uniqueName = getUniqueWindowName(prev, workspaceId, baseName, windowId);
          return {
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
          };
        })
      );
    },
    [sessionsRef, setWorkspaces]
  );

  const createDefaultWorkspace = useCallback((): Workspace => {
    console.log("[createDefaultWorkspace] >>> invoked");
    const workspaceId = generateId();
    const windowId = generateId();
    const paneId = generateId();
    console.log("[createDefaultWorkspace] generated ids:", { workspaceId, windowId, paneId });

    const workspace: Workspace = {
      id: workspaceId,
      name: "Default",
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
    };
    console.log("[createDefaultWorkspace] constructed workspace:", JSON.parse(JSON.stringify(workspace)));

    const existingWorkspace = workspacesRef.current[0];

    setWorkspaces((prev) => {
      const shouldCreate = prev.length === 0;
      console.log("[createDefaultWorkspace] setWorkspaces callback - prev.length:", prev.length, "will create:", shouldCreate);
      if (shouldCreate) {
        console.log("[createDefaultWorkspace] returning new workspace list:", [workspace]);
        return [workspace];
      }
      console.log("[createDefaultWorkspace] workspaces already exist, keeping prev:", prev);
      return prev;
    });

    const nextActiveWorkspaceId = existingWorkspace ? existingWorkspace.id : workspaceId;
    setActiveWorkspaceId(nextActiveWorkspaceId);
    console.log("[createDefaultWorkspace] setActiveWorkspaceId:", nextActiveWorkspaceId);
    console.log("[createDefaultWorkspace] <<< returning workspace:", JSON.parse(JSON.stringify(workspace)));
    return workspace;
  }, [setWorkspaces, setActiveWorkspaceId]);

  const closeWindow = useCallback(
    (workspaceId: string, windowId: string) => {
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
          return { ...workspace, windows, activeWindowId: nextActiveId };
        })
      );
    },
    [setWorkspaces]
  );

  const closeWorkspace = useCallback(
    (workspaceId: string) => {
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
    [setWorkspaces, setActiveWorkspaceId, workspacesRef]
  );

  /**
   * 将工作区保存为快照（持久化到 sessions.json）
   *
   * 工作区保存流程：
   * 1. 找到目标工作区（深拷贝 rootPane 结构，包含所有面板和会话引用 configId）
   * 2. 生成新的 savedWorkspace 对象（带新 ID，与原工作区独立）
   * 3. 追加到 savedWorkspaces 并通过 persistSavedWorkspaces 写入 sessions.json
   *
   * 注意：保存的是 configId 而非会话 ID，重启后通过 loadWorkspace 重建会话
   */
  const saveWorkspace = useCallback(
    (workspaceId: string, name: string) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!workspace) return;

      const finalName = name.trim() || workspace.name;
      if (savedWorkspaces.some((w) => w.name.trim() === finalName)) {
        throw new Error("Workspace name already exists");
      }

      const savedWorkspace: SavedWorkspace = {
        id: generateId(),
        name: finalName,
        windows: workspace.windows.map((window) => ({
          id: generateId(),
          name: window.name,
          rootPane: structuredClone(window.rootPane),
        })),
      };

      setSavedWorkspaces((prev) => {
        const updated = [...prev, savedWorkspace];
        persistSavedWorkspaces(updated);
        return updated;
      });
    },
    [workspacesRef, setSavedWorkspaces, persistSavedWorkspaces, savedWorkspaces]
  );

  /**
   * 从快照加载工作区（从 sessions.json 恢复）
   *
   * 工作区加载完整流程：
   * 1. 找到 savedWorkspace，遍历面板树（buildTree 递归）
   * 2. 对每个 leaf 面板：若含 configId 则调用 openFromConfigInternal 重建会话（复用已有会话避免重复）
   * 3. buildTree 返回新面板树（所有节点 ID 重新生成，与原快照独立）
   * 4. 创建工作区，加入 workspaces，设为活跃
   *
   * 异常处理：任何面板重建失败时 rollback（关闭已创建会话，回退 sessions 状态）
   */
  const loadWorkspace = useCallback(
    async (savedWorkspaceId: string): Promise<Workspace> => {
      const saved = savedWorkspaces.find((w) => w.id === savedWorkspaceId);
      if (!saved) throw new Error("Saved workspace not found");

      // configId → 已在本次加载中创建的会话（同一配置只创建一次）
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
          const timeoutId = tmuxListTimeoutsRef.current.get(id);
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            tmuxListTimeoutsRef.current.delete(id);
          }
        }
        if (idsToClose.size > 0) {
          setSessions((prev) => prev.filter((s) => !idsToClose.has(s.id)));
        }
      };

      const buildTree = async (node: PaneNode): Promise<PaneNode> => {
        if (node.type === "leaf") {
          if (node.sessionId !== undefined) {
            return { ...node, id: generateId() };
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
        const children = await Promise.all((node.children ?? []).map((child) => buildTree(child)));
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
      const workspace: Workspace = {
        id: generateId(),
        name: saved.name,
        windows,
        activeWindowId: activeWindow?.id ?? null,
      };

      setWorkspaces((prev) => [...prev, workspace]);
      setActiveWorkspaceId(workspace.id);
      return workspace;
    },
    [savedWorkspaces, openFromConfigInternal, setSessions, setWorkspaces, setActiveWorkspaceId, establishingSessionsRef, tmuxListTimeoutsRef]
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
        rootPane: structuredClone(window.rootPane),
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
        rootPane: structuredClone(window.rootPane),
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
          const timeoutId = tmuxListTimeoutsRef.current.get(id);
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            tmuxListTimeoutsRef.current.delete(id);
          }
        }
        if (idsToClose.size > 0) {
          setSessions((prev) => prev.filter((s) => !idsToClose.has(s.id)));
        }
      };

      const buildTree = async (node: PaneNode): Promise<PaneNode> => {
        if (node.type === "leaf") {
          if (node.sessionId !== undefined) {
            return { ...node, id: generateId() };
          }
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
            ? { ...workspace, windows: [...workspace.windows, finalWindow], activeWindowId: finalWindow.id }
            : workspace
        );
      });
      return window;
    },
    [savedWindowConfigs, openFromConfigInternal, setSessions, setWorkspaces, establishingSessionsRef, tmuxListTimeoutsRef]
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
   * 创建并激活会话的核心内部方法
   *
   * 创建会话的完整流程：
   * 1. 生成 configId（作为持久化配置的唯一标识）
   * 2. 调用后端服务（sessionService 或 tmuxService）创建真实会话
   * 3. 构建前端 Session 对象，加入 sessions[]
   * 4. 若 save=true，将配置保存到 savedConfigs（持久化，重启后可恢复）
   * 5. 自动调用 createWorkspaceFromSession 创建默认工作区
   *
   * createLocalSession / createSshSession / createTmuxSession 均调用此方法
   */
  const createAndActivateSession = useCallback(
    async (
      type: Session["type"],
      create: () => Promise<sessionService.SessionInfo>,
      config: LocalSessionConfig | SSHSessionConfig | TmuxSessionConfig | SshTmuxSessionConfig,
      save: boolean,
      skipAutoWindow = false
    ): Promise<Session> => {
      const configId = generateId();
      const info = await create();
      const session = buildFrontendSession(info, configId, type);

      setSessions((prev) => [...prev, session]);

      if (save) {
        let savedConfig: SavedSessionConfig;
        if (type === "local") {
          const localConfig = config as LocalSessionConfig;
          savedConfig = { id: configId, name: info.name, type: "local", localConfig };
        } else if (type === "ssh") {
          const sshConfig = config as SSHSessionConfig;
          savedConfig = { id: configId, name: info.name, type: "ssh", sshConfig };
        } else if (type === "tmux") {
          const tmuxConfig = config as TmuxSessionConfig;
          savedConfig = { id: configId, name: info.name, type: "tmux", tmuxConfig };
        } else {
          const sshTmuxConfig = config as SshTmuxSessionConfig;
          savedConfig = { id: configId, name: info.name, type: "ssh_tmux", sshTmuxConfig };
        }
        updateConfigs((prev) => [...prev, savedConfig]);
      }

      if (!skipAutoWindow) {
        createWindowFromSession(session.id, session.name);
      }
      return session;
    },
    [updateConfigs, createWindowFromSession, setSessions]
  );

  /**
   * 创建本地会话并自动创建工作区
   *
   * 调用链：createLocalSession → createAndActivateSession("local", ...)
   *  → 后端 sessionService.createLocal(config) → sessions[] + 自动创建工作区
   */
  const createLocalSession = useCallback(
    async (config: LocalSessionConfig, save = true): Promise<Session> => {
      return createAndActivateSession("local", () => sessionService.createLocal(config), config, save);
    },
    [createAndActivateSession]
  );

  /**
   * 创建 SSH 会话并自动创建工作区
   *
   * 调用链：createSshSession → createAndActivateSession("ssh", ...)
   *  → 后端 sessionService.createSsh(config) → sessions[] + 自动创建工作区
   */
  const createSshSession = useCallback(
    async (config: SSHSessionConfig, save = true): Promise<Session> => {
      return createAndActivateSession("ssh", () => sessionService.createSsh(config), config, save);
    },
    [createAndActivateSession]
  );

  /**
   * 创建 Tmux 会话并自动创建工作区
   *
   * 特殊处理：
   * - 根据 config.ssh 判断是纯 Tmux（"tmux"）还是 SSH+Tmux（"ssh_tmux"）
   * - Tmux 会话需要 500ms 后调用 listSessions 同步窗口/面板状态
   * - 使用 establishingSessionsRef 标记会话正在初始化（避免重复初始化）
   */
  const createTmuxSession = useCallback(
    async (config: SshTmuxSessionConfig, save = true): Promise<Session> => {
      const session = await (config.ssh
        ? createAndActivateSession(
            "ssh_tmux",
            () => tmuxService.createSshTmuxSession(config),
            config,
            save
          )
        : createAndActivateSession(
            "tmux",
            () => tmuxService.createTmux(config.tmux),
            config.tmux,
            save
          ));

      establishingSessionsRef.current.add(session.id);

      const existingTimeout = tmuxListTimeoutsRef.current.get(session.id);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeoutId = window.setTimeout(() => {
        tmuxListTimeoutsRef.current.delete(session.id);
        tmuxService.listSessions(session.id).catch(console.error);
      }, 500);
      tmuxListTimeoutsRef.current.set(session.id, timeoutId);

      return session;
    },
    [createAndActivateSession, establishingSessionsRef, tmuxListTimeoutsRef]
  );

  const createLocalSessionOnly = useCallback(
    async (config: LocalSessionConfig, save = true): Promise<Session> => {
      return createAndActivateSession("local", () => sessionService.createLocal(config), config, save, true);
    },
    [createAndActivateSession]
  );

  const createSshSessionOnly = useCallback(
    async (config: SSHSessionConfig, save = true): Promise<Session> => {
      return createAndActivateSession("ssh", () => sessionService.createSsh(config), config, save, true);
    },
    [createAndActivateSession]
  );

  const createTmuxSessionOnly = useCallback(
    async (config: SshTmuxSessionConfig, save = true): Promise<Session> => {
      const session = await (config.ssh
        ? createAndActivateSession(
            "ssh_tmux",
            () => tmuxService.createSshTmuxSession(config),
            config,
            save,
            true
          )
        : createAndActivateSession(
            "tmux",
            () => tmuxService.createTmux(config.tmux),
            config.tmux,
            save,
            true
          ));

      establishingSessionsRef.current.add(session.id);

      const existingTimeout = tmuxListTimeoutsRef.current.get(session.id);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeoutId = window.setTimeout(() => {
        tmuxListTimeoutsRef.current.delete(session.id);
        tmuxService.listSessions(session.id).catch(console.error);
      }, 500);
      tmuxListTimeoutsRef.current.set(session.id, timeoutId);

      return session;
    },
    [createAndActivateSession, establishingSessionsRef, tmuxListTimeoutsRef]
  );

  /**
   * 从已保存配置打开会话（同时创建默认工作区）
   *
   * 与 createSessionFromSavedConfig 的区别：此方法额外调用 createWorkspaceFromSession，
   * 用于侧边栏"打开"操作，同时展示会话界面
   */
  const openFromConfig = useCallback(
    async (configId: string): Promise<Session> => {
      const session = await openFromConfigInternal(configId);
      createWindowFromSession(session.id, session.name);
      return session;
    },
    [openFromConfigInternal, createWindowFromSession]
  );

  const removeConfig = useCallback(
    (configId: string) => {
      updateConfigs((prev) => prev.filter((c) => c.id !== configId));
      updateGroups((prev) => prev.map((g) => ({ ...g, configIds: g.configIds.filter((id) => id !== configId) })));
      const session = sessionsRef.current.find((s) => s.configId === configId);
      if (session) {
        sessionService.closeSession(session.id).catch(console.error);
        setSessions((prev) => prev.filter((s) => s.configId !== configId));
        setWorkspaces((prev) =>
          prev.map((workspace) => ({
            ...workspace,
            windows: workspace.windows.map((window) => {
              const newRoot = removeSessionAndCollapse(window.rootPane, session.id);
              const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                ? window.activePaneId
                : (getLeafPaneIds(newRoot)[0] ?? null);
              return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
            }),
          }))
        );
      }
    },
    [updateConfigs, updateGroups, sessionsRef, setSessions, setWorkspaces]
  );

  /**
   * 关闭会话
   *
   * 关闭会话流程：
   * 1. 调用后端 sessionService.closeSession(id) 关闭真实会话
   * 2. 清理 tmuxListTimeoutsRef 中的定时器
   * 3. 从 sessions[] 移除该会话
   * 4. 在所有工作区中移除该会话对应的面板（removeSessionAndCollapse），并自动切换活跃面板
   *
   * 注意：不会自动删除 savedConfigs（配置保留，用户可重新打开）
   */
  const closeSession = useCallback(
    async (id: number): Promise<void> => {
      try {
        await sessionService.closeSession(id);
      } catch (e) {
        console.error("Failed to close session backend:", e);
      } finally {
        const timeoutId = tmuxListTimeoutsRef.current.get(id);
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          tmuxListTimeoutsRef.current.delete(id);
        }
        setSessions((prev) => prev.filter((s) => s.id !== id));
        setWorkspaces((prev) =>
          prev.map((workspace) => ({
            ...workspace,
            windows: workspace.windows.map((window) => {
              const newRoot = removeSessionAndCollapse(window.rootPane, id);
              const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                ? window.activePaneId
                : (getLeafPaneIds(newRoot)[0] ?? null);
              return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
            }),
          }))
        );
      }
    },
    [setSessions, setWorkspaces, tmuxListTimeoutsRef]
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
      const session = sessionsRef.current.find((s) => s.id === id);
      if (session?.type === "tmux" || session?.type === "ssh_tmux") {
        throw new Error("Use sendKeysToTmuxPane for tmux sessions");
      }
      await sessionService.writeSession(id, data);
    },
    [sessionsRef]
  );

  const resizeSession = useCallback(
    async (id: number, rows: number, cols: number): Promise<void> => {
      const session = sessionsRef.current.find((s) => s.id === id);
      if (session?.type === "tmux" || session?.type === "ssh_tmux") {
        throw new Error("Use resizeTmuxPane for tmux sessions");
      }
      await sessionService.resizeSession(id, rows, cols);
    },
    [sessionsRef]
  );

  const writeTmuxCommand = useCallback(async (id: number, command: string): Promise<void> => {
    await tmuxService.writeTmuxCommand(id, command);
  }, []);

  const resizeTmuxPane = useCallback(
    async (id: number, paneId: string, rows: number, cols: number): Promise<void> => {
      await tmuxService.resizeTmuxPane(id, paneId, rows, cols);
    },
    []
  );

  const sendKeysToTmuxPane = useCallback(
    async (id: number, paneId: string, keys: string): Promise<void> => {
      await tmuxService.sendKeysToTmuxPane(id, paneId, keys);
    },
    []
  );

  const captureTmuxPane = useCallback(
    async (id: number, paneId: string): Promise<void> => {
      await tmuxService.captureTmuxPane(id, paneId);
    },
    []
  );

  const createTmuxWindow = useCallback(
    async (sessionId: number, name?: string): Promise<void> => {
      await tmuxService.createTmuxWindow(sessionId, name);
    },
    []
  );

  const closeTmuxWindow = useCallback(
    async (sessionId: number, windowId: string): Promise<void> => {
      await tmuxService.closeTmuxWindow(sessionId, windowId);
    },
    []
  );

  const closeTmuxPane = useCallback(
    async (sessionId: number, paneId: string): Promise<void> => {
      await tmuxService.closeTmuxPane(sessionId, paneId);
    },
    []
  );

  const splitTmuxPane = useCallback(
    async (sessionId: number, paneId: string, direction: "h" | "v" = "h"): Promise<void> => {
      await tmuxService.splitTmuxPane(sessionId, paneId, direction);
    },
    []
  );

  const setActiveTmuxWindow = useCallback(
    (sessionId: number, windowId: string) => {
      setActiveTmuxWindowIds((prev) => {
        const next = new Map(prev);
        next.set(sessionId, windowId);
        return next;
      });
      const tmuxSessionId = String(sessionId);
      const command = `select-window -t ${windowId}\n`;
      tmuxService.writeTmuxCommand(sessionId, command).catch(console.error);
      setTmuxState((prev) => {
        const next = cloneTmuxState(prev);
        const session = next.sessions.get(tmuxSessionId);
        if (session) {
          session.activeWindowId = windowId;
        }
        for (const window of next.windows.values()) {
          if (window.sessionId === tmuxSessionId) {
            window.isActive = window.id === windowId;
          }
        }
        return next;
      });
    },
    [setActiveTmuxWindowIds, setTmuxState]
  );

  return {
    createLocalSession,
    createSshSession,
    createTmuxSession,
    createLocalSessionOnly,
    createSshSessionOnly,
    createTmuxSessionOnly,
    openFromConfig,
    removeConfig,
    closeSession,
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
    writeTmuxCommand,
    resizeTmuxPane,
    sendKeysToTmuxPane,
    captureTmuxPane,
    splitTmuxPane,
    setActiveTmuxWindow,
    createTmuxWindow,
    closeTmuxWindow,
    closeTmuxPane,
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
