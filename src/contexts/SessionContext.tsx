import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { load } from "@tauri-apps/plugin-store";
import { listen } from "@tauri-apps/api/event";
import { Session, LocalSessionConfig, SSHSessionConfig, SavedSessionConfig, SessionGroup, SessionPane, PaneLayout } from "../types/session";
import { TmuxState, TmuxControlEvent, SshTmuxSessionConfig, TmuxSessionConfig } from "../types/tmux";
import * as sessionService from "../services/sessionService";
import * as tmuxService from "../services/tmuxService";
import * as sessionStorage from "../services/sessionStorage";
import { applyTmuxControlEvent, cloneTmuxState } from "./tmuxStateReducer";

function generateId(): string {
  return crypto.randomUUID();
}

export function getVisiblePanes(layout: PaneLayout): SessionPane[] {
  switch (layout) {
    case "1":
      return [1];
    case "2-v":
    case "2-h":
      return [1, 2];
    case "3-left-big":
    case "3-right-big":
    case "3-top-big":
    case "3-bottom-big":
      return [1, 2, 3];
    case "4":
      return [1, 2, 3, 4];
    default:
      return [1];
  }
}

function getAdjacentSessionId(sessions: Session[], closedId: number, pane: SessionPane): number | null {
  const paneSessions = sessions.filter((s) => (s.pane ?? 1) === pane);
  const index = paneSessions.findIndex((s) => s.id === closedId);
  if (index < 0) return null;
  if (index > 0) return paneSessions[index - 1].id;
  const next = paneSessions[index + 1];
  return next ? next.id : null;
}

function buildFrontendSession(info: sessionService.SessionInfo, configId: string, type: Session["type"], pane: SessionPane = 1): Session {
  return {
    id: info.id,
    configId,
    name: info.name,
    type,
    is_connected: info.is_connected,
    session_type: info.session_type,
    pane,
  };
}

