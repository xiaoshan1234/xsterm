import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PaneId, TerminalId, WindowId, WorkspaceId } from "../../../models";
import type { Terminal } from "../../../features/terminal";
import type { Workspace } from "../../../features/workspace";
import {
  findPaneNode,
  getLeafPaneIds,
  removePaneFromTree,
  withRecomputedSessionIds,
} from "../../../features/workspace";
import { clearTerminalOutput } from "../../../features/terminal-surface";

interface UsePaneTreeActionsOptions {
  workspacesRef: MutableRefObject<Workspace[]>;
  setTerminals: Dispatch<SetStateAction<Terminal[]>>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  establishingTerminalsRef: MutableRefObject<Set<TerminalId>>;
  closeTerminal: (terminalId: TerminalId) => Promise<void>;
}

export function usePaneTreeActions({
  workspacesRef,
  setTerminals,
  setWorkspaces,
  establishingTerminalsRef,
  closeTerminal,
}: UsePaneTreeActionsOptions) {
  return useCallback(
    async (workspaceId: WorkspaceId, windowId: WindowId, paneId: PaneId): Promise<void> => {
      const workspace = workspacesRef.current.find((candidate) => candidate.id === workspaceId);
      const window = workspace?.windows.find((candidate) => candidate.id === windowId);
      const pane = window ? findPaneNode(window.rootPane, paneId) : null;
      if (!pane) return;

      const terminalId = pane.terminalId;
      if (terminalId !== undefined) {
        try {
          await closeTerminal(terminalId);
        } catch (error) {
          console.error("Failed to close terminal backend:", error);
        } finally {
          establishingTerminalsRef.current.delete(terminalId);
        }
        clearTerminalOutput(terminalId);
        setTerminals((previous) => previous.filter((terminal) => terminal.id !== terminalId));
      }

      setWorkspaces((previous) =>
        previous.map((candidate) => {
          if (candidate.id !== workspaceId) return candidate;
          return withRecomputedSessionIds({
            ...candidate,
            windows: candidate.windows.map((item) => {
              if (item.id !== windowId) return item;
              const newRoot = removePaneFromTree(item.rootPane, paneId);
              const newActivePaneId =
                item.activePaneId === paneId
                  ? (getLeafPaneIds(newRoot)[0] ?? null)
                  : item.activePaneId;
              return { ...item, rootPane: newRoot, activePaneId: newActivePaneId };
            }),
          });
        }),
      );
    },
    [closeTerminal, establishingTerminalsRef, setTerminals, setWorkspaces, workspacesRef],
  );
}
