import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { TerminalId } from "../../../models";
import type { Terminal } from "../../../features/terminal";
import { terminalSessionActions } from "../../../features/terminal";
import type { Workspace } from "../../../features/workspace";
import {
  findPaneNode,
  getLeafPaneIds,
  removeSessionAndCollapse,
  withRecomputedSessionIds,
} from "../../../features/workspace";
import { clearTerminalOutput } from "../../../features/terminal-surface";

interface UseTerminalCloseActionOptions {
  setTerminals: Dispatch<SetStateAction<Terminal[]>>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
}

export function useTerminalCloseAction({
  setTerminals,
  setWorkspaces,
}: UseTerminalCloseActionOptions) {
  return useCallback(
    async (terminalId: TerminalId): Promise<void> => {
      try {
        await terminalSessionActions.closeTerminal(terminalId);
      } catch (error) {
        console.error("Failed to close terminal backend:", error);
      } finally {
        clearTerminalOutput(terminalId);
        setTerminals((previous) => previous.filter((terminal) => terminal.id !== terminalId));
        setWorkspaces((previous) =>
          previous.map((workspace) =>
            withRecomputedSessionIds({
              ...workspace,
              windows: workspace.windows.map((window) => {
                const newRoot = removeSessionAndCollapse(window.rootPane, terminalId);
                const newActivePaneId = findPaneNode(newRoot, window.activePaneId)
                  ? window.activePaneId
                  : (getLeafPaneIds(newRoot)[0] ?? null);
                return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
              }),
            }),
          ),
        );
      }
    },
    [setTerminals, setWorkspaces],
  );
}
