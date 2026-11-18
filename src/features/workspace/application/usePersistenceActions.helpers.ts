import type { Terminal } from "../../../features/terminal";
import { clearTerminalOutput } from "../../../shared/utils/terminalOutputBuffer";

interface RollbackDeps {
  closeTerminal: (terminalId: number) => Promise<void>;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  establishingSessionsRef: React.MutableRefObject<Set<number>>;
  /** Log prefix used when reporting close failures during rollback. */
  logTag: string;
}

/**
 * Builds an async rollback function used by `loadWorkspace` / `loadWindow`
 * to undo partially-created terminals when a snapshot fails to reconstruct.
 *
 * Closes every terminal in `configIdToSession` (best effort), then prunes them
 * from `establishingSessionsRef`, clears their output buffers, and removes
 * them from `terminals`.
 */
export function createRollback({
  closeTerminal,
  setSessions,
  establishingSessionsRef,
  logTag,
}: RollbackDeps) {
  return async (configIdToSession: Map<string, Terminal>): Promise<void> => {
    const terminalsToClose = [...configIdToSession.values()];
    const idsToClose = new Set(terminalsToClose.map((s) => s.id));
    await Promise.all(
      terminalsToClose.map((terminal) =>
        closeTerminal(terminal.id).catch((e) =>
          console.error(`Failed to close terminal during ${logTag} rollback:`, e),
        ),
      ),
    );
    for (const id of idsToClose) {
      establishingSessionsRef.current.delete(id);
      clearTerminalOutput(id);
    }
    if (idsToClose.size > 0) {
      setSessions((prev) => prev.filter((s) => !idsToClose.has(s.id)));
    }
  };
}
