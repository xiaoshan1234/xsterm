import { useCallback } from "react";
import { createApplicationError } from "../../../models/applicationError";
import type { TerminalId } from "../../../models";
import { terminalSessionActions } from "../../../features/terminal";
import type { LocalTerminalConfig, SshConfig, Terminal } from "../../../features/terminal";
import type { SavedTerminalConfig, TmuxSessionConfig } from "../../../features/launch-config";
import { tmuxControllerActions } from "../../../features/tmux";
import {
  replaceSessionIdInPaneTree,
  withRecomputedSessionIds,
  type Workspace,
} from "../../../features/workspace";
import { clearTerminalOutput } from "../../../features/terminal-surface";
import { buildFrontendTerminal, dispatchByType } from "./useTerminalActions.helpers";

interface UseTerminalReconnectActionOptions {
  savedConfigs: SavedTerminalConfig[];
  terminalsRef: React.MutableRefObject<Terminal[]>;
  setTerminals: React.Dispatch<React.SetStateAction<Terminal[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  establishingTerminalsRef: React.MutableRefObject<Set<TerminalId>>;
}

export function useTerminalReconnectAction({
  savedConfigs,
  terminalsRef,
  setTerminals,
  setWorkspaces,
  establishingTerminalsRef,
}: UseTerminalReconnectActionOptions) {
  return useCallback(
    async (terminalId: TerminalId): Promise<Terminal> => {
      const oldTerminal = terminalsRef.current.find((terminal) => terminal.id === terminalId);
      if (!oldTerminal) throw createApplicationError("not-found", "Terminal not found");
      if (oldTerminal.capabilities && !oldTerminal.capabilities.supportsReconnect) {
        throw createApplicationError(
          "unsupported-operation",
          "Reconnect not supported for this transport",
        );
      }
      const config = savedConfigs.find((candidate) => candidate.id === oldTerminal.configId);
      if (!config) {
        throw createApplicationError("not-found", "Saved config not found for terminal");
      }

      const info = await dispatchByType(
        config.type,
        () =>
          terminalSessionActions.createLocal(
            config.config as LocalTerminalConfig,
            config.displayConfig?.logging,
          ),
        () =>
          terminalSessionActions.createSsh(
            config.config as SshConfig,
            config.displayConfig?.logging,
          ),
        () => tmuxControllerActions.attachSession(config.config as TmuxSessionConfig),
      );
      const newTerminal = buildFrontendTerminal(
        info,
        oldTerminal.configId,
        config.type,
        config.displayConfig,
      );
      setTerminals((previous) => [...previous, newTerminal]);
      setWorkspaces((previous) =>
        previous.map((workspace) =>
          withRecomputedSessionIds({
            ...workspace,
            windows: workspace.windows.map((window) => ({
              ...window,
              rootPane: replaceSessionIdInPaneTree(window.rootPane, terminalId, newTerminal.id),
            })),
          }),
        ),
      );

      establishingTerminalsRef.current.delete(terminalId);
      setTerminals((previous) => previous.filter((terminal) => terminal.id !== terminalId));
      try {
        await terminalSessionActions.closeTerminal(terminalId);
      } catch (error) {
        console.error("Failed to close old terminal backend during reconnect:", error);
      } finally {
        clearTerminalOutput(terminalId);
      }
      return newTerminal;
    },
    [establishingTerminalsRef, savedConfigs, setTerminals, setWorkspaces, terminalsRef],
  );
}
