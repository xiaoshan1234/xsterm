import { useCallback, useMemo } from "react";
import { createApplicationError } from "../../../models/applicationError";
import {
  isTmuxPaneTerminal,
  type LocalTerminalConfig,
  type SshConfig,
  type Terminal,
} from "../../../features/terminal";
import { tmuxWindowActions } from "../../../features/tmux";
import {
  findPaneNode,
  isSessionUsedInOtherWindow,
  replacePaneNode,
  type AttachExistingTerminalRequest,
  type AttachExistingTerminalToWindowRequest,
  type AttachSavedConfigToPaneRequest,
  type CreateSavedConfigForWindowRequest,
  type CreateLocalTerminalForPaneRequest,
  type CreateLocalTerminalForWindowRequest,
  type EditablePaneNode,
  type PaneTerminalRef,
  type PaneIntentActions,
  type PaneSplitDirection,
  type PaneTarget,
  type CreateSshTerminalForPaneRequest,
  type CreateSshTerminalForWindowRequest,
  type SplitPaneWithSavedConfigRequest,
  type SplitPaneWithTerminalRequest,
  type Workspace,
} from "../../../features/workspace";

interface PaneIntentState {
  terminals: Terminal[];
  workspaces: Workspace[];
}
export interface PaneCoordinatorPorts {
  closePane: (workspaceId: string, windowId: string, paneId: string) => Promise<void>;
  closeTerminal: (terminalId: number) => Promise<void>;
  createTerminalFromSavedConfig: (configId: string) => Promise<Terminal>;
  createLocalSessionOnly: (config: LocalTerminalConfig, save?: boolean) => Promise<Terminal>;
  createSshSessionOnly: (config: SshConfig, save?: boolean) => Promise<Terminal>;
  replaceInitWindowWithTerminal: (
    workspaceId: string,
    windowId: string,
    terminal: PaneTerminalRef,
  ) => void;
  setActivePane: (workspaceId: string, windowId: string, paneId: string) => void;
  setActiveWorkspace: (workspaceId: string) => void;
  splitPane: (
    workspaceId: string,
    windowId: string,
    paneId: string,
    direction: PaneSplitDirection,
    terminalId?: number,
    configId?: string,
  ) => void;
  updateWindowPaneTree: (
    workspaceId: string,
    windowId: string,
    updater: (root: EditablePaneNode) => EditablePaneNode,
  ) => void;
}

interface UsePaneIntentActionsOptions {
  state: PaneIntentState;
  actions: PaneCoordinatorPorts;
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

  const createSavedConfigForWindow = useCallback(
    async ({ workspaceId, windowId, configId }: CreateSavedConfigForWindowRequest) => {
      const terminal = await actions.createTerminalFromSavedConfig(configId);
      try {
        actions.replaceInitWindowWithTerminal(workspaceId, windowId, terminal);
      } catch (error) {
        await actions.closeTerminal(terminal.id).catch(() => undefined);
        throw error;
      }
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

  const createTerminalForTarget = useCallback(
    async <Result>(
      createTerminal: () => Promise<{ id: number; configId: string; name: string }>,
      consumeTerminal: (terminal: {
        id: number;
        configId: string;
        name: string;
      }) => Promise<Result>,
    ): Promise<Result> => {
      const terminal = await createTerminal();
      try {
        return await consumeTerminal(terminal);
      } catch (error) {
        await actions.closeTerminal(terminal.id).catch(() => undefined);
        throw error;
      }
    },
    [actions],
  );

  const createLocalTerminalForPane = useCallback(
    async ({ workspaceId, windowId, paneId, config, save }: CreateLocalTerminalForPaneRequest) => {
      return createTerminalForTarget(
        () => actions.createLocalSessionOnly(config, save),
        async (terminal) => {
          await attachExistingTerminal({
            workspaceId,
            windowId,
            paneId,
            terminalId: terminal.id,
          });
          return terminal;
        },
      );
    },
    [actions, attachExistingTerminal, createTerminalForTarget],
  );

  const createSshTerminalForPane = useCallback(
    async ({ workspaceId, windowId, paneId, config, save }: CreateSshTerminalForPaneRequest) => {
      return createTerminalForTarget(
        () => actions.createSshSessionOnly(config, save),
        async (terminal) => {
          await attachExistingTerminal({
            workspaceId,
            windowId,
            paneId,
            terminalId: terminal.id,
          });
          return terminal;
        },
      );
    },
    [actions, attachExistingTerminal, createTerminalForTarget],
  );

  const createLocalTerminalForWindow = useCallback(
    async ({ workspaceId, windowId, config, save }: CreateLocalTerminalForWindowRequest) => {
      return createTerminalForTarget(
        () => actions.createLocalSessionOnly(config, save),
        (terminal) => {
          actions.replaceInitWindowWithTerminal(workspaceId, windowId, {
            id: terminal.id,
            configId: terminal.configId,
            name: config.name ?? "Terminal",
          });
          return Promise.resolve(terminal);
        },
      );
    },
    [actions, createTerminalForTarget],
  );

  const createSshTerminalForWindow = useCallback(
    async ({ workspaceId, windowId, config, save }: CreateSshTerminalForWindowRequest) => {
      return createTerminalForTarget(
        () => actions.createSshSessionOnly(config, save),
        (terminal) => {
          actions.replaceInitWindowWithTerminal(workspaceId, windowId, {
            id: terminal.id,
            configId: terminal.configId,
            name: config.name ?? `${config.username}@${config.host}`,
          });
          return Promise.resolve(terminal);
        },
      );
    },
    [actions, createTerminalForTarget],
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
      if (!terminal || !isTmuxPaneTerminal(terminal)) {
        throw createApplicationError("not-found", "Tmux controller not found");
      }
      await tmuxWindowActions.createWindow(terminal.tmux.controllerId);
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
      createSavedConfigForWindow,
      attachExistingTerminalToWindow,
      createLocalTerminalForPane,
      createSshTerminalForPane,
      createLocalTerminalForWindow,
      createSshTerminalForWindow,
      closePane,
      closeTerminal,
      createTmuxWindow,
      killTmuxWindow,
      renameTmuxWindow,
    }),
    [
      attachExistingTerminal,
      attachSavedConfigToPane,
      createSavedConfigForWindow,
      attachExistingTerminalToWindow,
      createLocalTerminalForPane,
      createSshTerminalForPane,
      createLocalTerminalForWindow,
      createSshTerminalForWindow,
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
