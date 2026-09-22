/**
 * Session service store — single source of truth for backend
 * `Session` registry + tmux retry-banner state.
 *
 * **State ownership**:
 * - `sessions`, `sessionsRef`, `establishingSessionsRef`,
 *   `sessionLocalEchoOverrides`, `getEffectiveLocalEcho`,
 *   `globalLocalEcho`, `setGlobalLocalEcho` — owned here because
 *   they all describe a session's view-model state (one row per
 *   backend session). The tmux retry-banner state and tmux
 *   controller refs are co-located because the
 *   `tmux-controller-exit` listener and the retry banner both reach
 *   through this store's actions; see `service/tmux/store.ts` for
 *   the cross-service write surface (a `tmux:*` action can mutate
 *   session rows by id).
 *
 * **Refs are in-store (not module-level)** so the values survive
 * HMR + strict-mode double mount; the previous
 * `useRef` pattern was equivalent because React refs live on the
 * component instance, but here we move the values into the store so
 * non-React callers (action functions, bridges) can read them
 * synchronously via `useSessionStore.getState()`.
 *
 * **Actions are stubs** — Commit 4 fills them in.
 */
import { create } from "zustand";
import type { Session, TmuxCcConfig, TmuxControllerError, TmuxWindowListEntry } from "../../model";

export interface SessionStoreState {
  // --- session registry -----------------------------------------------
  sessions: Session[];
  setSessions: (next: Session[] | ((prev: Session[]) => Session[])) => void;
  /** Latest sessions mirror for synchronous non-React reads. */
  sessionsRef: { current: Session[] };
  /** Session ids whose backend connection is mid-establish. */
  establishingSessionsRef: { current: Set<number> };

  // --- local-echo settings --------------------------------------------
  globalLocalEcho: boolean;
  setGlobalLocalEcho: (enabled: boolean) => void;
  sessionLocalEchoOverrides: Map<number, boolean>;
  getEffectiveLocalEcho: (sessionId: number) => boolean;

  // --- tmux retry-banner state -----------------------------------------
  tmuxControllerErrors: Map<number, TmuxControllerError>;
  setTmuxControllerErrors: (
    next:
      | Map<number, TmuxControllerError>
      | ((prev: Map<number, TmuxControllerError>) => Map<number, TmuxControllerError>),
  ) => void;
  /** `controllerId → TmuxCcConfig` for retry banner. Survives pane teardown. */
  tmuxControllerConfigsRef: { current: Map<number, TmuxCcConfig> };
  /** `controllerId → TmuxWindowListEntry[]` cache. ADR 0009 §2.6. */
  tmuxWindowListsRef: { current: Map<number, TmuxWindowListEntry[]> };

  // --- mutating actions (stubs in Commit 3, real in Commit 4) --------
  addSession: (session: Session) => void;
  removeSession: (id: number) => void;
  updateSession: (id: number, patch: Partial<Session>) => void;
  markSessionConnected: (id: number, isConnected: boolean) => void;
  setSessionName: (id: number, name: string) => void;
  applyDisplayConfig: (id: number, patch: Partial<Session["displayConfig"]>) => void;
  beginEstablishing: (id: number) => void;
  endEstablishing: (id: number) => void;
  setGlobalLocalEchoAction: (enabled: boolean) => void;
  setSessionLocalEchoOverride: (id: number, enabled: boolean | undefined) => void;
  setTmuxControllerError: (controllerId: number, error: TmuxControllerError | undefined) => void;
  rememberTmuxControllerConfig: (controllerId: number, config: TmuxCcConfig) => void;
  forgetTmuxControllerConfig: (controllerId: number) => void;
  rememberTmuxWindowList: (controllerId: number, entries: TmuxWindowListEntry[]) => void;
  upsertTmuxWindowListEntry: (controllerId: number, entry: TmuxWindowListEntry) => void;
  removeTmuxWindowListEntry: (controllerId: number, tmuxWindowId: string) => void;
  renameTmuxWindowListEntry: (controllerId: number, tmuxWindowId: string, name: string) => void;
  reset: () => void;
}

