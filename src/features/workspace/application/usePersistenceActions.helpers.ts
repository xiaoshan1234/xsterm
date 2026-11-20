import type { Terminal } from "../../../features/terminal";
import type { TerminalId } from "../../../models";
import { clearTerminalOutput } from "../../terminal-surface";

interface RollbackDeps {
  closeTerminal: (terminalId: TerminalId) => Promise<void>;
  setTerminals: React.Dispatch<React.SetStateAction<Terminal[]>>;
  establishingTerminalsRef: React.MutableRefObject<Set<TerminalId>>;
  /** Log prefix used when reporting close failures during rollback. */
  logTag: string;
}

/**
 * Builds an async rollback function used by `loadWorkspace` / `loadWindow`
 * to undo partially-created terminals when a snapshot fails to reconstruct.
 *
 * Closes every terminal in `configIdToSession` (best effort), then prunes them
 * from `establishingTerminalsRef`, clears their output buffers, and removes
 * them from `terminals`.
 */
export function createRollback({
  closeTerminal,
  setTerminals,
  establishingTerminalsRef,
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
      establishingTerminalsRef.current.delete(id);
      clearTerminalOutput(id);
    }
    if (idsToClose.size > 0) {
      setTerminals((prev) => prev.filter((s) => !idsToClose.has(s.id)));
    }
  };
}
