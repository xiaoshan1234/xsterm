import { useCallback } from "react";
import type { PaneId, TerminalId, WindowId, WorkspaceId } from "../../../models";
import type { Terminal } from "../../../features/terminal";
import type { EditablePaneNode, PaneSplitDirection, Workspace } from "../../../features/workspace";
import {
  assertSessionNotUsedElsewhere,
  createLeafPane,
  createSplitNode,
  findPaneNode,
  replacePaneNode,
  withRecomputedSessionIds,
} from "../../../features/workspace";

interface UsePaneLayoutActionsOptions {
  terminalsRef: React.MutableRefObject<Terminal[]>;
  workspacesRef: React.MutableRefObject<Workspace[]>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
}

export function usePaneLayoutActions({
  terminalsRef,
  workspacesRef,
  setWorkspaces,
}: UsePaneLayoutActionsOptions) {
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
        assertSessionNotUsedElsewhere(workspacesRef.current, workspaceId, windowId, terminalId);
      }
      setWorkspaces((previous) => {
        const workspace = previous.find((candidate) => candidate.id === workspaceId);
        if (!workspace) return previous;
        const window = workspace.windows.find((candidate) => candidate.id === windowId);
        if (!window) return previous;
        const target = findPaneNode(window.rootPane, paneId);
        if (!target || target.type !== "leaf") return previous;

        const terminal =
          terminalId !== undefined
            ? terminalsRef.current.find((candidate) => candidate.id === terminalId)
            : undefined;
        const halfSize = target.size / 2;
        const originalPane = { ...target, size: halfSize };
        const newPane = createLeafPane(halfSize, terminalId, configId ?? terminal?.configId);
        const splitNode = createSplitNode(direction, originalPane, newPane);
        const newRoot = replacePaneNode(window.rootPane, paneId, splitNode);

        return previous.map((candidate) =>
          candidate.id === workspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                activeWindowId: windowId,
                windows: workspace.windows.map((item) =>
                  item.id === windowId
                    ? { ...item, rootPane: newRoot, activePaneId: newPane.id }
                    : item,
                ),
              })
            : candidate,
        );
      });
    },
    [setWorkspaces, terminalsRef, workspacesRef],
  );

  const updateWindowPaneTree = useCallback(
    (
      workspaceId: WorkspaceId,
      windowId: WindowId,
      updater: (root: EditablePaneNode) => EditablePaneNode,
    ) => {
      setWorkspaces((previous) =>
        previous.map((workspace) =>
          workspace.id === workspaceId
            ? withRecomputedSessionIds({
                ...workspace,
                windows: workspace.windows.map((window) =>
                  window.id === windowId
                    ? { ...window, rootPane: updater(window.rootPane) }
                    : window,
                ),
              })
            : workspace,
        ),
      );
    },
    [setWorkspaces],
  );

  return { splitPane, updateWindowPaneTree };
}
