/**
 * SessionModel — the active, stateful session-domain object (Phase 3).
 *
 * **What this is**
 * The `SessionModel` is the single owner of the session registry's
 * runtime state. It replaces the write-side `useSessionStore` actions
 * (`addSession` / `removeSession` / `markSessionConnected` / …) with a
 * typed object that takes its dependencies (`SessionRepository` +
 * `SessionEventBus`) by injection. All write paths — bridges,
 * (eventually) use cases — go through this object. Reads are still
 * served by `useSessionStore(selector)`; this model writes through to
 * the Zustand store so existing React subscriptions keep working
 * (Phase 3 strategy; Phase 5 will swap to `useSyncExternalStore`).
 *
 * **Layering rule**
 * `model/session/model.ts` MUST NOT import from `infra/*` or
 * `@tauri-apps/api/*`. The actual backend glue is injected via the
 * `SessionModelDeps` interface; tests inject fakes.
 *
 * **Non-goals (deferred to Phase 4)**
 * - `TmuxModel` / `WorkspaceModel` / `PersistenceModel` are NOT created
 *   here. The `onSessionClosed` callback on `SessionModelDeps` is the
 *   temporary seam that bridges session-close into the workspace pane
 *   tree without making this file import `useWorkspaceStore`.
 * - Per-session `displayConfig` mutation is supported but use-case
 *   routing (Phase 4) is NOT moved over yet — only the bridge path is
 *   rewritten to call this model.
 */
import type { SessionRepository } from "./repository";
import type { SessionEventBus, SessionLifecycleHandler, Unsubscribe } from "./events";
import type {
  Session,
  SessionConnectionType,
  SessionDisplayConfig,
  SessionInfo,
  SessionType,
} from "./types";

// ---------------------------------------------------------------------------
// Internal registry state — never exposed to React directly.
// ---------------------------------------------------------------------------

interface RegistryState {
  byId: Map<number, Session>;
  /** Insertion order — preserved so React list renders stay stable. */
  order: number[];
}

function emptyRegistry(): RegistryState {
  return { byId: new Map(), order: [] };
}

function listFromRegistry(reg: RegistryState): Session[] {
  return reg.order.map((id) => reg.byId.get(id)).filter((s): s is Session => s !== undefined);
}

/**
 * Convert a `SessionInfo` (backend wire shape) into a frontend
 * `Session` view-model. Only used by `hydrate()`; `create()` builds the
 * row directly from the repo response.
 *
 * Backend `SessionInfo` doesn't carry `configId` / `displayConfig` /
 * `createdAt` / `lastActivityAt` — those are frontend-only fields
 * synthesised here. `configId` defaults to `""` (ad-hoc); downstream
 * `getByConfigId` will therefore never match a hydrated session.
 * `lastActivityAt` and `createdAt` default to `Date.now()` because the
 * backend doesn't surface them on `list_sessions`.
 */
