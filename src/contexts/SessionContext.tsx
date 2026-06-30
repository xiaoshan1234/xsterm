import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { load } from "@tauri-apps/plugin-store";
import { listen } from "@tauri-apps/api/event";
import { Session, LocalSessionConfig, SSHSessionConfig, SavedSessionConfig, SessionGroup, Workspace, SavedWorkspace, PaneNode, SplitDirection } from "../types/session";
import { TmuxState, TmuxControlEvent, SshTmuxSessionConfig, TmuxSessionConfig } from "../types/tmux";
import * as sessionService from "../services/sessionService";
import * as tmuxService from "../services/tmuxService";
import * as sessionStorage from "../services/sessionStorage";
import { applyTmuxControlEvent, cloneTmuxState } from "./tmuxStateReducer";

function generateId(): string {
  return crypto.randomUUID();
}

function createLeafPane(size: number, sessionId?: number, configId?: string): PaneNode {
  return {
    id: generateId(),
    type: "leaf",
    size,
    sessionId,
    configId,
  };
}

function createSplitNode(direction: SplitDirection, first: PaneNode, second: PaneNode): PaneNode {
  return {
    id: generateId(),
    type: "split",
    direction,
    size: first.size + second.size,
    children: [first, second],
  };
}

function findPaneNode(root: PaneNode, id: string): PaneNode | null {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findPaneNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

function mapPaneTree(root: PaneNode, mapper: (node: PaneNode) => PaneNode): PaneNode {
  const mapped = mapper(root);
  if (mapped.children) {
    return { ...mapped, children: mapped.children.map((child) => mapPaneTree(child, mapper)) };
  }
  return mapped;
}

function forEachPane(root: PaneNode, callback: (node: PaneNode) => void): void {
  callback(root);
  if (root.children) {
    root.children.forEach((child) => forEachPane(child, callback));
  }
}

function getLeafPaneIds(root: PaneNode): string[] {
  const ids: string[] = [];
  forEachPane(root, (node) => {
    if (node.type === "leaf") {
      ids.push(node.id);
    }
  });
  return ids;
}

function removeSessionFromPaneTree(root: PaneNode, sessionId: number): PaneNode {
  return mapPaneTree(root, (node) => {
    if (node.type === "leaf" && node.sessionId === sessionId) {
      return { ...node, sessionId: undefined };
    }
    return node;
  });
}

function collapseEmptySplits(root: PaneNode): PaneNode {
  if (root.type === "leaf") return root;
  const collapsedChildren = root.children?.map(collapseEmptySplits) ?? [];
  if (collapsedChildren.every((child) => child.type === "leaf" && child.sessionId === undefined)) {
    return createLeafPane(root.size);
  }
  return { ...root, children: collapsedChildren };
}

function removeSessionAndCollapse(root: PaneNode, sessionId: number): PaneNode {
  return collapseEmptySplits(removeSessionFromPaneTree(root, sessionId));
}

function replacePaneNode(root: PaneNode, targetId: string, replacement: PaneNode): PaneNode {
  if (root.id === targetId) return replacement;
  if (!root.children) return root;
  return {
    ...root,
    children: root.children.map((child) => replacePaneNode(child, targetId, replacement)),
  };
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

interface SessionContextType {
  sessions: Session[];
  savedConfigs: SavedSessionConfig[];
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  savedWorkspaces: SavedWorkspace[];
  groups: SessionGroup[];
  globalLocalEcho: boolean;
  setGlobalLocalEcho: (enabled: boolean) => void;
  getEffectiveLocalEcho: (sessionId: number) => boolean;
  createLocalSession: (config: LocalSessionConfig, save?: boolean) => Promise<Session>;
  createSshSession: (config: SSHSessionConfig, save?: boolean) => Promise<Session>;
  createTmuxSession: (config: SshTmuxSessionConfig, save?: boolean) => Promise<Session>;
  openFromConfig: (configId: string) => Promise<Session>;
  removeConfig: (configId: string) => void;
  closeSession: (id: number) => Promise<void>;
  addToGroup: (groupId: number, configId: string) => void;
  removeFromGroup: (groupId: number, configId: string) => void;
  moveConfigToGroup: (configId: string, groupId: number | null) => void;
  renameSession: (id: number, name: string) => void;
  createGroup: (name: string) => void;
  deleteGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  updateConfig: (config: SavedSessionConfig) => void;
  toggleGroup: (id: number) => void;
  writeSession: (id: number, data: string) => Promise<void>;
  resizeSession: (id: number, rows: number, cols: number) => Promise<void>;
  writeTmuxCommand: (id: number, command: string) => Promise<void>;
  resizeTmuxPane: (id: number, paneId: string, rows: number, cols: number) => Promise<void>;
  sendKeysToTmuxPane: (id: number, paneId: string, keys: string) => Promise<void>;
  captureTmuxPane: (id: number, paneId: string) => Promise<void>;
  splitTmuxPane: (id: number, paneId: string, direction?: "h" | "v") => Promise<void>;
  tmuxState: TmuxState;
  activeTmuxWindowIds: Map<number, string>;
  setActiveTmuxWindow: (sessionId: number, windowId: string) => void;
  createTmuxWindow: (sessionId: number, name?: string) => Promise<void>;
  closeTmuxWindow: (sessionId: number, windowId: string) => Promise<void>;
  closeTmuxPane: (sessionId: number, paneId: string) => Promise<void>;
  createWorkspaceFromSession: (sessionId: number, name?: string) => Workspace;
  createWorkspaceFromSavedConfig: (configId: string, name?: string) => Promise<Workspace>;
  createSessionFromSavedConfig: (configId: string) => Promise<Session>;
  splitPane: (workspaceId: string, paneId: string, direction: SplitDirection, sessionId?: number) => void;
  updateWorkspacePaneTree: (workspaceId: string, updater: (root: PaneNode) => PaneNode) => void;
  setActivePane: (workspaceId: string, paneId: string) => void;
  setActiveWorkspace: (workspaceId: string) => void;
  saveWorkspace: (workspaceId: string, name: string) => void;
  loadWorkspace: (savedWorkspaceId: string) => Promise<Workspace>;
  closeWorkspace: (workspaceId: string) => void;
  deleteSavedWorkspace: (id: string) => void;
  renameSavedWorkspace: (id: string, name: string) => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [savedConfigs, setSavedConfigs] = useState<SavedSessionConfig[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspace[]>([]);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [nextGroupId, setNextGroupId] = useState(1);
  const [globalLocalEcho, setGlobalLocalEcho] = useState(false);
  const [sessionLocalEchoOverrides] = useState<Map<number, boolean>>(new Map());
  const [tmuxState, setTmuxState] = useState<TmuxState>({
    sessions: new Map(),
    windows: new Map(),
    panes: new Map(),
  });
  const [activeTmuxWindowIds, setActiveTmuxWindowIds] = useState<Map<number, string>>(new Map());
  const sessionsRef = useRef(sessions);
  const workspacesRef = useRef(workspaces);
  const establishingSessionsRef = useRef<Set<number>>(new Set());
  const tmuxListTimeoutsRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    const init = async () => {
      const [configs, savedGroups, workspacesData] = await Promise.all([
        sessionStorage.loadSavedConfigs(),
        sessionStorage.loadSavedGroups(),
        sessionStorage.loadSavedWorkspaces(),
      ]);
      setSavedConfigs(configs);
      setGroups(savedGroups.groups);
      setNextGroupId(savedGroups.nextGroupId);
      setSavedWorkspaces(workspacesData);

      try {
        const store = await load("settings.json", { autoSave: true, defaults: {} });
        const savedGlobalEcho = await store.get<boolean>("globalLocalEcho");
        if (savedGlobalEcho !== null && savedGlobalEcho !== undefined) {
          setGlobalLocalEcho(savedGlobalEcho);
        }
      } catch (e) {
        console.error("Failed to load global settings:", e);
      }
    };
    init();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const persist = async () => {
      try {
        const store = await load("settings.json", { autoSave: true, defaults: {} });
        if (!cancelled) {
          await store.set("globalLocalEcho", globalLocalEcho);
          await store.save();
        }
      } catch (e) {
        console.error("Failed to save global settings:", e);
      }
    };
    persist();
    return () => {
      cancelled = true;
    };
  }, [globalLocalEcho]);

  const getEffectiveLocalEcho = useCallback((sessionId: number) => {
    if (sessionLocalEchoOverrides.has(sessionId)) {
      return sessionLocalEchoOverrides.get(sessionId)!;
    }
    return globalLocalEcho;
  }, [sessionLocalEchoOverrides, globalLocalEcho]);

  const persistSavedWorkspaces = useCallback((workspacesData: SavedWorkspace[]) => {
    sessionStorage.persistWorkspaces(workspacesData);
  }, []);

  const openFromConfigInternal = useCallback(async (configId: string): Promise<Session> => {
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
      const timeoutId = setTimeout(() => {
        tmuxListTimeoutsRef.current.delete(session.id);
        tmuxService.listSessions(session.id).catch(console.error);
      }, 500);
      tmuxListTimeoutsRef.current.set(session.id, timeoutId);
    }

    return session;
  }, [savedConfigs]);

  const createWorkspaceFromSession = useCallback((sessionId: number, name?: string): Workspace => {
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
  }, []);

  const createSessionFromSavedConfig = useCallback(async (configId: string): Promise<Session> => {
    return openFromConfigInternal(configId);
  }, [openFromConfigInternal]);

  const createWorkspaceFromSavedConfig = useCallback(async (configId: string, name?: string): Promise<Workspace> => {
    const config = savedConfigs.find((c) => c.id === configId);
    if (!config) throw new Error("Config not found");

    const session = await createSessionFromSavedConfig(configId);
    return createWorkspaceFromSession(session.id, name ?? config.name);
  }, [savedConfigs, createSessionFromSavedConfig, createWorkspaceFromSession]);

  const setActiveWorkspace = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
  }, []);

  const setActivePane = useCallback((workspaceId: string, paneId: string) => {
    setWorkspaces((prev) =>
      prev.map((workspace) =>
        workspace.id === workspaceId ? { ...workspace, activePaneId: paneId } : workspace
      )
    );
  }, []);

  const splitPane = useCallback((workspaceId: string, paneId: string, direction: SplitDirection, sessionId?: number) => {
    setWorkspaces((prev) => {
      const workspace = prev.find((w) => w.id === workspaceId);
      if (!workspace) return prev;

      const target = findPaneNode(workspace.rootPane, paneId);
      if (!target || target.type !== "leaf") return prev;

      const session = sessionId !== undefined ? sessionsRef.current.find((s) => s.id === sessionId) : undefined;
      const halfSize = target.size / 2;
      const originalPane: PaneNode = { ...target, size: halfSize };
      const newPane = createLeafPane(halfSize, sessionId, session?.configId);
      const splitNode = createSplitNode(direction, originalPane, newPane);
      const newRoot = replacePaneNode(workspace.rootPane, paneId, splitNode);

      return prev.map((w) =>
        w.id === workspaceId
          ? { ...workspace, rootPane: newRoot, activePaneId: newPane.id }
          : w
      );
    });
  }, []);

  const updateWorkspacePaneTree = useCallback((workspaceId: string, updater: (root: PaneNode) => PaneNode) => {
    setWorkspaces((prev) =>
      prev.map((workspace) =>
        workspace.id === workspaceId ? { ...workspace, rootPane: updater(workspace.rootPane) } : workspace
      )
    );
  }, []);

  const closeWorkspace = useCallback((workspaceId: string) => {
    setWorkspaces((prev) => prev.filter((w) => w.id !== workspaceId));
    setActiveWorkspaceId((current) => {
      if (current !== workspaceId) return current;
      const currentWorkspaces = workspacesRef.current;
      const closedIndex = currentWorkspaces.findIndex((w) => w.id === workspaceId);
      const remaining = currentWorkspaces.filter((w) => w.id !== workspaceId);
      const fallback = remaining[closedIndex - 1] ?? remaining[closedIndex] ?? remaining[remaining.length - 1] ?? null;
      return fallback?.id ?? null;
    });
  }, []);

  const saveWorkspace = useCallback((workspaceId: string, name: string) => {
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
  }, [persistSavedWorkspaces]);

  const loadWorkspace = useCallback(async (savedWorkspaceId: string): Promise<Workspace> => {
    const saved = savedWorkspaces.find((w) => w.id === savedWorkspaceId);
    if (!saved) throw new Error("Saved workspace not found");

    const configIdToSession = new Map<string, Session>();

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
            }
          }
          return createLeafPane(node.size, session?.id, configId);
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
  }, [savedWorkspaces, openFromConfigInternal]);

  const deleteSavedWorkspace = useCallback((id: string) => {
    setSavedWorkspaces((prev) => {
      const updated = prev.filter((w) => w.id !== id);
      persistSavedWorkspaces(updated);
      return updated;
    });
  }, [persistSavedWorkspaces]);

  const renameSavedWorkspace = useCallback((id: string, name: string) => {
    setSavedWorkspaces((prev) => {
      const updated = prev.map((w) => (w.id === id ? { ...w, name } : w));
      persistSavedWorkspaces(updated);
      return updated;
    });
  }, [persistSavedWorkspaces]);

  const updateConfigs = useCallback((updater: (prev: SavedSessionConfig[]) => SavedSessionConfig[]) => {
    setSavedConfigs((prev) => {
      const updated = updater(prev);
      sessionStorage.persistConfigs(updated);
      return updated;
    });
  }, []);

  const updateGroups = useCallback((updater: (prev: SessionGroup[]) => SessionGroup[], nextId?: number) => {
    setGroups((prev) => {
      const updated = updater(prev);
      sessionStorage.persistGroups({ groups: updated, nextGroupId: nextId ?? nextGroupId });
      return updated;
    });
  }, [nextGroupId]);

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
        const savedConfig: SavedSessionConfig =
          type === "local"
            ? { id: configId, name: info.name, type: "local", localConfig: config as LocalSessionConfig }
            : type === "ssh"
            ? { id: configId, name: info.name, type: "ssh", sshConfig: config as SSHSessionConfig }
            : type === "tmux"
            ? { id: configId, name: info.name, type: "tmux", tmuxConfig: config as TmuxSessionConfig }
            : { id: configId, name: info.name, type: "ssh_tmux", sshTmuxConfig: config as SshTmuxSessionConfig };
        updateConfigs((prev) => [...prev, savedConfig]);
      }

      createWorkspaceFromSession(session.id, session.name);
      return session;
    },
    [updateConfigs, createWorkspaceFromSession]
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

      const timeoutId = setTimeout(() => {
        tmuxListTimeoutsRef.current.delete(session.id);
        tmuxService.listSessions(session.id).catch(console.error);
      }, 500);
      tmuxListTimeoutsRef.current.set(session.id, timeoutId);

      return session;
    },
    [createAndActivateSession]
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
    [updateConfigs, updateGroups]
  );

  const closeSession = useCallback(async (id: number): Promise<void> => {
    await sessionService.closeSession(id);
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
  }, []);

  const renameSession = useCallback(
    (id: number, name: string) => {
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
      const session = sessions.find((s) => s.id === id);
      if (session) {
        updateConfigs((prev) => prev.map((c) => (c.id === session.configId ? { ...c, name } : c)));
      }
    },
    [updateConfigs, sessions]
  );

  const createGroup = useCallback(
    (name: string) => {
      const id = nextGroupId;
      setNextGroupId((prev) => prev + 1);
      updateGroups((prev) => [...prev, { id, name, configIds: [], collapsed: false }], id + 1);
    },
    [nextGroupId, updateGroups]
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

  const writeSession = useCallback(async (id: number, data: string): Promise<void> => {
    const session = sessions.find((s) => s.id === id);
    if (session?.type === "tmux" || session?.type === "ssh_tmux") {
      throw new Error("Use sendKeysToTmuxPane for tmux sessions");
    }
    await sessionService.writeSession(id, data);
  }, [sessions]);

  const setGlobalLocalEchoPersisted = useCallback((enabled: boolean) => {
    setGlobalLocalEcho(enabled);
  }, []);

  const resizeSession = useCallback(async (id: number, rows: number, cols: number): Promise<void> => {
    const session = sessions.find((s) => s.id === id);
    if (session?.type === "tmux" || session?.type === "ssh_tmux") {
      throw new Error("Use resizeTmuxPane for tmux sessions");
    }
    await sessionService.resizeSession(id, rows, cols);
  }, [sessions]);

  const writeTmuxCommand = useCallback(async (id: number, command: string): Promise<void> => {
    await tmuxService.writeTmuxCommand(id, command);
  }, []);

  const resizeTmuxPane = useCallback(async (id: number, paneId: string, rows: number, cols: number): Promise<void> => {
    await tmuxService.resizeTmuxPane(id, paneId, rows, cols);
  }, []);

  const sendKeysToTmuxPane = useCallback(async (id: number, paneId: string, keys: string): Promise<void> => {
    await tmuxService.sendKeysToTmuxPane(id, paneId, keys);
  }, []);

  const captureTmuxPane = useCallback(async (id: number, paneId: string): Promise<void> => {
    await tmuxService.captureTmuxPane(id, paneId);
  }, []);

  const createTmuxWindow = useCallback(async (sessionId: number, name?: string): Promise<void> => {
    await tmuxService.createTmuxWindow(sessionId, name);
  }, []);

  const closeTmuxWindow = useCallback(async (sessionId: number, windowId: string): Promise<void> => {
    await tmuxService.closeTmuxWindow(sessionId, windowId);
  }, []);

  const closeTmuxPane = useCallback(async (sessionId: number, paneId: string): Promise<void> => {
    await tmuxService.closeTmuxPane(sessionId, paneId);
  }, []);

  const splitTmuxPane = useCallback(async (sessionId: number, paneId: string, direction: "h" | "v" = "h"): Promise<void> => {
    await tmuxService.splitTmuxPane(sessionId, paneId, direction);
  }, []);

  const setActiveTmuxWindow = useCallback((sessionId: number, windowId: string) => {
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    (async () => {
      const unlistenSessionClosed = await listen<number>("session-closed", (event) => {
        const sessionId = event.payload;
        const timeoutId = tmuxListTimeoutsRef.current.get(sessionId);
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          tmuxListTimeoutsRef.current.delete(sessionId);
        }
        establishingSessionsRef.current.delete(sessionId);
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        setWorkspaces((prev) =>
          prev.map((workspace) => {
            const newRoot = removeSessionAndCollapse(workspace.rootPane, sessionId);
            const newActivePaneId = findPaneNode(newRoot, workspace.activePaneId ?? "")
              ? workspace.activePaneId
              : (getLeafPaneIds(newRoot)[0] ?? null);
            return { ...workspace, rootPane: newRoot, activePaneId: newActivePaneId };
          })
        );
        setTmuxState((prev) => {
          const next = cloneTmuxState(prev);
          for (const [_, state] of next.sessions) {
            if (state.windows.some((wid) => next.windows.get(wid)?.sessionId === String(sessionId))) {
              next.sessions.delete(state.id);
            }
          }
          for (const [wid, window] of next.windows) {
            if (window.sessionId === String(sessionId)) {
              next.windows.delete(wid);
            }
          }
          for (const [pid, pane] of next.panes) {
            if (pane.sessionId === String(sessionId)) {
              next.panes.delete(pid);
            }
          }
          return next;
        });
      });
      if (!cancelled) unlisteners.push(unlistenSessionClosed);
      else unlistenSessionClosed();

      const unlistenTmuxPaneOutput = await listen<[number, { paneId: string; data: number[] }]>("tmux-pane-output", () => {
        // Output bytes are delivered directly to Terminal.tsx listeners per pane.
        // No React state update is needed here.
      });
      if (!cancelled) unlisteners.push(unlistenTmuxPaneOutput);
      else unlistenTmuxPaneOutput();

      const unlistenTmuxRequestSync = await listen<[number, string]>("tmux-request-sync", (event) => {
        const [sessionId, command] = event.payload;
        tmuxService.writeTmuxCommand(sessionId, command).catch(console.error);
      });
      if (!cancelled) unlisteners.push(unlistenTmuxRequestSync);
      else unlistenTmuxRequestSync();

      const unlistenTmuxControlEvent = await listen<[number, TmuxControlEvent]>("tmux-control-event", (event) => {
        const [sessionId, controlEvent] = event.payload;
        const sessionIdKey = sessionId;
        setTmuxState((prev) => applyTmuxControlEvent(prev, String(sessionId), controlEvent));
        if (controlEvent.type === "SessionChanged") {
          establishingSessionsRef.current.delete(sessionId);
          tmuxService
            .listWindows(sessionId, controlEvent.sessionId)
            .catch(console.error);
        }
        if (controlEvent.type === "WindowClosed") {
          setActiveTmuxWindowIds((prev) => {
            const next = new Map(prev);
            const activeId = next.get(sessionIdKey);
            if (activeId === controlEvent.windowId) {
              next.delete(sessionIdKey);
            }
            return next;
          });
        }
        if (controlEvent.type === "WindowActivated") {
          setActiveTmuxWindowIds((prev) => {
            const next = new Map(prev);
            next.set(sessionIdKey, controlEvent.windowId);
            return next;
          });
        }
        if (controlEvent.type === "CommandError") {
          if (establishingSessionsRef.current.has(sessionId)) {
            establishingSessionsRef.current.delete(sessionId);
            sessionService.closeSession(sessionId).catch(console.error);
            setSessions((prev) => prev.filter((s) => s.id !== sessionId));
            setWorkspaces((prev) =>
              prev.map((workspace) => {
                const newRoot = removeSessionAndCollapse(workspace.rootPane, sessionId);
                const newActivePaneId = findPaneNode(newRoot, workspace.activePaneId ?? "")
                  ? workspace.activePaneId
                  : (getLeafPaneIds(newRoot)[0] ?? null);
                return { ...workspace, rootPane: newRoot, activePaneId: newActivePaneId };
              })
            );
            alert(`Tmux session failed: ${controlEvent.message}`);
          }
        }
      });
      if (!cancelled) unlisteners.push(unlistenTmuxControlEvent);
      else unlistenTmuxControlEvent();
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((cleanup) => cleanup());
      for (const timeoutId of tmuxListTimeoutsRef.current.values()) {
        clearTimeout(timeoutId);
      }
      tmuxListTimeoutsRef.current.clear();
    };
  }, []);

  return (
    <SessionContext.Provider
      value={{
        sessions,
        savedConfigs,
        workspaces,
        activeWorkspaceId,
        savedWorkspaces,
        groups,
        globalLocalEcho,
        setGlobalLocalEcho: setGlobalLocalEchoPersisted,
        getEffectiveLocalEcho,
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
        tmuxState,
        activeTmuxWindowIds,
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
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}
