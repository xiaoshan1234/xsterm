import { useCallback } from "react";
import type { PaneId, TerminalId, WindowId, WorkspaceId } from "../../../models";
import { terminalSessionActions, type Terminal } from "../../../features/terminal";
import type { PaneSplitDirection, Workspace } from "../../../features/workspace";
import { useMultiplexedPaneActions } from "./useMultiplexedPaneActions";
import { usePaneLayoutActions } from "./usePaneLayoutActions";
import { usePaneTreeActions } from "./usePaneTreeActions";

interface UsePaneActionsDeps {
  terminalsRef: React.MutableRefObject<Terminal[]>;
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setTerminals: React.Dispatch<React.SetStateAction<Terminal[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  establishingTerminalsRef: React.MutableRefObject<Set<TerminalId>>;
}

export function usePaneActions(deps: UsePaneActionsDeps) {
  const layout = usePaneLayoutActions({
    terminalsRef: deps.terminalsRef,
    workspacesRef: deps.workspacesRef,
    setWorkspaces: deps.setWorkspaces,
  });
  const multiplexed = useMultiplexedPaneActions({
    terminalsRef: deps.terminalsRef,
    setTerminals: deps.setTerminals,
    setWorkspaces: deps.setWorkspaces,
  });
  const closePane = usePaneTreeActions({
    workspacesRef: deps.workspacesRef,
    setTerminals: deps.setTerminals,
    setWorkspaces: deps.setWorkspaces,
    establishingTerminalsRef: deps.establishingTerminalsRef,
    closeTerminal: terminalSessionActions.closeTerminal,
  });

  const splitPane = useCallback(
    (
      workspaceId: WorkspaceId,
      windowId: WindowId,
      paneId: PaneId,
      direction: PaneSplitDirection,
      terminalId?: TerminalId,
      configId?: string,
    ) => {
      if (terminalId !== undefined) {
        const terminal = deps.terminalsRef.current.find((candidate) => candidate.id === terminalId);
        if (terminal?.capabilities?.supportsMultiplex) {
          void multiplexed.splitMultiplexedPane(
            terminalId,
            workspaceId,
            windowId,
            paneId,
            direction,
          );
          return;
        }
      }
      layout.splitPane(workspaceId, windowId, paneId, direction, terminalId, configId);
    },
    [deps.terminalsRef, layout, multiplexed],
  );

  return {
    splitPane,
    updateWindowPaneTree: layout.updateWindowPaneTree,
    closePane,
    killTmuxPane: multiplexed.killTmuxPane,
  };
}
