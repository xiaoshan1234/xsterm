import { useCallback } from "react";
import {
  LocalSessionConfig,
  PaneNode,
  SSHSessionConfig,
  SavedSessionConfig,
  SavedWorkspace,
  Session,
  SplitDirection,
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
  getLeafPaneIds,
  removeSessionAndCollapse,
  replacePaneNode,
} from "./paneUtils";
import { SessionActions, SessionPersistence, SessionState } from "./types";

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
  nextGroupId,
  setNextGroupId,
  setTmuxState,
  setActiveTmuxWindowIds,
  establishingSessionsRef,
  tmuxListTimeoutsRef,
  updateConfigs,
  updateGroups,
  persistSavedWorkspaces,
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

  const createWorkspaceFromSession = useCallback(
    (sessionId: number, name?: string): Workspace => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const workspace: Workspace = {
        id: generateId(),
        name: name ?? session?.name ?? "Workspace",
        rootPane: createLeafPane(100, sessionId, session?.configId),
        activePaneId: null,
      };
      workspace.activePaneId = workspace.rootPane.id;
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

  const createWorkspaceFromSavedConfig = useCallback(
    async (configId: string, name?: string): Promise<Workspace> => {
      const config = savedConfigs.find((c) => c.id === configId);
      if (!config) throw new Error("Config not found");

      const session = await createSessionFromSavedConfig(configId);
      return createWorkspaceFromSession(session.id, name ?? config.name);
    },
    [savedConfigs, createSessionFromSavedConfig, createWorkspaceFromSession]
  );

  const setActiveWorkspace = useCallback(
    (workspaceId: string) => {
      setActiveWorkspaceId(workspaceId);
    },
    [setActiveWorkspaceId]
  );

  const setActivePane = useCallback(
    (workspaceId: string, paneId: string) => {
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === workspaceId ? { ...workspace, activePaneId: paneId } : workspace
        )
      );
    },
    [setWorkspaces]
  );

  const splitPane = useCallback(
    (workspaceId: string, paneId: string, direction: SplitDirection, sessionId?: number) => {
      setWorkspaces((prev) => {
        const workspace = prev.find((w) => w.id === workspaceId);
        if (!workspace) return prev;

        const target = findPaneNode(workspace.rootPane, paneId);
        if (!target || target.type !== "leaf") return prev;

        const session = sessionId !== undefined ? sessionsRef.current.find((s) => s.id === sessionId) : undefined;
        const halfSize = target.size / 2;
        const originalPane = { ...target, size: halfSize };
        const newPane = createLeafPane(halfSize, sessionId, session?.configId);
        const splitNode = createSplitNode(direction, originalPane, newPane);
        const newRoot = replacePaneNode(workspace.rootPane, paneId, splitNode);

        return prev.map((w) =>
          w.id === workspaceId
            ? { ...workspace, rootPane: newRoot, activePaneId: newPane.id }
            : w
        );
      });
    },
    [sessionsRef, setWorkspaces]
  );

  const updateWorkspacePaneTree = useCallback(
    (workspaceId: string, updater: (root: PaneNode) => PaneNode) => {
      setWorkspaces((prev) =>
        prev.map((workspace) =>
          workspace.id === workspaceId ? { ...workspace, rootPane: updater(workspace.rootPane) } : workspace
        )
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

  const saveWorkspace = useCallback(
    (workspaceId: string, name: string) => {
      const workspace = workspacesRef.current.find((w) => w.id === workspaceId);
      if (!workspace) return;

      const savedWorkspace: SavedWorkspace = {
        id: generateId(),
        name: name.trim() || workspace.name,
        rootPane: structuredClone(workspace.rootPane),
      };

      setSavedWorkspaces((prev) => {
        const updated = [...prev, savedWorkspace];
        persistSavedWorkspaces(updated);
        return updated;
      });
    },
    [workspacesRef, setSavedWorkspaces, persistSavedWorkspaces]
  );

  const loadWorkspace = useCallback(
    async (savedWorkspaceId: string): Promise<Workspace> => {
      const saved = savedWorkspaces.find((w) => w.id === savedWorkspaceId);
      if (!saved) throw new Error("Saved workspace not found");

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

      const rootPane = await buildTree(saved.rootPane);
      const workspace: Workspace = {
        id: generateId(),
        name: saved.name,
        rootPane,
        activePaneId: getLeafPaneIds(rootPane)[0] ?? null,
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
      setSavedWorkspaces((prev) => {
        const updated = prev.map((w) => (w.id === id ? { ...w, name } : w));
        persistSavedWorkspaces(updated);
        return updated;
      });
    },
    [setSavedWorkspaces, persistSavedWorkspaces]
  );

  const createAndActivateSession = useCallback(
    async (
      type: Session["type"],
      create: () => Promise<sessionService.SessionInfo>,
      config: LocalSessionConfig | SSHSessionConfig | TmuxSessionConfig | SshTmuxSessionConfig,
      save: boolean
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

      createWorkspaceFromSession(session.id, session.name);
      return session;
    },
    [updateConfigs, createWorkspaceFromSession, setSessions]
  );

  const createLocalSession = useCallback(
    async (config: LocalSessionConfig, save = true): Promise<Session> => {
      return createAndActivateSession("local", () => sessionService.createLocal(config), config, save);
    },
    [createAndActivateSession]
  );

  const createSshSession = useCallback(
    async (config: SSHSessionConfig, save = true): Promise<Session> => {
      return createAndActivateSession("ssh", () => sessionService.createSsh(config), config, save);
    },
    [createAndActivateSession]
  );

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

  const openFromConfig = useCallback(
    async (configId: string): Promise<Session> => {
      const session = await openFromConfigInternal(configId);
      createWorkspaceFromSession(session.id, session.name);
      return session;
    },
    [openFromConfigInternal, createWorkspaceFromSession]
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
          prev.map((workspace) => {
            const newRoot = removeSessionAndCollapse(workspace.rootPane, session.id);
            const newActivePaneId = findPaneNode(newRoot, workspace.activePaneId ?? "")
              ? workspace.activePaneId
              : (getLeafPaneIds(newRoot)[0] ?? null);
            return { ...workspace, rootPane: newRoot, activePaneId: newActivePaneId };
          })
        );
      }
    },
    [updateConfigs, updateGroups, sessionsRef, setSessions, setWorkspaces]
  );

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
          prev.map((workspace) => {
            const newRoot = removeSessionAndCollapse(workspace.rootPane, id);
            const newActivePaneId = findPaneNode(newRoot, workspace.activePaneId ?? "")
              ? workspace.activePaneId
              : (getLeafPaneIds(newRoot)[0] ?? null);
            return { ...workspace, rootPane: newRoot, activePaneId: newActivePaneId };
          })
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
    createWorkspaceFromSession,
    createWorkspaceFromSavedConfig,
    createSessionFromSavedConfig,
    splitPane,
    updateWorkspacePaneTree,
    setActivePane,
    setActiveWorkspace,
    saveWorkspace,
    loadWorkspace,
    closeWorkspace,
    deleteSavedWorkspace,
    renameSavedWorkspace,
  };
}
