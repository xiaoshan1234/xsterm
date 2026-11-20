import { useCallback, useMemo } from "react";
import { createApplicationError } from "../../../models/applicationError";
import type { PaneId, TerminalId, WindowId, WorkspaceId } from "../../../models";
import type { Terminal } from "../../../features/terminal";
import {
  findPaneNode,
  isSessionUsedInOtherWindow,
  replacePaneNode,
  type AttachExistingTerminalRequest,
  type AttachExistingTerminalToWindowRequest,
  type EditablePaneNode,
  type PaneIntentActions,
  type PaneSplitDirection,
  type PaneTarget,
  type SplitPaneWithTerminalRequest,
  type Workspace,
} from "../../../features/workspace";

interface PaneIntentState {
  terminals: Terminal[];
  workspaces: Workspace[];
}

export interface PaneIntentPorts {
  closePane: (workspaceId: WorkspaceId, windowId: WindowId, paneId: PaneId) => Promise<void>;
  closeTerminal: (terminalId: TerminalId) => Promise<void>;
  replaceInitWindowWithTerminal: (
    workspaceId: WorkspaceId,
    windowId: WindowId,
    terminal: Pick<Terminal, "id" | "configId" | "name">,
  ) => void;
  setActivePane: (workspaceId: WorkspaceId, windowId: WindowId, paneId: PaneId) => void;
  setActiveWorkspace: (workspaceId: WorkspaceId) => void;
  splitPane: (
    workspaceId: WorkspaceId,
    windowId: WindowId,
    paneId: PaneId,
    direction: PaneSplitDirection,
    terminalId?: TerminalId,
    configId?: string,
  ) => void;
  updateWindowPaneTree: (
    workspaceId: WorkspaceId,
    windowId: WindowId,
    updater: (root: EditablePaneNode) => EditablePaneNode,
  ) => void;
}

interface UsePaneIntentActionsOptions {
  state: PaneIntentState;
  actions: PaneIntentPorts;
}

export function usePaneIntentActions({
  state,
  actions,
}: UsePaneIntentActionsOptions): PaneIntentActions {
  const attachExistingTerminal = useCallback(
    async ({ workspaceId, windowId, paneId, terminalId }: AttachExistingTerminalRequest) => {
      if (isSessionUsedInOtherWindow(state.workspaces, workspaceId, windowId, terminalId)) {
        throw createApplicationError(
          "terminal-already-attached",
          "Terminal is already attached to another window",
        );
      }

      const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId);
      const window = workspace?.windows.find((candidate) => candidate.id === windowId);
      const pane = window ? findPaneNode(window.rootPane, paneId) : null;
      if (!pane || pane.type !== "leaf") {
        throw createApplicationError("not-found", "Pane not found");
      }

      const terminal = state.terminals.find((candidate) => candidate.id === terminalId);
      actions.updateWindowPaneTree(workspaceId, windowId, (root) =>
        replacePaneNode(root, paneId, {
          ...pane,
          terminalId,
          configId: terminal?.configId,
        }),
      );
      actions.setActiveWorkspace(workspaceId);
      actions.setActivePane(workspaceId, windowId, paneId);
    },
    [actions, state.terminals, state.workspaces],
  );

  const splitPaneWithTerminal = useCallback(
    async ({
      workspaceId,
      windowId,
      paneId,
      direction,
      terminalId,
      configId,
    }: SplitPaneWithTerminalRequest) => {
      actions.splitPane(workspaceId, windowId, paneId, direction, terminalId, configId);
    },
    [actions],
  );

  const attachExistingTerminalToWindow = useCallback(
    async ({ workspaceId, windowId, terminalId }: AttachExistingTerminalToWindowRequest) => {
      if (isSessionUsedInOtherWindow(state.workspaces, workspaceId, windowId, terminalId)) {
        throw createApplicationError(
          "terminal-already-attached",
          "Terminal is already attached to another window",
        );
      }
      const terminal = state.terminals.find((candidate) => candidate.id === terminalId);
      if (!terminal) throw createApplicationError("not-found", "Terminal not found");
      actions.replaceInitWindowWithTerminal(workspaceId, windowId, terminal);
    },
    [actions, state.terminals, state.workspaces],
  );

  const closePane = useCallback(
    async ({ workspaceId, windowId, paneId }: PaneTarget) => {
      await actions.closePane(workspaceId, windowId, paneId);
    },
    [actions],
  );

  const closeTerminal = useCallback(
    async (terminalId: TerminalId) => {
      await actions.closeTerminal(terminalId);
    },
    [actions],
  );

  return useMemo(
    () => ({
      attachExistingTerminal,
      splitPaneWithTerminal,
      attachExistingTerminalToWindow,
      closePane,
      closeTerminal,
    }),
    [
      attachExistingTerminal,
      attachExistingTerminalToWindow,
      closePane,
      closeTerminal,
      splitPaneWithTerminal,
    ],
  );
}
