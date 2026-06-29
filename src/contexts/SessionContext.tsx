import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { load } from "@tauri-apps/plugin-store";
import { listen } from "@tauri-apps/api/event";
import { Session, LocalSessionConfig, SSHSessionConfig, SavedSessionConfig, SessionGroup } from "../types/session";
import { TmuxState, TmuxControlEvent, SshTmuxSessionConfig, TmuxSessionConfig } from "../types/tmux";
import * as sessionService from "../services/sessionService";
import * as tmuxService from "../services/tmuxService";
import * as sessionStorage from "../services/sessionStorage";
import { applyTmuxControlEvent, cloneTmuxState } from "./tmuxStateReducer";

function generateId(): string {
  return crypto.randomUUID();
}

function getAdjacentSessionId(sessions: Session[], closedId: number): number | null {
  const index = sessions.findIndex((s) => s.id === closedId);
  if (index < 0) return null;
  if (index > 0) return sessions[index - 1].id;
  const next = sessions[index + 1];
  return next ? next.id : null;
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
  activeSessionId: number | null;
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
  reorderSessions: (fromIndex: number, toIndex: number) => void;
  createGroup: (name: string) => void;
  deleteGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  updateConfig: (config: SavedSessionConfig) => void;
  toggleGroup: (id: number) => void;
  setActiveSession: (id: number | null) => void;
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
}

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [savedConfigs, setSavedConfigs] = useState<SavedSessionConfig[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
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
  const establishingSessionsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    const init = async () => {
      const [configs, savedGroups] = await Promise.all([
        sessionStorage.loadSavedConfigs(),
        sessionStorage.loadSavedGroups(),
      ]);
      setSavedConfigs(configs);
      setGroups(savedGroups.groups);
      setNextGroupId(savedGroups.nextGroupId);

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

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    listen<number>("session-closed", (event) => {
      const sessionId = event.payload;
      establishingSessionsRef.current.delete(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setActiveSessionId((current) =>
        current === sessionId ? getAdjacentSessionId(sessionsRef.current, sessionId) : current
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
    }).then((fn) => cleanups.push(fn));

    listen<[number, { paneId: string; data: number[] }]>('tmux-pane-output', () => {
      // Output bytes are delivered directly to Terminal.tsx listeners per pane.
      // No React state update is needed here.
    }).then((fn) => cleanups.push(fn));

    listen<[number, string]>("tmux-request-sync", (event) => {
      const [sessionId, command] = event.payload;
      tmuxService.writeTmuxCommand(sessionId, command).catch(console.error);
    }).then((fn) => cleanups.push(fn));

    listen<[number, TmuxControlEvent]>("tmux-control-event", (event) => {
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
          setActiveSessionId((current) =>
            current === sessionId ? getAdjacentSessionId(sessionsRef.current, sessionId) : current
          );
          alert(`Tmux session failed: ${controlEvent.message}`);
        }
      }
    }).then((fn) => cleanups.push(fn));

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

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
      setActiveSessionId(session.id);

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

      return session;
    },
    [updateConfigs]
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
            config,
            save
          ));

      establishingSessionsRef.current.add(session.id);

      setTimeout(() => {
        tmuxService.listSessions(session.id).catch(console.error);
      }, 500);

      return session;
    },
    [createAndActivateSession]
  );

  const openFromConfig = useCallback(
    async (configId: string): Promise<Session> => {
      const config = savedConfigs.find((c) => c.id === configId);
      if (!config) throw new Error("Config not found");

      if (config.type === "local" && config.localConfig) {
        const info = await sessionService.createLocal(config.localConfig);
        const session = buildFrontendSession(info, configId, "local");
        setSessions((prev) => [...prev, session]);
        setActiveSessionId(session.id);
        return session;
      }

      if (config.type === "ssh" && config.sshConfig) {
        const info = await sessionService.createSsh(config.sshConfig);
        const session = buildFrontendSession(info, configId, "ssh");
        setSessions((prev) => [...prev, session]);
        setActiveSessionId(session.id);
        return session;
      }

      if (config.type === "tmux" && config.tmuxConfig) {
        const info = await tmuxService.createTmux(config.tmuxConfig);
        const session = buildFrontendSession(info, configId, "tmux");
        establishingSessionsRef.current.add(session.id);
        setSessions((prev) => [...prev, session]);
        setActiveSessionId(session.id);
        return session;
      }

      if (config.type === "ssh_tmux" && config.sshTmuxConfig) {
        const info = await tmuxService.createSshTmuxSession(config.sshTmuxConfig);
        const session = buildFrontendSession(info, configId, "ssh_tmux");
        establishingSessionsRef.current.add(session.id);
        setSessions((prev) => [...prev, session]);
        setActiveSessionId(session.id);
        return session;
      }

      throw new Error("Invalid config");
    },
    [savedConfigs]
  );

  const removeConfig = useCallback(
    (configId: string) => {
      updateConfigs((prev) => prev.filter((c) => c.id !== configId));
      updateGroups((prev) => prev.map((g) => ({ ...g, configIds: g.configIds.filter((id) => id !== configId) })));
      const session = sessions.find((s) => s.configId === configId);
      if (session) {
        sessionService.closeSession(session.id).catch(console.error);
        setSessions((prev) => prev.filter((s) => s.configId !== configId));
        setActiveSessionId((current) =>
          current === session.id ? getAdjacentSessionId(sessions, session.id) : current
        );
      }
    },
    [updateConfigs, updateGroups, sessions]
  );

  const closeSession = useCallback(async (id: number): Promise<void> => {
    await sessionService.closeSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveSessionId((current) =>
      current === id ? getAdjacentSessionId(sessions, id) : current
    );
  }, [sessions]);

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

  const reorderSessions = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex < 0 || fromIndex >= sessions.length || toIndex < 0 || toIndex > sessions.length || fromIndex === toIndex) {
      return;
    }
    if (toIndex > fromIndex) {
      toIndex -= 1;
    }
    setSessions((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  }, [sessions]);

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

  const setActiveSession = useCallback((id: number | null) => {
    setActiveSessionId(id);
  }, []);

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

  return (
    <SessionContext.Provider
      value={{
        sessions,
        savedConfigs,
        activeSessionId,
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
        reorderSessions,
        createGroup,
        deleteGroup,
        renameGroup,
        updateConfig,
        toggleGroup,
        setActiveSession,
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