const initialSessions: Session[] = [];
const initialTmuxErrors = new Map<number, TmuxControllerError>();
const initialOverrides = new Map<number, boolean>();
const initialTmuxConfigsRef = { current: new Map<number, TmuxCcConfig>() };
const initialTmuxWindowsRef = { current: new Map<number, TmuxWindowListEntry[]>() };
const initialSessionsRef = { current: initialSessions };
const initialEstablishingRef = { current: new Set<number>() };

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  sessions: initialSessions,
  setSessions: (next) => {
    set((state) => {
      const resolved =
        typeof next === "function" ? (next as (p: Session[]) => Session[])(state.sessions) : next;
      initialSessionsRef.current = resolved;
      return { sessions: resolved };
    });
  },
  sessionsRef: initialSessionsRef,
  establishingSessionsRef: initialEstablishingRef,

  globalLocalEcho: false,
  setGlobalLocalEcho: (enabled) => set({ globalLocalEcho: enabled }),
  sessionLocalEchoOverrides: initialOverrides,
  getEffectiveLocalEcho: (sessionId) => {
    const { sessionLocalEchoOverrides, globalLocalEcho } = get();
    const override = sessionLocalEchoOverrides.get(sessionId);
    return override ?? globalLocalEcho;
  },

  tmuxControllerErrors: initialTmuxErrors,
  setTmuxControllerErrors: (next) => {
    set((state) => {
      const resolved =
        typeof next === "function"
          ? (next as (p: Map<number, TmuxControllerError>) => Map<number, TmuxControllerError>)(
              state.tmuxControllerErrors,
            )
          : next;
      return { tmuxControllerErrors: resolved };
    });
  },
  tmuxControllerConfigsRef: initialTmuxConfigsRef,
  tmuxWindowListsRef: initialTmuxWindowsRef,

  // Session registry mutations also write through `sessionsRef.current`
  // so non-React callers see the latest snapshot synchronously.
  addSession: (session) => {
    set((state) => {
      if (state.sessions.some((s) => s.id === session.id)) return state;
      const sessions = [...state.sessions, session];
      initialSessionsRef.current = sessions;
      return { sessions };
    });
  },
  removeSession: (id) => {
    set((state) => {
      if (!state.sessions.some((s) => s.id === id)) return state;
      const sessions = state.sessions.filter((s) => s.id !== id);
      initialSessionsRef.current = sessions;
      return { sessions };
    });
  },
  updateSession: (id, patch) => {
    set((state) => {
      let changed = false;
      const sessions = state.sessions.map((s) => {
        if (s.id !== id) return s;
        changed = true;
        return { ...s, ...patch };
      });
      if (!changed) return state;
      initialSessionsRef.current = sessions;
      return { sessions };
    });
  },
  markSessionConnected: (id, isConnected) => {
    set((state) => {
      let changed = false;
      const sessions = state.sessions.map((s) => {
        if (s.id !== id) return s;
        if (s.isConnected === isConnected) return s;
        changed = true;
        return { ...s, isConnected };
      });
      if (!changed) return state;
      initialSessionsRef.current = sessions;
      return { sessions };
    });
  },
  setSessionName: (id, name) => {
    set((state) => {
      let changed = false;
      const sessions = state.sessions.map((s) => {
        if (s.id !== id) return s;
        if (s.name === name) return s;
        changed = true;
        return { ...s, name };
      });
      if (!changed) return state;
      initialSessionsRef.current = sessions;
      return { sessions };
    });
  },
  applyDisplayConfig: (id, patch) => {
    set((state) => {
      let changed = false;
      const sessions = state.sessions.map((s) => {
        if (s.id !== id) return s;
        const merged = { ...(s.displayConfig ?? {}), ...patch } as Session["displayConfig"];
        if (merged === s.displayConfig) return s;
        changed = true;
        return { ...s, displayConfig: merged };
      });
      if (!changed) return state;
      initialSessionsRef.current = sessions;
      return { sessions };
    });
  },
  beginEstablishing: (id) => {
    const ref = get().establishingSessionsRef;
    if (ref.current.has(id)) return;
    const next = new Set(ref.current);
    next.add(id);
    ref.current = next;
  },
  endEstablishing: (id) => {
    const ref = get().establishingSessionsRef;
    if (!ref.current.has(id)) return;
    const next = new Set(ref.current);
    next.delete(id);
    ref.current = next;
  },
  setGlobalLocalEchoAction: (enabled) => set({ globalLocalEcho: enabled }),
  setSessionLocalEchoOverride: (id, enabled) => {
    set((state) => {
      const next = new Map(state.sessionLocalEchoOverrides);
      if (enabled === undefined) {
        next.delete(id);
      } else {
        next.set(id, enabled);
      }
      return { sessionLocalEchoOverrides: next };
    });
  },
  setTmuxControllerError: (controllerId, error) => {
    set((state) => {
      const next = new Map(state.tmuxControllerErrors);
      if (error === undefined) {
        next.delete(controllerId);
      } else {
        next.set(controllerId, error);
      }
      return { tmuxControllerErrors: next };
    });
  },
  rememberTmuxControllerConfig: (controllerId, config) => {
    const ref = get().tmuxControllerConfigsRef;
    const next = new Map(ref.current);
    next.set(controllerId, config);
    ref.current = next;
  },
  forgetTmuxControllerConfig: (controllerId) => {
    const ref = get().tmuxControllerConfigsRef;
    if (!ref.current.has(controllerId)) return;
    const next = new Map(ref.current);
    next.delete(controllerId);
    ref.current = next;
  },
  rememberTmuxWindowList: (controllerId, entries) => {
    const ref = get().tmuxWindowListsRef;
    const next = new Map(ref.current);
    next.set(controllerId, entries);
    ref.current = next;
  },
  upsertTmuxWindowListEntry: (controllerId, entry) => {
    const ref = get().tmuxWindowListsRef;
    const existing = ref.current.get(controllerId) ?? [];
    const filtered = existing.filter((e) => e.tmuxServerWindowId !== entry.tmuxServerWindowId);
    const next = new Map(ref.current);
    next.set(controllerId, [...filtered, entry]);
    ref.current = next;
  },
  removeTmuxWindowListEntry: (controllerId, tmuxWindowId) => {
    const ref = get().tmuxWindowListsRef;
    const existing = ref.current.get(controllerId);
    if (!existing) return;
    const filtered = existing.filter((e) => e.tmuxServerWindowId !== tmuxWindowId);
    const next = new Map(ref.current);
    if (filtered.length === 0) {
      next.delete(controllerId);
    } else {
      next.set(controllerId, filtered);
    }
    ref.current = next;
  },
  renameTmuxWindowListEntry: (controllerId, tmuxWindowId, name) => {
    const ref = get().tmuxWindowListsRef;
    const existing = ref.current.get(controllerId);
    if (!existing) return;
    const renamed = existing.map((e) =>
      e.tmuxServerWindowId === tmuxWindowId ? { ...e, name } : e,
    );
    const next = new Map(ref.current);
    next.set(controllerId, renamed);
    ref.current = next;
  },
  reset: () => {
    initialSessionsRef.current = [];
    initialEstablishingRef.current = new Set();
    set({
      sessions: [],
      sessionLocalEchoOverrides: new Map(),
      tmuxControllerErrors: new Map(),
    });
    initialTmuxConfigsRef.current = new Map();
    initialTmuxWindowsRef.current = new Map();
  },
}));
