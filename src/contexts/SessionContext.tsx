import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Session, LocalSessionConfig, SSHSessionConfig, SessionGroup } from "../types/session";

interface SessionContextType {
  sessions: Session[];
  activeSessionId: number | null;
  groups: SessionGroup[];
  createLocalSession: (config: LocalSessionConfig) => Promise<Session>;
  createSshSession: (config: SSHSessionConfig) => Promise<Session>;
  closeSession: (id: number) => Promise<void>;
  addToGroup: (groupId: number, sessionId: number) => void;
  removeFromGroup: (groupId: number, sessionId: number) => void;
  renameSession: (id: number, name: string) => void;
  createGroup: (name: string) => void;
  deleteGroup: (id: number) => void;
  renameGroup: (id: number, name: string) => void;
  toggleGroup: (id: number) => void;
  setActiveSession: (id: number | null) => void;
  writeSession: (id: number, data: string) => Promise<void>;
  resizeSession: (id: number, rows: number, cols: number) => Promise<void>;
}

const SessionContext = createContext<SessionContextType | null>(null);

async function persistSessions(sessions: Session[]) {
  try {
    await invoke("save_sessions", { sessions });
  } catch (e) {
    console.error("Failed to save sessions:", e);
  }
}

async function persistGroups(groups: SessionGroup[]) {
  try {
    await invoke("save_groups", { groups });
  } catch (e) {
    console.error("Failed to save groups:", e);
  }
}

async function loadSavedSessions(): Promise<Session[]> {
  try {
    return await invoke<Session[]>("load_sessions");
  } catch (e) {
    console.error("Failed to load sessions:", e);
    return [];
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [nextGroupId, setNextGroupId] = useState(1);

  useEffect(() => {
    loadSavedSessions().then((saved) => {
      if (saved.length > 0) {
        setSessions(saved);
      }
    });
  }, []);

  useEffect(() => {
    let closedCleanup: (() => void) | null = null;

    listen<number>("session-closed", (event) => {
      const sessionId = event.payload;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, is_connected: false } : s
        )
      );
      setActiveSessionId((current) => (current === sessionId ? null : current));
    }).then((fn) => {
      closedCleanup = fn;
    });

    return () => {
      closedCleanup?.();
    };
  }, []);

  const createLocalSession = useCallback(async (config: LocalSessionConfig): Promise<Session> => {
    const session = await invoke<Session>("create_local_session", { config });
    setSessions((prev) => {
      const updated = [...prev, session];
      persistSessions(updated);
      return updated;
    });
    setActiveSessionId(session.id);
    return session;
  }, []);

  const createSshSession = useCallback(async (config: SSHSessionConfig): Promise<Session> => {
    const session = await invoke<Session>("create_ssh_session", { config });
    setSessions((prev) => {
      const updated = [...prev, session];
      persistSessions(updated);
      return updated;
    });
    setActiveSessionId(session.id);
    return session;
  }, []);

  const closeSession = useCallback(async (id: number): Promise<void> => {
    await invoke("close_session", { sessionId: id });
    setSessions((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      persistSessions(updated);
      return updated;
    });
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
  }, [activeSessionId]);

  const renameSession = useCallback((id: number, name: string) => {
    setSessions((prev) => {
      const updated = prev.map((s) =>
        s.id === id ? { ...s, name } : s
      );
      persistSessions(updated);
      return updated;
    });
  }, []);

  const createGroup = useCallback((name: string) => {
    const id = nextGroupId;
    setNextGroupId((prev) => prev + 1);
    setGroups((prev) => {
      const updated = [...prev, { id, name, sessionIds: [], collapsed: false }];
      persistGroups(updated);
      return updated;
    });
  }, [nextGroupId]);

  const deleteGroup = useCallback((id: number) => {
    setGroups((prev) => {
      const updated = prev.filter((g) => g.id !== id);
      persistGroups(updated);
      return updated;
    });
  }, []);

  const addToGroup = useCallback((groupId: number, sessionId: number) => {
    setGroups((prev) => {
      const updated = prev.map((g) =>
        g.id === groupId ? { ...g, sessionIds: [...g.sessionIds, sessionId] } : g
      );
      persistGroups(updated);
      return updated;
    });
  }, []);

  const removeFromGroup = useCallback((groupId: number, sessionId: number) => {
    setGroups((prev) => {
      const updated = prev.map((g) =>
        g.id === groupId ? { ...g, sessionIds: g.sessionIds.filter((sid) => sid !== sessionId) } : g
      );
      persistGroups(updated);
      return updated;
    });
  }, []);

  const renameGroup = useCallback((id: number, name: string) => {
    setGroups((prev) => {
      const updated = prev.map((g) =>
        g.id === id ? { ...g, name } : g
      );
      persistGroups(updated);
      return updated;
    });
  }, []);

  const toggleGroup = useCallback((id: number) => {
    setGroups((prev) => {
      const updated = prev.map((g) =>
        g.id === id ? { ...g, collapsed: !g.collapsed } : g
      );
      persistGroups(updated);
      return updated;
    });
  }, []);

  const setActiveSession = useCallback((id: number | null) => {
    setActiveSessionId(id);
  }, []);

  const writeSession = useCallback(async (id: number, data: string): Promise<void> => {
    const arr = Array.from(data).map((c) => c.charCodeAt(0));
    await invoke("write_session", { sessionId: id, data: arr });
  }, []);

  const resizeSession = useCallback(async (id: number, rows: number, cols: number): Promise<void> => {
    await invoke("resize_session", { sessionId: id, rows, cols });
  }, []);

  return (
    <SessionContext.Provider
      value={{
        sessions,
        activeSessionId,
        groups,
        createLocalSession,
        createSshSession,
        closeSession,
        addToGroup,
        removeFromGroup,
        renameSession,
        createGroup,
        deleteGroup,
        renameGroup,
        toggleGroup,
        setActiveSession,
        writeSession,
        resizeSession,
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
