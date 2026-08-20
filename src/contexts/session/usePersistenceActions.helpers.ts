import * as sessionService from "../../services/sessionService";
import type { Session } from "../../types/session";
import { clearSessionOutput } from "../../utils/sessionOutputBuffer";

interface RollbackDeps {
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  /** Log prefix used when reporting close failures during rollback. */
  logTag: string;
}

/**
 * Builds an async rollback function used by `loadWorkspace` / `loadWindow`
 * to undo partially-created sessions when a snapshot fails to reconstruct.
 *
 * Closes every session in `configIdToSession` (best effort), then prunes them
 * from `establishingSessionsRef`, clears their output buffers, and removes
 * them from `sessions`.
 */
export function createRollback({ setSessions, establishingSessionsRef, logTag }: RollbackDeps) {
  return async (configIdToSession: Map<string, Session>): Promise<void> => {
    const sessionsToClose = [...configIdToSession.values()];
    const idsToClose = new Set(sessionsToClose.map((s) => s.id));
    await Promise.all(
      sessionsToClose.map((session) =>
        sessionService
          .closeSession(session.id)
          .catch((e) => console.error(`Failed to close session during ${logTag} rollback:`, e)),
      ),
    );
    for (const id of idsToClose) {
      establishingSessionsRef.current.delete(id);
      clearSessionOutput(id);
    }
    if (idsToClose.size > 0) {
      setSessions((prev) => prev.filter((s) => !idsToClose.has(s.id)));
    }
  };
}
