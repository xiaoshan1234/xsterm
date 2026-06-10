import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { load, Store } from "@tauri-apps/plugin-store";
import { Session, LocalSessionConfig, SSHSessionConfig, SavedSessionConfig, SessionGroup } from "../types/session";

interface GroupStore {
  groups: SessionGroup[];
  nextGroupId: number;
}

let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await load('sessions.json', { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

async function persistConfigs(configs: SavedSessionConfig[]) {
  try {
    const store = await getStore();
    await store.set('savedConfigs', configs);
    await store.save();
  } catch (e) {
    console.error("Failed to save configs:", e);
  }
}

async function persistGroups(groupsData: GroupStore) {
  try {
    const store = await getStore();
    await store.set('groups', groupsData.groups);
    await store.set('nextGroupId', groupsData.nextGroupId);
    await store.save();
  } catch (e) {
    console.error("Failed to save groups:", e);
  }
}

async function loadSavedConfigs(): Promise<SavedSessionConfig[]> {
  try {
    const store = await getStore();
    return (await store.get<SavedSessionConfig[]>('savedConfigs')) || [];
  } catch (e) {
    console.error("Failed to load configs:", e);
    return [];
  }
}

async function loadSavedGroups(): Promise<GroupStore> {
  try {
    const store = await getStore();
    const groups = await store.get<SessionGroup[]>('groups');
    const nextGroupId = await store.get<number>('nextGroupId') || 1;
    return { groups: groups || [], nextGroupId };
  } catch (e) {
    console.error("Failed to load groups:", e);
    return { groups: [], nextGroupId: 1 };
  }
}

function generateId(): string {
  return crypto.randomUUID();
}

interface SessionContextType {
  sessions: Session[];
  savedConfigs: SavedSessionConfig[];
  activeSessionId: number | null;
  groups: SessionGroup[];
  createLocalSession: (config: LocalSessionConfig, save?: boolean) => Promise<Session>;
  createSshSession: (config: SSHSessionConfig, save?: boolean) => Promise<Session>;
  connectConfig: (configId: string) => Promise<Session>;
  removeConfig: (configId: string) => void;
  closeSession: (id: number) => Promise<void>;
  addToGroup: (groupId: number, configId: string) => void;
  removeFromGroup: (groupId: number, configId: string) => void;
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [savedConfigs, setSavedConfigs] = useState<SavedSessionConfig[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [nextGroupId, setNextGroupId] = useState(1);

  useEffect(() => {
    const init = async () => {
      const [configs, savedGroups] = await Promise.all([
        loadSavedConfigs(),
        loadSavedGroups(),
      ]);
      setSavedConfigs(configs);
      setGroups(savedGroups.groups);
      setNextGroupId(savedGroups.nextGroupId);
    };
    init();
  }, []);

  useEffect(() => {
    let closedCleanup: (() => void) | null = null;

    listen<number>("session-closed", (event) => {
      const sessionId = event.payload;
      setSessions((prev) =>
        prev.filter((s) => s.id !== sessionId)
      );
      setActiveSessionId((current) => (current === sessionId ? null : current));
    }).then((fn) => {
      closedCleanup = fn;
    });

    return () => {
      closedCleanup?.();
    };
  }, []);

  const createLocalSession = useCallback(async (config: LocalSessionConfig, save = true): Promise<Session> => {
    const configId = generateId();
    const info = await invoke<Session>("create_local_session", { config });

    const name = info.name;
    const session: Session = {
      id: info.id,
      configId,
      name,
      type: "local",
      is_connected: info.is_connected,
      session_type: info.session_type as Session["session_type"],
    };

    setSessions((prev) => [...prev, session]);
    setActiveSessionId(session.id);

    if (save) {
      const savedConfig: SavedSessionConfig = {
        id: configId,
        name,
        type: "local",
        localConfig: config,
      };
      setSavedConfigs((prev) => {
        const updated = [...prev, savedConfig];
        persistConfigs(updated);
        return updated;
      });
    }

    return session;
  }, []);

  const createSshSession = useCallback(async (config: SSHSessionConfig, save = true): Promise<Session> => {
    const configId = generateId();
    const info = await invoke<Session>("create_ssh_session", { config });

    const name = info.name;
    const session: Session = {
      id: info.id,
      configId,
      name,
      type: "ssh",
      is_connected: info.is_connected,
      session_type: info.session_type as Session["session_type"],
    };

    setSessions((prev) => [...prev, session]);
    setActiveSessionId(session.id);

    if (save) {
      const savedConfig: SavedSessionConfig = {
        id: configId,
        name,
        type: "ssh",
        sshConfig: config,
      };
      setSavedConfigs((prev) => {
        const updated = [...prev, savedConfig];
        persistConfigs(updated);
        return updated;
      });
    }

    return session;
  }, []);

  const connectConfig = useCallback(async (configId: string): Promise<Session> => {
    const config = savedConfigs.find((c) => c.id === configId);
    if (!config) throw new Error("Config not found");

    const existing = sessions.find((s) => s.configId === configId);
    if (existing) {
      setActiveSessionId(existing.id);
      return existing;
    }

    if (config.type === "local" && config.localConfig) {
      const info = await invoke<Session>("create_local_session", { config: config.localConfig });
      const session: Session = {
        id: info.id,
        configId,
        name: config.name,
        type: "local",
        is_connected: info.is_connected,
        session_type: info.session_type as Session["session_type"],
      };
      setSessions((prev) => [...prev, session]);
      setActiveSessionId(session.id);
      return session;
    }

    if (config.type === "ssh" && config.sshConfig) {
      const info = await invoke<Session>("create_ssh_session", { config: config.sshConfig });
      const session: Session = {
        id: info.id,
        configId,
        name: config.name,
        type: "ssh",
        is_connected: info.is_connected,
        session_type: info.session_type as Session["session_type"],
      };
      setSessions((prev) => [...prev, session]);
      setActiveSessionId(session.id);
      return session;
    }

    throw new Error("Invalid config");
  }, [savedConfigs, sessions]);

  const removeConfig = useCallback((configId: string) => {
    setSavedConfigs((prev) => {
      const updated = prev.filter((c) => c.id !== configId);
      persistConfigs(updated);
      return updated;
    });
    setGroups((prev) => {
      const updated = prev.map((g) => ({
        ...g,
        configIds: g.configIds.filter((id) => id !== configId),
      }));
      persistGroups({ groups: updated, nextGroupId });
      return updated;
    });
    const session = sessions.find((s) => s.configId === configId);
    if (session) {
      invoke("close_session", { sessionId: session.id }).catch(console.error);
      setSessions((prev) => prev.filter((s) => s.configId !== configId));
      if (activeSessionId === session.id) setActiveSessionId(null);
    }
  }, [sessions, activeSessionId, nextGroupId]);

  const closeSession = useCallback(async (id: number): Promise<void> => {
    await invoke("close_session", { sessionId: id });
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) setActiveSessionId(null);
  }, [activeSessionId]);

  const renameSession = useCallback((id: number, name: string) => {
    setSessions((prev) => {
      const updated = prev.map((s) =>
        s.id === id ? { ...s, name } : s
      );
      return updated;
    });
    const session = sessions.find((s) => s.id === id);
    if (session) {
      setSavedConfigs((prev) => {
        const updated = prev.map((c) =>
          c.id === session.configId ? { ...c, name } : c
        );
        persistConfigs(updated);
        return updated;
      });
    }
  }, [sessions]);

  const createGroup = useCallback((name: string) => {
    const id = nextGroupId;
    setNextGroupId((prev) => prev + 1);
    setGroups((prev) => {
      const updated = [...prev, { id, name, configIds: [], collapsed: false }];
      persistGroups({ groups: updated, nextGroupId: id + 1 });
      return updated;
    });
  }, [nextGroupId]);

  const deleteGroup = useCallback((id: number) => {
    setGroups((prev) => {
      const updated = prev.filter((g) => g.id !== id);
      persistGroups({ groups: updated, nextGroupId });
      return updated;
    });
  }, [nextGroupId]);

  const addToGroup = useCallback((groupId: number, configId: string) => {
    setGroups((prev) => {
      const updated = prev.map((g) =>
        g.id === groupId ? { ...g, configIds: [...g.configIds, configId] } : g
      );
      persistGroups({ groups: updated, nextGroupId });
      return updated;
    });
  }, [nextGroupId]);

  const removeFromGroup = useCallback((groupId: number, configId: string) => {
    setGroups((prev) => {
      const updated = prev.map((g) =>
        g.id === groupId ? { ...g, configIds: g.configIds.filter((cid) => cid !== configId) } : g
      );
      persistGroups({ groups: updated, nextGroupId });
      return updated;
    });
  }, [nextGroupId]);

  const renameGroup = useCallback((id: number, name: string) => {
    setGroups((prev) => {
      const updated = prev.map((g) =>
        g.id === id ? { ...g, name } : g
      );
      persistGroups({ groups: updated, nextGroupId });
      return updated;
    });
  }, [nextGroupId]);

  const toggleGroup = useCallback((id: number) => {
    setGroups((prev) => {
      const updated = prev.map((g) =>
        g.id === id ? { ...g, collapsed: !g.collapsed } : g
      );
      persistGroups({ groups: updated, nextGroupId });
      return updated;
    });
  }, [nextGroupId]);

  const setActiveSession = useCallback((id: number | null) => {
    setActiveSessionId(id);
  }, []);

  const writeSession = useCallback(async (id: number, data: string): Promise<void> => {
    const encoded = new TextEncoder().encode(data);
    const arr = Array.from(encoded);
    await invoke("write_session", { sessionId: id, data: arr });
  }, []);

  const resizeSession = useCallback(async (id: number, rows: number, cols: number): Promise<void> => {
    await invoke("resize_session", { sessionId: id, rows, cols });
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
        connectConfig,
        removeConfig,
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