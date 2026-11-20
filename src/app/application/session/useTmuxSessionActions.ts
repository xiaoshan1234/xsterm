import { useCallback } from "react";
import { tmuxControllerActions } from "../../../features/tmux";
import type { Terminal, TerminalDisplayConfig } from "../../../features/terminal";
import type { TmuxSessionConfig } from "../../../features/launch-config";
import { buildFrontendTerminal } from "./useTerminalActions.helpers";
import { type useTmuxControllerTracking } from "./useTmuxControllerTracking";

interface UseTmuxSessionActionsOptions {
  tracking: ReturnType<typeof useTmuxControllerTracking>;
}

export function useTmuxSessionActions({ tracking }: UseTmuxSessionActionsOptions) {
  const attachTmuxSession = useCallback(
    async (
      config: TmuxSessionConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> => {
      tracking.ensureNoOpenController(
        config,
        "This tmux session is already open. Detach it before attaching again.",
      );
      const configId = crypto.randomUUID();
      const info = await tracking.withPendingTmuxSession(config, () =>
        tmuxControllerActions.attachSession(config),
      );
      const terminal = buildFrontendTerminal(info, configId, "tmux-pane", displayConfig);
      tracking.persistTmuxSession(terminal, config, save, displayConfig);
      return terminal;
    },
    [tracking],
  );

  const createTmuxSession = useCallback(
    async (
      config: TmuxSessionConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> => {
      tracking.ensureNoOpenController(
        config,
        "This tmux session is already open. Detach it before creating it again.",
      );
      const configId = crypto.randomUUID();
      const info = await tracking.withPendingTmuxSession(config, () =>
        tmuxControllerActions.createSession(config),
      );
      const terminal = buildFrontendTerminal(info, configId, "tmux-pane", displayConfig);
      tracking.persistTmuxSession(terminal, config, save, displayConfig);
      return terminal;
    },
    [tracking],
  );

  return {
    attachTmuxSession,
    createTmuxSession,
    tracking,
  };
}
