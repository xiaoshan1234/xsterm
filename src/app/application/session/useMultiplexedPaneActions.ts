import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PaneId, TerminalId, WindowId, WorkspaceId } from "../../../models";
import {
  isTmuxPaneTerminal,
  type Terminal,
  type TerminalConnectionInfo,
} from "../../../features/terminal";
import { tmuxControllerActions } from "../../../features/tmux";
import type { PaneSplitDirection, Workspace } from "../../../features/workspace";
import {
  createLeafPane,
  createSplitNode,
  findPaneNode,
  replacePaneNode,
  withRecomputedSessionIds,
} from "../../../features/workspace";
import { buildFrontendTerminal } from "./useTerminalActions.helpers";

interface UseMultiplexedPaneActionsOptions {
  terminalsRef: MutableRefObject<Terminal[]>;
  setSessions: Dispatch<SetStateAction<Terminal[]>>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  createPane?: (
    controllerId: number,
    parentTerminalId: TerminalId,
    direction: PaneSplitDirection,
  ) => Promise<TerminalConnectionInfo>;
}

export function useMultiplexedPaneActions({
  terminalsRef,
  setSessions,
  setWorkspaces,
  createPane = tmuxControllerActions.createPane,
}: UseMultiplexedPaneActionsOptions) {
  const splitMultiplexedPane = useCallback(
    async (
      parentTerminalId: TerminalId,
      workspaceId: WorkspaceId,
      windowId: WindowId,
      paneId: PaneId,
      direction: PaneSplitDirection,
    ) => {
      const parent = terminalsRef.current.find((terminal) => terminal.id === parentTerminalId);
      if (!parent || !isTmuxPaneTerminal(parent)) return;

      let info: TerminalConnectionInfo;
      try {
        info = await createPane(parent.tmux.controllerId, parentTerminalId, direction);
      } catch (error) {
        console.error("splitTmuxPane: backend create_tmux_pane failed:", error);
        return;
      }
      const newTerminalId = info.id;

      setSessions((previous) => {
        if (previous.some((terminal) => terminal.id === newTerminalId)) {
          return previous.map((terminal) =>
            terminal.id === newTerminalId && isTmuxPaneTerminal(terminal)
              ? {
                  ...terminal,
                  configId: terminal.configId || parent.configId,
                  tmux: {
                    controllerId: terminal.tmux.controllerId,
                    paneId:
                      info.kind.type === "tmux-pane" ? info.kind.paneId : terminal.tmux.paneId,
                    ...(info.tmuxWindowId
                      ? { windowId: info.tmuxWindowId }
                      : terminal.tmux.windowId
                        ? { windowId: terminal.tmux.windowId }
                        : {}),
                  },
                }
              : terminal,
          );
        }
        return [
          ...previous,
          buildFrontendTerminal(info, parent.configId, "tmux-pane", parent.displayConfig),
        ];
      });

      setWorkspaces((previous) => {
        const workspace = previous.find((candidate) => candidate.id === workspaceId);
        const window = workspace?.windows.find((candidate) => candidate.id === windowId);
        const target = window ? findPaneNode(window.rootPane, paneId) : null;
        if (!workspace || !window || !target || target.type !== "leaf") return previous;
        const halfSize = target.size / 2;
        const newPane = createLeafPane(halfSize, newTerminalId, "");
        const splitNode = createSplitNode(direction, { ...target, size: halfSize }, newPane);
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
    [createPane, setSessions, setWorkspaces, terminalsRef],
  );

  const killTmuxPane = useCallback(async (terminalId: TerminalId): Promise<void> => {
    await tmuxControllerActions.killPane(terminalId);
  }, []);

  return { killTmuxPane, splitMultiplexedPane };
}
