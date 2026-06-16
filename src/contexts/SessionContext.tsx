import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { Session, LocalSessionConfig, SSHSessionConfig, TmuxSessionConfig, SavedSessionConfig, SessionGroup, TmuxState, TmuxControlEvent, TmuxWindow, TmuxPane } from "../types/session";
import * as sessionService from "../services/sessionService";
import * as tmuxService from "../services/tmuxService";
import * as sessionStorage from "../services/sessionStorage";

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

function cloneTmuxState(state: TmuxState): TmuxState {
  return {
    sessions: new Map(state.sessions),
    windows: new Map(state.windows),
    panes: new Map(state.panes),
  };
}

function applyTmuxControlEvent(
  state: TmuxState,
  _sessionId: string,
  event: TmuxControlEvent
): TmuxState {
  const next = cloneTmuxState(state);

  switch (event.type) {
    case "SessionChanged": {
      let session = next.sessions.get(event.sessionId);
      if (!session) {
        session = { id: event.sessionId, name: event.name, windows: [] };
        next.sessions.set(event.sessionId, session);
      }
      session.name = event.name;
      break;
    }
    case "SessionRenamed": {
      for (const session of next.sessions.values()) {
        if (session.id.startsWith("$")) {
          session.name = event.name;
        }
      }
      break;
    }
    case "WindowAdded": {
      const window: TmuxWindow = {
        ...event.window,
        panes: [...event.window.panes],
      };
      next.windows.set(window.id, window);
      const session = next.sessions.get(window.sessionId);
      if (session && !session.windows.includes(window.id)) {
        session.windows.push(window.id);
      }
      if (!session) {
        // The window arrived before its session metadata; request a refresh.
        tmuxService
          .writeTmuxCommand(
            Number.parseInt(window.sessionId, 10) || 0,
            `list-sessions\n`
          )
          .catch(console.error);
      }
      break;
    }
    case "WindowClosed": {
      const window = next.windows.get(event.windowId);
      if (window) {
        next.windows.delete(event.windowId);
        const session = next.sessions.get(window.sessionId);
        if (session) {
          session.windows = session.windows.filter((id) => id !== event.windowId);
        }
        for (const paneId of window.panes) {
          next.panes.delete(paneId);
        }
      }
      break;
    }
    case "WindowRenamed": {
      const window = next.windows.get(event.windowId);
      if (window) window.name = event.name;
      break;
    }
    case "WindowActivated": {
      const window = next.windows.get(event.windowId);
      if (window) {
        for (const [wid, w] of next.windows) {
          if (w.sessionId === window.sessionId) {
            w.isActive = wid === window.id;
          }
        }
        const session = next.sessions.get(window.sessionId);
        if (session) session.activeWindowId = window.id;
      }
      break;
    }
    case "LayoutChanged": {
      const window = next.windows.get(event.windowId);
      if (window) window.layout = event.layout;
      break;
    }
    case "PaneAdded": {
      const pane: TmuxPane = { ...event.pane };
      next.panes.set(pane.id, pane);
      const window = next.windows.get(pane.windowId);
      if (window && !window.panes.includes(pane.id)) {
        window.panes.push(pane.id);
      }
      break;
    }
    case "PaneClosed": {
      const pane = next.panes.get(event.paneId);
      if (pane) {
        next.panes.delete(event.paneId);
        const window = next.windows.get(pane.windowId);
        if (window) {
          window.panes = window.panes.filter((id) => id !== event.paneId);
        }
      }
      break;
    }
    case "PaneTitleChanged": {
      const pane = next.panes.get(event.paneId);
      if (pane) pane.title = event.title;
      break;
    }
    case "PaneModeChanged": {
      // Currently a no-op; could be used to show copy-mode indicator.
      break;
    }
    case "PanePaused": {
      const pane = next.panes.get(event.paneId);
      if (pane) pane.isPaused = true;
      break;
    }
    case "PaneContinued": {
      const pane = next.panes.get(event.paneId);
      if (pane) pane.isPaused = false;
      break;
    }
    case "Exit": {
      // Session closure is handled by the session-closed event.
      break;
    }
    case "Unknown": {
      break;
    }
  }

  return next;
}

const paneOutputHandlers = new Map<string, (data: Uint8Array) => void>();

