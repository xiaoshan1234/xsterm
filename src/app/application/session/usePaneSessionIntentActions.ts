import { useCallback, useMemo } from "react";
import type { LocalTerminalConfig, SshConfig } from "../../../features/terminal";
import type {
  AttachSavedConfigToPaneRequest,
  CreateLocalTerminalForPaneRequest,
  CreateLocalTerminalForWindowRequest,
  CreateSavedConfigForWindowRequest,
  CreateSshTerminalForPaneRequest,
  CreateSshTerminalForWindowRequest,
  PaneIntentActions,
  PaneSessionIntentActions,
  PaneTerminalRef,
  SplitPaneWithSavedConfigRequest,
} from "../../../features/workspace";

export interface PaneSessionIntentPorts {
  closeTerminal: (terminalId: number) => Promise<void>;
  createTerminalFromSavedConfig: (
    configId: string,
  ) => Promise<Pick<PaneTerminalRef, "id" | "configId" | "name">>;
  createLocalSessionOnly: (config: LocalTerminalConfig, save?: boolean) => Promise<PaneTerminalRef>;
  createSshSessionOnly: (config: SshConfig, save?: boolean) => Promise<PaneTerminalRef>;
  replaceInitWindowWithTerminal: (
    workspaceId: string,
    windowId: string,
    terminal: PaneTerminalRef,
  ) => void;
}

interface UsePaneSessionIntentActionsOptions {
  actions: PaneSessionIntentPorts;
  workspaceIntents: Pick<PaneIntentActions, "attachExistingTerminal" | "splitPaneWithTerminal">;
}

export function usePaneSessionIntentActions({
  actions,
  workspaceIntents,
}: UsePaneSessionIntentActionsOptions): PaneSessionIntentActions {
  const createAndConsumeTerminal = useCallback(
    async <TerminalRef extends PaneTerminalRef, Result>(
      createTerminal: () => Promise<TerminalRef>,
      consumeTerminal: (terminal: TerminalRef) => Promise<Result>,
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

  const splitPaneWithSavedConfig = useCallback(
    async ({
      workspaceId,
      windowId,
      paneId,
      direction,
      configId,
    }: SplitPaneWithSavedConfigRequest) => {
      await createAndConsumeTerminal(
        () => actions.createTerminalFromSavedConfig(configId),
        (terminal) =>
          workspaceIntents.splitPaneWithTerminal({
            workspaceId,
            windowId,
            paneId,
            direction,
            terminalId: terminal.id,
            configId: terminal.configId,
          }),
      );
    },
    [actions, createAndConsumeTerminal, workspaceIntents],
  );

  const attachSavedConfigToPane = useCallback(
    async ({ workspaceId, windowId, paneId, configId }: AttachSavedConfigToPaneRequest) => {
      await createAndConsumeTerminal(
        () => actions.createTerminalFromSavedConfig(configId),
        (terminal) =>
          workspaceIntents.attachExistingTerminal({
            workspaceId,
            windowId,
            paneId,
            terminalId: terminal.id,
          }),
      );
    },
    [actions, createAndConsumeTerminal, workspaceIntents],
  );

  const createSavedConfigForWindow = useCallback(
    async ({ workspaceId, windowId, configId }: CreateSavedConfigForWindowRequest) => {
      await createAndConsumeTerminal(
        () => actions.createTerminalFromSavedConfig(configId),
        async (terminal) => {
          actions.replaceInitWindowWithTerminal(workspaceId, windowId, terminal);
        },
      );
    },
    [actions, createAndConsumeTerminal],
  );

  const createLocalTerminalForPane = useCallback(
    async ({ workspaceId, windowId, paneId, config, save }: CreateLocalTerminalForPaneRequest) => {
      return createAndConsumeTerminal(
        () => actions.createLocalSessionOnly(config, save),
        async (terminal) => {
          await workspaceIntents.attachExistingTerminal({
            workspaceId,
            windowId,
            paneId,
            terminalId: terminal.id,
          });
          return terminal;
        },
      );
    },
    [actions, createAndConsumeTerminal, workspaceIntents],
  );

  const createSshTerminalForPane = useCallback(
    async ({ workspaceId, windowId, paneId, config, save }: CreateSshTerminalForPaneRequest) => {
      return createAndConsumeTerminal(
        () => actions.createSshSessionOnly(config, save),
        async (terminal) => {
          await workspaceIntents.attachExistingTerminal({
            workspaceId,
            windowId,
            paneId,
            terminalId: terminal.id,
          });
          return terminal;
        },
      );
    },
    [actions, createAndConsumeTerminal, workspaceIntents],
  );

  const createLocalTerminalForWindow = useCallback(
    async ({ workspaceId, windowId, config, save }: CreateLocalTerminalForWindowRequest) => {
      return createAndConsumeTerminal(
        () => actions.createLocalSessionOnly(config, save),
        async (terminal) => {
          actions.replaceInitWindowWithTerminal(workspaceId, windowId, {
            ...terminal,
            name: config.name ?? "Terminal",
          });
          return terminal;
        },
      );
    },
    [actions, createAndConsumeTerminal],
  );

  const createSshTerminalForWindow = useCallback(
    async ({ workspaceId, windowId, config, save }: CreateSshTerminalForWindowRequest) => {
      return createAndConsumeTerminal(
        () => actions.createSshSessionOnly(config, save),
        async (terminal) => {
          actions.replaceInitWindowWithTerminal(workspaceId, windowId, {
            ...terminal,
            name: config.name ?? `${config.username}@${config.host}`,
          });
          return terminal;
        },
      );
    },
    [actions, createAndConsumeTerminal],
  );

  return useMemo(
    () => ({
      splitPaneWithSavedConfig,
      attachSavedConfigToPane,
      createSavedConfigForWindow,
      createLocalTerminalForPane,
      createSshTerminalForPane,
      createLocalTerminalForWindow,
      createSshTerminalForWindow,
    }),
    [
      attachSavedConfigToPane,
      createLocalTerminalForPane,
      createLocalTerminalForWindow,
      createSavedConfigForWindow,
      createSshTerminalForPane,
      createSshTerminalForWindow,
      splitPaneWithSavedConfig,
    ],
  );
}