function hydrateSession(info: SessionInfo): Session {
  const now = Date.now();
  return {
    id: info.id,
    configId: "",
    name: info.name,
    type: info.sessionType.type,
    isConnected: info.isConnected,
    sessionType: info.sessionType,
    capabilities: info.capabilities,
    createdAt: now,
    lastActivityAt: now,
    ...(info.tmuxPaneId !== undefined ? { tmuxPaneId: info.tmuxPaneId } : {}),
    ...(info.tmuxControllerId !== undefined ? { tmuxControllerId: info.tmuxControllerId } : {}),
    ...(info.tmuxServerWindowId !== undefined
      ? { tmuxServerWindowId: info.tmuxServerWindowId }
      : {}),
    ...(info.isHidden !== undefined ? { isHidden: info.isHidden } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Cross-service fan-out: when a session closes, the workspace pane
 * tree needs to remove the matching leaf and collapse empty splits.
 * Phase 3 injects the workspace mutator here so `SessionModel` stays
 * decoupled from `useWorkspaceStore`. Phase 4 will replace this with a
 * `WorkspaceModel` reference.
 *
 * The callback is invoked AFTER the session is removed from the model
 * and AFTER the Zustand mirror is updated.
 */
export type SessionClosedHandler = (sessionId: number) => void;

export interface SessionModelDeps {
  /** Phase 2 contract; injected so tests can swap in fakes. */
  repo: SessionRepository;
  /** Phase 2 contract; only `onClosed` + `onDisconnected` are subscribed. */
  bus: SessionEventBus;
  /** Cross-service fan-out (see comment above). */
  onSessionClosed?: SessionClosedHandler;
  /**
   * Mirror writer — pushes model state into a read-side store that
   * React components subscribe to. Defaults to the bound Zustand
   * mirror (see `bindDefaultMirrorWriter`). Tests pass a fake.
   */
  mirror?: MirrorWriter;
}

/** Options accepted by `SessionModel.create()`. */
export interface SessionModelCreateOptions {
  /**
   * Saved-config id this session was opened from. Empty string for
   * ad-hoc sessions (matches the `Session.configId` convention in the
   * current store).
   */
  configId?: string;
  /**
   * Initial per-session display config — applied at creation time so
   * the first render of the Terminal picks up font / scrollback / etc.
   */
  displayConfig?: SessionDisplayConfig;
}

export interface SessionModel {
  // ---- 查询（同步、纯内存）----
  list(): Session[];
  get(id: number): Session | undefined;
  getByConfigId(configId: string): Session | undefined;
  filterByType(type: SessionConnectionType): Session[];

  // ---- 命令（async；走 repository，再写本地状态）----
  /**
   * Hydrate from backend: call `repo.list()` and replace the entire
   * registry. The mirror store is updated to match. Intended to be
   * invoked once at App mount.
   */
  hydrate(): Promise<void>;

  /**
   * Create a session via the repository, then write the resulting
   * frontend `Session` to both internal state and the mirror store.
   * Returns the new `Session` so callers can wire it into a pane.
   */
  create(input: SessionType, opts?: SessionModelCreateOptions): Promise<Session>;

  /** Close a session via the repository, then remove it locally. */
  close(id: number): Promise<void>;

  /**
   * Fire-and-forget keystroke write. Errors are swallowed by the
   * repository (see `tauriSessionRepository.write`). Awaited only to
   * preserve call-site shape — does not block the model.
   */
  write(id: number, data: Uint8Array): Promise<void>;

  /**
   * Resize the terminal. Dispatches to the correct repository method
   * based on session type:
   *   - `local`      → `repo.resizePty(id, rows, cols)`
   *   - `ssh`        → `repo.resizeSsh(id, rows, cols)`
   *   - `tmux-cc`    → `repo.resizeTmuxPane(controllerId, paneId, rows, cols)`
   *
   * Throws if the session id is unknown.
   */
  resize(id: number, rows: number, cols: number): Promise<void>;

  // ---- mutation（纯内存；事件回流用）----
  markConnected(id: number, isConnected: boolean): void;
  setName(id: number, name: string): void;
  applyDisplayConfig(id: number, patch: Partial<SessionDisplayConfig>): void;

  // ---- 生命周期 ----
  beginEstablishing(id: number): void;
  endEstablishing(id: number): void;

  // ---- 订阅（Phase 5 use；Phase 3 暂不调用，但留口）----
  subscribe(listener: () => void): Unsubscribe;

  // ---- 清理 ----
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Mirror writer — Phase 3 writes through to the existing Zustand store
// so React subscriptions keep working without API changes.
// ---------------------------------------------------------------------------

/**
 * Pluggable mirror writer. Production wires this to the real Zustand
 * store via `bindDefaultMirrorWriter`; tests construct an in-memory
 * fake and pass it directly to `createSessionModel`.
 */
export interface MirrorWriter {
  /** Replace the entire session registry. */
  replaceSessions(sessions: Session[]): void;
  /** Update an existing session in place (Partial merge). */
  updateSession(id: number, patch: Partial<Session>): void;
  /** Add a brand-new session row. */
  addSession(session: Session): void;
  /** Remove a session row by id. */
  removeSession(id: number): void;
  /** Mark `isConnected` on an existing session. */
  markSessionConnected(id: number, isConnected: boolean): void;
  /** Begin tracking an "establishing" id (used for loading indicators). */
  beginEstablishing(id: number): void;
  /** Drop an "establishing" id. */
  endEstablishing(id: number): void;
}

/**
 * The default mirror writer writes through to the Zustand
 * `useSessionStore`. Bound once at App startup via
 * `bindDefaultMirrorWriter` so this module never statically imports
 * `service/session/store` (which would invert the layering arrow —
 * `service` is supposed to depend on `model`, not the other way around).
 */
let boundMirrorWriter: MirrorWriter | null = null;

/** Bind the default mirror writer. Call once at App startup. */
export function bindDefaultMirrorWriter(writer: MirrorWriter): void {
  boundMirrorWriter = writer;
}

/** For tests only: clear the bound default mirror. */
export function unbindDefaultMirrorWriter(): void {
  boundMirrorWriter = null;
}

function requireDefaultMirror(): MirrorWriter {
  if (!boundMirrorWriter) {
    throw new Error(
      "SessionModel: default mirror writer was not bound. " +
        "Call `bindDefaultMirrorWriter(...)` once at App startup " +
        "before instantiating the model. Tests can pass `mirror` " +
        "directly to `createSessionModel` instead.",
    );
  }
  return boundMirrorWriter;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSessionModel(deps: SessionModelDeps): SessionModel {
  // Per-instance state. Strict-mode safe: each construction gets its
  // own registry + disposer list. The `dispose()` method is idempotent
  // so React 18 strict-mode double-mount is handled by the host hook.
  let reg: RegistryState = emptyRegistry();
  const listeners = new Set<() => void>();
  const disposers: Unsubscribe[] = [];

  const mirror: MirrorWriter = deps.mirror ?? requireDefaultMirror();

  function notify(): void {
    for (const l of listeners) l();
  }

  function snapshot(): Session[] {
    return listFromRegistry(reg);
  }

  function addRow(session: Session): void {
    if (reg.byId.has(session.id)) return; // idempotent
    reg.byId.set(session.id, session);
    reg.order.push(session.id);
  }

  function removeRow(id: number): boolean {
    if (!reg.byId.has(id)) return false;
    reg.byId.delete(id);
    reg.order = reg.order.filter((x) => x !== id);
    return true;
  }

  // ---- bus subscriptions (registered once, disposed once) ----

  const onClosed: SessionLifecycleHandler = (sessionId) => {
    if (removeRow(sessionId)) {
      const list = snapshot();
      mirror.replaceSessions(list);
      mirror.removeSession(sessionId);
      deps.onSessionClosed?.(sessionId);
      notify();
    }
  };
  disposers.push(deps.bus.onClosed(onClosed));

  const onDisconnected: SessionLifecycleHandler = (sessionId) => {
    model.markConnected(sessionId, false);
  };
  disposers.push(deps.bus.onDisconnected(onDisconnected));

  // ---- public surface ----

  const model: SessionModel = {
    list: () => snapshot(),

    get: (id) => reg.byId.get(id),

    getByConfigId: (configId) => {
      if (configId === "") return undefined;
      for (const s of reg.byId.values()) {
        if (s.configId === configId) return s;
      }
      return undefined;
    },

    filterByType: (type) => listFromRegistry(reg).filter((s) => s.type === type),

    async hydrate() {
      const infos = await deps.repo.list();
      reg = emptyRegistry();
      for (const info of infos) {
        const session = hydrateSession(info);
        reg.byId.set(session.id, session);
        reg.order.push(session.id);
      }
      const list = listFromRegistry(reg);
      mirror.replaceSessions(list);
      notify();
    },

    async create(input, opts) {
      const info = await deps.repo.create(input);
      const now = Date.now();
      const session: Session = {
        id: info.id,
        configId: opts?.configId ?? "",
        name: info.name,
        type: info.sessionType.type,
        isConnected: info.isConnected,
        sessionType: info.sessionType,
        capabilities: info.capabilities,
        displayConfig: opts?.displayConfig,
        createdAt: now,
        lastActivityAt: now,
        ...(info.tmuxPaneId !== undefined ? { tmuxPaneId: info.tmuxPaneId } : {}),
        ...(info.tmuxControllerId !== undefined ? { tmuxControllerId: info.tmuxControllerId } : {}),
        ...(info.tmuxServerWindowId !== undefined
          ? { tmuxServerWindowId: info.tmuxServerWindowId }
          : {}),
        ...(info.isHidden !== undefined ? { isHidden: info.isHidden } : {}),
      };
      addRow(session);
      mirror.addSession(session);
      notify();
      return session;
    },

    async close(id) {
      await deps.repo.close(id);
      if (removeRow(id)) {
        mirror.removeSession(id);
        notify();
      }
    },

    async write(id, data) {
      // Repository write swallows errors; we await so the call site
      // shape is preserved, but we don't gate any local mutation on it
      // — writes are fire-and-forget by design (Perf 003 batching).
      await deps.repo.write(id, data);
    },

    async resize(id, rows, cols) {
      const session = reg.byId.get(id);
      if (!session) {
        throw new Error(`SessionModel.resize: unknown session id ${id}`);
      }
      switch (session.type) {
        case "local":
          await deps.repo.resizePty(id, rows, cols);
          return;
        case "ssh":
          await deps.repo.resizeSsh(id, rows, cols);
          return;
        case "tmux-cc": {
          const controllerId = session.tmuxControllerId;
          const paneId = session.tmuxPaneId;
          if (controllerId === undefined || paneId === undefined) {
            throw new Error(
              `SessionModel.resize: tmux session ${id} missing ` + `tmuxControllerId/tmuxPaneId`,
            );
          }
          await deps.repo.resizeTmuxPane(controllerId, paneId, rows, cols);
          return;
        }
        default: {
          const _exhaustive: never = session.type;
          throw new Error(`SessionModel.resize: unknown session type ${String(_exhaustive)}`);
        }
      }
    },

    markConnected(id, isConnected) {
      const existing = reg.byId.get(id);
      if (!existing || existing.isConnected === isConnected) return;
      const next: Session = { ...existing, isConnected };
      reg.byId.set(id, next);
      mirror.markSessionConnected(id, isConnected);
      notify();
    },

    setName(id, name) {
      const existing = reg.byId.get(id);
      if (!existing || existing.name === name) return;
      const next: Session = { ...existing, name };
      reg.byId.set(id, next);
      mirror.updateSession(id, { name });
      notify();
    },

    applyDisplayConfig(id, patch) {
      const existing = reg.byId.get(id);
      if (!existing) return;
      const merged: SessionDisplayConfig = {
        ...(existing.displayConfig ?? {}),
        ...patch,
      };
      const next: Session = { ...existing, displayConfig: merged };
      reg.byId.set(id, next);
      mirror.updateSession(id, { displayConfig: merged });
      notify();
    },

    beginEstablishing(id) {
      mirror.beginEstablishing(id);
    },

    endEstablishing(id) {
      mirror.endEstablishing(id);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      // Idempotent — second call is a no-op.
      while (disposers.length > 0) {
        const u = disposers.pop()!;
        try {
          u();
        } catch (e) {
          console.error("[xsterm] SessionModel.dispose: unsubscribe failed", e);
        }
      }
      listeners.clear();
    },
  };

  return model;
}
