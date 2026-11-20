import { useCallback } from "react";
import { createApplicationError } from "../../../models/applicationError";
import type { Terminal } from "../../../features/terminal";
import { tmuxControllerActions } from "../../../features/tmux";
import { isTmuxPaneTerminal } from "../../../features/terminal";
import type { SavedTerminalConfig, TmuxSessionConfig } from "../../../features/launch-config";
import { buildFrontendTerminal } from "./useTerminalActions.helpers";
import { type useTmuxControllerTracking } from "./useTmuxControllerTracking";

interface UseTmuxRecoveryActionsOptions {
  tracking: ReturnType<typeof useTmuxControllerTracking>;
  savedConfigs: SavedTerminalConfig[];
  terminalsRef: React.MutableRefObject<Terminal[]>;
  setTerminals: React.Dispatch<React.SetStateAction<Terminal[]>>;
  tmuxControllerConfigsRef: React.MutableRefObject<Map<number, TmuxSessionConfig>>;
  tmuxControllerConfigIdsRef: React.MutableRefObject<Map<number, string>>;
  syncOpenTmuxSessions: () => void;
  tmuxControllersClosingRef: React.MutableRefObject<Set<number>>;
}

export function useTmuxRecoveryActions(options: UseTmuxRecoveryActionsOptions) {
  const { tracking } = options;
  const detachTmuxSession = useCallback(
    async (controllerId: number): Promise<void> => {
      options.tmuxControllersClosingRef.current.add(controllerId);
      try {
        await tmuxControllerActions.detachSession(controllerId);
      } catch (error) {
        options.tmuxControllersClosingRef.current.delete(controllerId);
        throw error;
      }
      tracking.removeTmuxControllerFromState(controllerId);
    },
    [options.tmuxControllersClosingRef, tracking],
  );

  const reconnectTmuxSession = useCallback(
    async (controllerId: number): Promise<Terminal> => {
      const controlledTerminals = options.terminalsRef.current
        .filter(isTmuxPaneTerminal)
        .filter((terminal) => terminal.tmux.controllerId === controllerId);
      if (controlledTerminals.length === 0) {
        throw createApplicationError("not-found", "Tmux session not found");
      }

      const sessionName = controlledTerminals
        .map((terminal) => terminal.tmux.sessionName)
        .find((name) => name !== undefined)
        ?.trim();
      const terminalConfigId = controlledTerminals.find((terminal) => terminal.configId)?.configId;
      const savedConfig =
        options.savedConfigs.find(
          (config) => config.id === terminalConfigId && config.type === "tmux-pane",
        ) ??
        options.savedConfigs.find(
          (config) =>
            config.type === "tmux-pane" &&
            sessionName !== undefined &&
            config.config.tmuxSessionName?.trim() === sessionName,
        );
      const configId = savedConfig?.id ?? terminalConfigId ?? "";
      const config =
        options.tmuxControllerConfigsRef.current.get(controllerId) ??
        (savedConfig?.type === "tmux-pane" ? savedConfig.config : undefined);
      if (!config) {
        throw createApplicationError("not-found", "Saved config not found for tmux session");
      }

      const displayConfig = savedConfig?.displayConfig ?? controlledTerminals[0]?.displayConfig;
      const info = await tmuxControllerActions.attachSession(config);
      const terminal = buildFrontendTerminal(info, configId, "tmux-pane", displayConfig);
      const newControllerId = isTmuxPaneTerminal(terminal) ? terminal.tmux.controllerId : undefined;
      if (newControllerId === undefined) {
        throw createApplicationError("invalid-state", "Tmux reconnect returned no controller");
      }

      options.tmuxControllerConfigsRef.current.set(newControllerId, config);
      if (configId) {
        options.tmuxControllerConfigIdsRef.current.set(newControllerId, configId);
        options.syncOpenTmuxSessions();
        options.setTerminals((previous) =>
          previous.map((session) =>
            isTmuxPaneTerminal(session) && session.tmux.controllerId === newControllerId
              ? { ...session, configId, displayConfig }
              : session,
          ),
        );
      }

      options.tmuxControllersClosingRef.current.add(controllerId);
      try {
        await tmuxControllerActions.detachSession(controllerId);
      } catch (error) {
        options.tmuxControllersClosingRef.current.delete(controllerId);
        throw error;
      }
      tracking.removeTmuxControllerFromState(controllerId);
      return terminal;
    },
    [options, tracking],
  );

  return { detachTmuxSession, reconnectTmuxSession };
}
