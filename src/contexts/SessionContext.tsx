import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Session, LocalSessionConfig, SSHSessionConfig } from "../types/session";

interface SessionContextType {
  sessions: Session[];
  activeSessionId: number | null;
  createLocalSession: (config: LocalSessionConfig) => Promise<Session>;
  createSshSession: (config: SSHSessionConfig) => Promise<Session>;
  closeSession: (id: number) => Promise<void>;
  setActiveSession: (id: number | null) => void;
  writeSession: (id: number, data: string) => Promise<void>;
  resizeSession: (id: number, rows: number, cols: number) => Promise<void>;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);

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
    setSessions((prev) => [...prev, session]);
    setActiveSessionId(session.id);
    return session;
  }, []);

  const createSshSession = useCallback(async (config: SSHSessionConfig): Promise<Session> => {
    const session = await invoke<Session>("create_ssh_session", { config });
    setSessions((prev) => [...prev, session]);
    setActiveSessionId(session.id);
    return session;
  }, []);

  const closeSession = useCallback(async (id: number): Promise<void> => {
    await invoke("close_session", { sessionId: id });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
  }, [activeSessionId]);

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
        createLocalSession,
        createSshSession,
        closeSession,
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