export function registerTmuxPaneOutputHandler(
  paneId: string,
  handler: (data: Uint8Array) => void
): () => void {
  paneOutputHandlers.set(paneId, handler);
  return () => paneOutputHandlers.delete(paneId);
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
  createLocalSession: (config: LocalSessionConfig, save?: boolean) => Promise<Session>;
  createSshSession: (config: SSHSessionConfig, save?: boolean) => Promise<Session>;
  createTmuxSession: (config: TmuxSessionConfig, save?: boolean) => Promise<Session>;
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
  setActiveSession: (id: number | null) => void;
  writeSession: (id: number, data: string) => Promise<void>;
  resizeSession: (id: number, rows: number, cols: number) => Promise<void>;
  writeTmuxCommand: (id: number, command: string) => Promise<void>;
  resizeTmuxPane: (id: number, paneId: string, rows: number, cols: number) => Promise<void>;
  sendKeysToTmuxPane: (id: number, paneId: string, keys: string) => Promise<void>;
  tmuxState: TmuxState;
  activeTmuxWindowId: string | null;
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
  const [tmuxState, setTmuxState] = useState<TmuxState>({
    sessions: new Map(),
    windows: new Map(),
    panes: new Map(),
  });
  const [activeTmuxWindowId, setActiveTmuxWindowId] = useState<string | null>(null);
  const sessionsRef = useRef(sessions);

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
    };
    init();
  }, []);

  useEffect(() => {
    let closedCleanup: (() => void) | null = null;
    let paneOutputCleanup: (() => void) | null = null;
    let controlEventCleanup: (() => void) | null = null;

    listen<number>("session-closed", (event) => {
      const sessionId = event.payload;
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
    }).then((fn) => {
      closedCleanup = fn;
    });

    listen<[number, { paneId: string; data: number[] }]>("tmux-pane-output", (event) => {
      const [sessionId, output] = event.payload;
      const paneId = output.paneId;
      const data = new Uint8Array(output.data);
      const tmuxSessionId = String(sessionId);
      setTmuxState((prev) => {
        const next = cloneTmuxState(prev);
        const pane = next.panes.get(paneId);
        if (pane && pane.sessionId === tmuxSessionId) {
          paneOutputHandlers.get(paneId)?.(data);
        }
        return next;
      });
    }).then((fn) => {
      paneOutputCleanup = fn;
    });

    listen<[number, string]>("tmux-request-sync", (event) => {
      const [sessionId, command] = event.payload;
      tmuxService.writeTmuxCommand(sessionId, command).catch(console.error);
    }).then((fn) => {
      controlEventCleanup = fn;
    });

    listen<[number, TmuxControlEvent]>("tmux-control-event", (event) => {
      const [sessionId, controlEvent] = event.payload;
      setTmuxState((prev) => applyTmuxControlEvent(prev, String(sessionId), controlEvent));
      if (controlEvent.type === "SessionChanged") {
        tmuxService
          .writeTmuxCommand(sessionId, `list-windows -t ${controlEvent.sessionId}\n`)
          .catch(console.error);
      }
    }).then((fn) => {
      controlEventCleanup = fn;
    });

    return () => {
      closedCleanup?.();
      paneOutputCleanup?.();
      controlEventCleanup?.();
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
      config: LocalSessionConfig | SSHSessionConfig | TmuxSessionConfig,
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
            : { id: configId, name: info.name, type: "tmux", tmuxConfig: config as TmuxSessionConfig };
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
    async (config: TmuxSessionConfig, save = true): Promise<Session> => {
      return createAndActivateSession("tmux", () => tmuxService.createTmux(config), config, save);
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
    if (session?.type === "tmux") {
      throw new Error("Use sendKeysToTmuxPane for tmux sessions");
    }
    await sessionService.writeSession(id, data);
  }, [sessions]);

  const resizeSession = useCallback(async (id: number, rows: number, cols: number): Promise<void> => {
    const session = sessions.find((s) => s.id === id);
    if (session?.type === "tmux") {
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

  const createTmuxWindow = useCallback(async (sessionId: number, name?: string): Promise<void> => {
    await tmuxService.createTmuxWindow(sessionId, name);
  }, []);

  const closeTmuxWindow = useCallback(async (sessionId: number, windowId: string): Promise<void> => {
    await tmuxService.closeTmuxWindow(sessionId, windowId);
  }, []);

  const closeTmuxPane = useCallback(async (sessionId: number, paneId: string): Promise<void> => {
    await tmuxService.closeTmuxPane(sessionId, paneId);
  }, []);

  const setActiveTmuxWindow = useCallback((sessionId: number, windowId: string) => {
    setActiveTmuxWindowId(windowId);
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
        setActiveSession,
        writeSession,
        resizeSession,
        writeTmuxCommand,
        resizeTmuxPane,
        sendKeysToTmuxPane,
        tmuxState,
        activeTmuxWindowId,
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