interface SessionContextType {
  sessions: Session[];
  savedConfigs: SavedSessionConfig[];
  activeSessionIds: Map<SessionPane, number>;
  focusedPane: SessionPane;
  groups: SessionGroup[];
  sessionPanes: Map<number, SessionPane>;
  paneLayout: PaneLayout;
  setPaneLayout: (layout: PaneLayout) => void;
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
  reorderSessionsInPane: (pane: SessionPane, fromIndex: number, toIndex: number) => void;
  createGroup: (name: string) => void;
  deleteGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  updateConfig: (config: SavedSessionConfig) => void;
  toggleGroup: (id: number) => void;
  setActiveSession: (pane: SessionPane, id: number | null) => void;
  setFocusedPane: (pane: SessionPane) => void;
  moveSessionToPane: (sessionId: number, pane: SessionPane) => void;
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
  const [activeSessionIds, setActiveSessionIds] = useState<Map<SessionPane, number>>(new Map());
  const [focusedPane, setFocusedPaneState] = useState<SessionPane>(1);
  const [sessionPanes, setSessionPanes] = useState<Map<number, SessionPane>>(new Map());
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [nextGroupId, setNextGroupId] = useState(1);
  const [paneLayout, setPaneLayoutState] = useState<PaneLayout>("1");
  const [globalLocalEcho, setGlobalLocalEcho] = useState(false);
  const [sessionLocalEchoOverrides] = useState<Map<number, boolean>>(new Map());
  const [tmuxState, setTmuxState] = useState<TmuxState>({
    sessions: new Map(),
    windows: new Map(),
    panes: new Map(),
  });
  const [activeTmuxWindowIds, setActiveTmuxWindowIds] = useState<Map<number, string>>(new Map());
  const sessionsRef = useRef(sessions);
  const activeSessionIdsRef = useRef(activeSessionIds);
  const sessionPanesRef = useRef(sessionPanes);
  const establishingSessionsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    activeSessionIdsRef.current = activeSessionIds;
  }, [activeSessionIds]);

  useEffect(() => {
    sessionPanesRef.current = sessionPanes;
  }, [sessionPanes]);

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

  const setActiveSession = useCallback((pane: SessionPane, id: number | null) => {
    setActiveSessionIds((prev) => {
      const next = new Map(prev);
      if (id === null) {
        next.delete(pane);
      } else {
        next.set(pane, id);
      }
      return next;
    });
  }, []);

  const setFocusedPane = useCallback((pane: SessionPane) => {
    setFocusedPaneState(pane);
  }, []);

  const updateActiveSessionAfterClose = useCallback((closedSessionId: number, pane: SessionPane, currentSessions: Session[]) => {
    setActiveSessionIds((prev) => {
      const next = new Map(prev);
      if (next.get(pane) === closedSessionId) {
        const adjacent = getAdjacentSessionId(currentSessions, closedSessionId, pane);
        if (adjacent !== null) {
          next.set(pane, adjacent);
        } else {
          next.delete(pane);
        }
      }
      return next;
    });
  }, []);

  const moveSessionToPane = useCallback((sessionId: number, pane: SessionPane) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const sourcePane = session.pane ?? 1;
    if (sourcePane === pane) return;

    setSessionPanes((prev) => {
      const next = new Map(prev);
      next.set(sessionId, pane);
      return next;
    });
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, pane } : s)));

    setActiveSessionIds((prev) => {
      const next = new Map(prev);
      if (next.get(sourcePane) === sessionId) {
        const adjacent = getAdjacentSessionId(sessions, sessionId, sourcePane);
        if (adjacent !== null) {
          next.set(sourcePane, adjacent);
        } else {
          next.delete(sourcePane);
        }
      }
      next.set(pane, sessionId);
      return next;
    });

    setFocusedPane(pane);
  }, [sessions]);

  const setPaneLayout = useCallback((layout: PaneLayout) => {
    const visiblePanes = getVisiblePanes(layout);
    const firstVisible = visiblePanes[0];
    setPaneLayoutState(layout);
    setSessions((prev) =>
      prev.map((s) => {
        const currentPane = s.pane ?? 1;
        return visiblePanes.includes(currentPane) ? s : { ...s, pane: firstVisible };
      })
    );
    setSessionPanes((prev) => {
      const next = new Map(prev);
      for (const [id, pane] of next) {
        if (!visiblePanes.includes(pane)) {
          next.set(id, firstVisible);
        }
      }
      return next;
    });
    setActiveSessionIds((prev) => {
      const next = new Map(prev);
      for (const pane of prev.keys()) {
        if (!visiblePanes.includes(pane)) {
          next.delete(pane);
        }
      }
      for (const pane of visiblePanes) {
        const activeId = next.get(pane);
        const activeSession = sessions.find((s) => s.id === activeId && (s.pane ?? 1) === pane);
        if (!activeSession) {
          const firstInPane = sessions.find((s) => (s.pane ?? 1) === pane);
          if (firstInPane) {
            next.set(pane, firstInPane.id);
          } else {
            next.delete(pane);
          }
        }
      }
      return next;
    });
    setFocusedPaneState((current) => (visiblePanes.includes(current) ? current : firstVisible));
  }, [sessions]);

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    listen<number>("session-closed", (event) => {
      const sessionId = event.payload;
      establishingSessionsRef.current.delete(sessionId);
      const closedSession = sessionsRef.current.find((s) => s.id === sessionId);
      const closedPane = closedSession ? (closedSession.pane ?? 1) : 1;
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setSessionPanes((prev) => {
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
      updateActiveSessionAfterClose(sessionId, closedPane, sessionsRef.current);
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

    listen<[number, { paneId: string; data: number[] }]>("tmux-pane-output", () => {
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
          const failedSession = sessionsRef.current.find((s) => s.id === sessionId);
          const failedPane = failedSession ? (failedSession.pane ?? 1) : 1;
          setSessions((prev) => prev.filter((s) => s.id !== sessionId));
          updateActiveSessionAfterClose(sessionId, failedPane, sessionsRef.current);
          setSessionPanes((prev) => {
            const next = new Map(prev);
            next.delete(sessionId);
            return next;
          });
          alert(`Tmux session failed: ${controlEvent.message}`);
        }
      }
    }).then((fn) => cleanups.push(fn));

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [updateActiveSessionAfterClose]);

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
      save: boolean,
      pane: SessionPane = getVisiblePanes(paneLayout)[0]
    ): Promise<Session> => {
      const configId = generateId();
      const info = await create();
      const session = buildFrontendSession(info, configId, type, pane);

      setSessions((prev) => [...prev, session]);
      setSessionPanes((prev) => {
        const next = new Map(prev);
        next.set(session.id, pane);
        return next;
      });
      setActiveSession(pane, session.id);
      setFocusedPane(pane);

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
    [updateConfigs, setActiveSession, setFocusedPane, paneLayout]
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
      const defaultPane = getVisiblePanes(paneLayout)[0];

      if (config.type === "local" && config.localConfig) {
        const info = await sessionService.createLocal(config.localConfig);
        const session = buildFrontendSession(info, configId, "local", defaultPane);
        setSessions((prev) => [...prev, session]);
        setSessionPanes((prev) => {
          const next = new Map(prev);
          next.set(session.id, defaultPane);
          return next;
        });
        setActiveSession(defaultPane, session.id);
        setFocusedPane(defaultPane);
        return session;
      }

      if (config.type === "ssh" && config.sshConfig) {
        const info = await sessionService.createSsh(config.sshConfig);
        const session = buildFrontendSession(info, configId, "ssh", defaultPane);
        setSessions((prev) => [...prev, session]);
        setSessionPanes((prev) => {
          const next = new Map(prev);
          next.set(session.id, defaultPane);
          return next;
        });
        setActiveSession(defaultPane, session.id);
        setFocusedPane(defaultPane);
        return session;
      }

      if (config.type === "tmux" && config.tmuxConfig) {
        const info = await tmuxService.createTmux(config.tmuxConfig);
        const session = buildFrontendSession(info, configId, "tmux", defaultPane);
        establishingSessionsRef.current.add(session.id);
        setSessions((prev) => [...prev, session]);
        setSessionPanes((prev) => {
          const next = new Map(prev);
          next.set(session.id, defaultPane);
          return next;
        });
        setActiveSession(defaultPane, session.id);
        setFocusedPane(defaultPane);
        return session;
      }

      if (config.type === "ssh_tmux" && config.sshTmuxConfig) {
        const info = await tmuxService.createSshTmuxSession(config.sshTmuxConfig);
        const session = buildFrontendSession(info, configId, "ssh_tmux", defaultPane);
        establishingSessionsRef.current.add(session.id);
        setSessions((prev) => [...prev, session]);
        setSessionPanes((prev) => {
          const next = new Map(prev);
          next.set(session.id, defaultPane);
          return next;
        });
        setActiveSession(defaultPane, session.id);
        setFocusedPane(defaultPane);
        return session;
      }

      throw new Error("Invalid config");
    },
    [savedConfigs, setActiveSession, setFocusedPane, paneLayout]
  );

  const removeConfig = useCallback(
    (configId: string) => {
      updateConfigs((prev) => prev.filter((c) => c.id !== configId));
      updateGroups((prev) => prev.map((g) => ({ ...g, configIds: g.configIds.filter((id) => id !== configId) })));
      const session = sessions.find((s) => s.configId === configId);
      if (session) {
        sessionService.closeSession(session.id).catch(console.error);
        setSessions((prev) => prev.filter((s) => s.configId !== configId));
        setSessionPanes((prev) => {
          const next = new Map(prev);
          next.delete(session.id);
          return next;
        });
        updateActiveSessionAfterClose(session.id, session.pane ?? 1, sessions);
      }
    },
    [updateConfigs, updateGroups, sessions, updateActiveSessionAfterClose]
  );

  const closeSession = useCallback(async (id: number): Promise<void> => {
    await sessionService.closeSession(id);
    const session = sessions.find((s) => s.id === id);
    const pane = session?.pane ?? 1;
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setSessionPanes((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    updateActiveSessionAfterClose(id, pane, sessions);
  }, [sessions, updateActiveSessionAfterClose]);

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

  const reorderSessionsInPane = useCallback((pane: SessionPane, fromIndex: number, toIndex: number) => {
    const paneSessions = sessions.filter((s) => (s.pane ?? 1) === pane);
    if (fromIndex < 0 || fromIndex >= paneSessions.length || toIndex < 0 || toIndex > paneSessions.length || fromIndex === toIndex) {
      return;
    }
    let adjustedTo = toIndex;
    if (adjustedTo > fromIndex) {
      adjustedTo -= 1;
    }
    const movedSession = paneSessions[fromIndex];
    const orderedPaneIds = paneSessions.map((s) => s.id);
    orderedPaneIds.splice(fromIndex, 1);
    orderedPaneIds.splice(adjustedTo, 0, movedSession.id);

    setSessions((prev) => {
      const otherSessions = prev.filter((s) => (s.pane ?? 1) !== pane);
      const reorderedPaneSessions = orderedPaneIds
        .map((id) => prev.find((s) => s.id === id))
        .filter((s): s is Session => Boolean(s));
      return [...otherSessions, ...reorderedPaneSessions];
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
        activeSessionIds,
        focusedPane,
        groups,
        sessionPanes,
        paneLayout,
        setPaneLayout,
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
        reorderSessionsInPane,
        createGroup,
        deleteGroup,
        renameGroup,
        updateConfig,
        toggleGroup,
        setActiveSession,
        setFocusedPane,
        moveSessionToPane,
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
