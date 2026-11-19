import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { TerminalId } from "../../../models";
import {
  terminalSessionActions,
  terminalStreamActions,
  type Terminal,
} from "../../../features/terminal";

interface UseTerminalStreamActionsOptions {
  setSessions: Dispatch<SetStateAction<Terminal[]>>;
}

export function useTerminalStreamActions({ setSessions }: UseTerminalStreamActionsOptions) {
  const writeTerminal = useCallback(async (id: TerminalId, data: string): Promise<void> => {
    await terminalStreamActions.writeBytes(id, new TextEncoder().encode(data));
  }, []);

  const resizeTerminal = useCallback(
    async (id: TerminalId, rows: number, cols: number): Promise<void> => {
      await terminalSessionActions.resizeTerminal(id, rows, cols);
    },
    [],
  );

  const uploadImageToSshTerminal = useCallback(
    async (terminalId: TerminalId, filename: string, data: Uint8Array): Promise<string> => {
      return terminalSessionActions.uploadImageToSshTerminal(terminalId, filename, data);
    },
    [],
  );

  const touchTerminalActivity = useCallback(
    (id: TerminalId) => {
      const now = Date.now();
      setSessions((previous) =>
        previous.map((terminal) =>
          terminal.id === id ? { ...terminal, lastActivityAt: now } : terminal,
        ),
      );
    },
    [setSessions],
  );

  return {
    writeTerminal,
    resizeTerminal,
    uploadImageToSshTerminal,
    touchTerminalActivity,
  };
}
