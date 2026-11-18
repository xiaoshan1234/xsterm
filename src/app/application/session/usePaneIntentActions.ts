import { useCallback, useMemo } from "react";
import { createApplicationError } from "../../../models/applicationError";
import { tmuxWindowActions } from "../../../features/tmux";
import {
  findPaneNode,
  isSessionUsedInOtherWindow,
  replacePaneNode,
  type AttachExistingTerminalRequest,
  type AttachSavedConfigToPaneRequest,
  type PaneIntentActions,
  type PaneTarget,
  type SplitPaneWithSavedConfigRequest,
  type SplitPaneWithTerminalRequest,
} from "../../../features/workspace";
import { type SessionActions, type TerminalState } from "./types";

type PaneIntentState = Pick<TerminalState, "terminals" | "workspaces">;
type PaneIntentActionPorts = Pick<
  SessionActions,
  | "closePane"
  | "closeTerminal"
  | "createTerminalFromSavedConfig"
  | "setActivePane"
  | "setActiveWorkspace"
  | "splitPane"
  | "updateWindowPaneTree"
>;

interface UsePaneIntentActionsOptions {
  state: PaneIntentState;
  actions: PaneIntentActionPorts;
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
        throw new Error("Pane not found");
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

  const createAndUseTerminal = useCallback(
    async <Result>(
      configId: string,
      consumeTerminal: (terminalId: number, terminalConfigId: string) => Promise<Result>,
    ): Promise<Result> => {
      const terminal = await actions.createTerminalFromSavedConfig(configId);
      try {
        return await consumeTerminal(terminal.id, terminal.configId);
      } catch (error) {
        await actions.closeTerminal(terminal.id).catch(() => undefined);
        throw error;
      }
    },
    [actions],
  );

  const splitPaneWithSavedConfig = useCallback(
    async ({
      workspaceId,
      windowId,
      paneId,
      direction,
      configId,
    }: SplitPaneWithSavedConfigRequest) => {
      await createAndUseTerminal(configId, (terminalId, terminalConfigId) =>
        splitPaneWithTerminal({
          workspaceId,
          windowId,
          paneId,
          direction,
          terminalId,
          configId: terminalConfigId,
        }),
      );
    },
    [createAndUseTerminal, splitPaneWithTerminal],
  );

  const attachSavedConfigToPane = useCallback(
    async ({ workspaceId, windowId, paneId, configId }: AttachSavedConfigToPaneRequest) => {
      await createAndUseTerminal(configId, (terminalId) =>
        attachExistingTerminal({ workspaceId, windowId, paneId, terminalId }),
      );
    },
    [attachExistingTerminal, createAndUseTerminal],
  );

  const closePane = useCallback(
    async ({ workspaceId, windowId, paneId }: PaneTarget) => {
      await actions.closePane(workspaceId, windowId, paneId);
    },
    [actions],
  );

  const closeTerminal = useCallback(
    async (terminalId: number) => {
      await actions.closeTerminal(terminalId);
    },
    [actions],
  );

  const createTmuxWindow = useCallback(
    async (terminalId: number) => {
      const terminal = state.terminals.find((candidate) => candidate.id === terminalId);
      if (terminal?.tmuxSessionId === undefined) {
        throw new Error("Tmux controller not found");
      }
      await tmuxWindowActions.createWindow(terminal.tmuxSessionId);
    },
    [state.terminals],
  );

  const killTmuxWindow = useCallback(async (xstermWindowId: number) => {
    await tmuxWindowActions.killWindow(xstermWindowId);
  }, []);

  const renameTmuxWindow = useCallback(async (xstermWindowId: number, name: string) => {
    await tmuxWindowActions.renameWindow(xstermWindowId, name);
  }, []);

  return useMemo(
    () => ({
      attachExistingTerminal,
      splitPaneWithTerminal,
      splitPaneWithSavedConfig,
      attachSavedConfigToPane,
      closePane,
      closeTerminal,
      createTmuxWindow,
      killTmuxWindow,
      renameTmuxWindow,
    }),
    [
      attachExistingTerminal,
      attachSavedConfigToPane,
      closePane,
      closeTerminal,
      createTmuxWindow,
      killTmuxWindow,
      renameTmuxWindow,
      splitPaneWithSavedConfig,
      splitPaneWithTerminal,
    ],
  );
}
