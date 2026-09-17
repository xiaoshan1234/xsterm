/**
 * Session service — action function surface.
 *
 * **Pattern**: each named export is a thin wrapper that reads
 * the store via `useSessionStore.getState()` and calls a single
 * mutating action. React components subscribe via the
 * `useSessionActions()` selector hook at the bottom of this file.
 *
 * **Why wrapper functions** (instead of importing the store
 * directly from every caller):
 * - Centralises the imperative action surface — easy to mock in
 *   tests, easy to find every consumer in one grep.
 * - Lets use cases and bridges stay store-agnostic — they call
 *   `addSession(s)` without caring that `s` lives in a Zustand
 *   store today.
 *
 * **Stub bodies**: in Commit 3 these just call the underlying
 * store actions, which themselves are stubs. Commit 4 wires the
 * real IPC calls (e.g. `addSession` will also persist to disk
 * via `infra/store/savedConfigs.ts`).
 *
 * **No cross-service imports**: actions in this file MUST NOT
 * import from another service's store. Bridges are the only
 * place that fans events out across services.
 */
import type {
  Session,
  TmuxCcConfig,
  TmuxControllerError,
  TmuxWindowListEntry,
} from "../../model/entities";
import { useSessionStore, type SessionStoreState } from "./store";

export function setSessions(
  next: Session[] | ((prev: Session[]) => Session[]),
): void {
  useSessionStore.getState().setSessions(next);
}

export function addSession(session: Session): void {
  useSessionStore.getState().addSession(session);
}

export function removeSession(id: number): void {
  useSessionStore.getState().removeSession(id);
}

export function updateSession(id: number, patch: Partial<Session>): void {
  useSessionStore.getState().updateSession(id, patch);
}

export function markSessionConnected(id: number, isConnected: boolean): void {
  useSessionStore.getState().markSessionConnected(id, isConnected);
}

export function setSessionName(id: number, name: string): void {
  useSessionStore.getState().setSessionName(id, name);
}

export function applyDisplayConfig(
  id: number,
  patch: Partial<Session["displayConfig"]>,
): void {
  useSessionStore.getState().applyDisplayConfig(id, patch);
}

export function beginEstablishing(id: number): void {
  useSessionStore.getState().beginEstablishing(id);
}

export function endEstablishing(id: number): void {
  useSessionStore.getState().endEstablishing(id);
}

export function setGlobalLocalEcho(enabled: boolean): void {
  useSessionStore.getState().setGlobalLocalEchoAction(enabled);
}

export function setSessionLocalEchoOverride(
  id: number,
  enabled: boolean | undefined,
): void {
  useSessionStore.getState().setSessionLocalEchoOverride(id, enabled);
}

export function getEffectiveLocalEcho(sessionId: number): boolean {
  return useSessionStore.getState().getEffectiveLocalEcho(sessionId);
}

export function setTmuxControllerError(
  controllerId: number,
  error: TmuxControllerError | undefined,
): void {
  useSessionStore.getState().setTmuxControllerError(controllerId, error);
}

export function rememberTmuxControllerConfig(
  controllerId: number,
  config: TmuxCcConfig,
): void {
  useSessionStore.getState().rememberTmuxControllerConfig(controllerId, config);
}

export function forgetTmuxControllerConfig(controllerId: number): void {
  useSessionStore.getState().forgetTmuxControllerConfig(controllerId);
}

export function rememberTmuxWindowList(
  controllerId: number,
  entries: TmuxWindowListEntry[],
): void {
  useSessionStore.getState().rememberTmuxWindowList(controllerId, entries);
}

export function upsertTmuxWindowListEntry(
  controllerId: number,
  entry: TmuxWindowListEntry,
): void {
  useSessionStore.getState().upsertTmuxWindowListEntry(controllerId, entry);
}

export function removeTmuxWindowListEntry(
  controllerId: number,
  tmuxWindowId: string,
): void {
  useSessionStore.getState().removeTmuxWindowListEntry(controllerId, tmuxWindowId);
}

export function renameTmuxWindowListEntry(
  controllerId: number,
  tmuxWindowId: string,
  name: string,
): void {
  useSessionStore.getState().renameTmuxWindowListEntry(controllerId, tmuxWindowId, name);
}

export function getSessions(): Session[] {
  return useSessionStore.getState().sessions;
}

export function getSessionsRef(): { current: Session[] } {
  return useSessionStore.getState().sessionsRef;
}

export function resetSessionService(): void {
  useSessionStore.getState().reset();
}

/**
 * React hook selector — subscribes to the parts of the session
 * store the component actually reads. Callers spread the result
 * into the props they need.
 *
 * Pattern:
 * ```tsx
 * const { sessions, setSessions } = useSessionActions();
 * ```
 */
export function useSessionActions(): Pick<
  SessionStoreState,
  | "sessions"
  | "setSessions"
  | "globalLocalEcho"
  | "setGlobalLocalEcho"
  | "tmuxControllerErrors"
  | "setTmuxControllerErrors"
  | "getEffectiveLocalEcho"
  | "addSession"
  | "removeSession"
  | "updateSession"
> {
  return useSessionStore((s) => ({
    sessions: s.sessions,
    setSessions: s.setSessions,
    globalLocalEcho: s.globalLocalEcho,
    setGlobalLocalEcho: s.setGlobalLocalEcho,
    tmuxControllerErrors: s.tmuxControllerErrors,
    setTmuxControllerErrors: s.setTmuxControllerErrors,
    getEffectiveLocalEcho: s.getEffectiveLocalEcho,
    addSession: s.addSession,
    removeSession: s.removeSession,
    updateSession: s.updateSession,
  }));
}
