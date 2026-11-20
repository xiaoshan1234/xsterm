import { useCallback } from "react";
import { createApplicationError } from "../../../models/applicationError";
import {
  defaultTmuxDisplayName,
  tmuxSessionKey,
  uniqueTmuxDisplayName,
  type SavedTerminalConfig,
  type TmuxSessionConfig,
} from "../../../features/launch-config";
import { findOpenTmuxControllerId } from "../../../features/tmux";
import {
  isTmuxPaneTerminal,
  type Terminal,
  type TerminalDisplayConfig,
} from "../../../features/terminal";
import { removeControllerFromWorkspaces } from "../../../features/workspace";
import { clearTerminalOutput } from "../../../features/terminal-surface";
import { type UseSessionLifecycleDeps } from "./terminalLifecycleTypes";

type TmuxControllerTrackingDeps = Pick<
  UseSessionLifecycleDeps,
  | "savedConfigs"
  | "terminalsRef"
  | "setSessions"
  | "setWorkspaces"
  | "establishingSessionsRef"
  | "updateConfigs"
  | "tmuxControllerConfigsRef"
  | "tmuxControllerConfigIdsRef"
  | "syncOpenTmuxSessions"
  | "pendingTmuxSessionKeysRef"
  | "tmuxControllersClosingRef"
>;

export function useTmuxControllerTracking({
  savedConfigs,
  terminalsRef,
  setSessions,
  setWorkspaces,
  establishingSessionsRef,
  updateConfigs,
  tmuxControllerConfigsRef,
  tmuxControllerConfigIdsRef,
  syncOpenTmuxSessions,
  pendingTmuxSessionKeysRef,
  tmuxControllersClosingRef,
}: TmuxControllerTrackingDeps) {
  const withPendingTmuxSession = useCallback(
    async <Value>(config: TmuxSessionConfig, operation: () => Promise<Value>): Promise<Value> => {
      const key = tmuxSessionKey(config);
      if (pendingTmuxSessionKeysRef.current.has(key)) {
        throw createApplicationError(
          "operation-in-progress",
          "This tmux session is already opening.",
        );
      }
      pendingTmuxSessionKeysRef.current.add(key);
      try {
        return await operation();
      } finally {
        pendingTmuxSessionKeysRef.current.delete(key);
      }
    },
    [pendingTmuxSessionKeysRef],
  );

  const persistTmuxSession = useCallback(
    (
      terminal: Terminal,
      config: TmuxSessionConfig,
      save: boolean,
      displayConfig?: TerminalDisplayConfig,
    ) => {
      const controllerId = isTmuxPaneTerminal(terminal) ? terminal.tmux.controllerId : undefined;
      if (controllerId !== undefined) {
        tmuxControllerConfigsRef.current.set(controllerId, config);
        if (tmuxControllerConfigIdsRef) {
          tmuxControllerConfigIdsRef.current.set(controllerId, terminal.configId);
          syncOpenTmuxSessions();
          setSessions((previous) =>
            previous.map((session) =>
              isTmuxPaneTerminal(session) && session.tmux.controllerId === controllerId
                ? { ...session, configId: terminal.configId, displayConfig }
                : session,
            ),
          );
        }
      }

      if (save) {
        const configName = uniqueTmuxDisplayName(
          config.name?.trim() || defaultTmuxDisplayName(config, terminal.name),
          savedConfigs,
          { baseConfigId: config.baseConfigId },
        );
        const savedConfig: SavedTerminalConfig = {
          id: terminal.configId,
          name: configName,
          version: 1,
          type: "tmux-pane",
          config,
          displayConfig,
        };
        updateConfigs((previous) => [...previous, savedConfig]);
      }
    },
    [
      savedConfigs,
      setSessions,
      syncOpenTmuxSessions,
      tmuxControllerConfigIdsRef,
      tmuxControllerConfigsRef,
      updateConfigs,
    ],
  );

  const ensureNoOpenController = useCallback(
    (config: TmuxSessionConfig, message: string) => {
      const openControllerId = findOpenTmuxControllerId(
        config,
        savedConfigs,
        tmuxControllerConfigIdsRef.current,
        tmuxControllerConfigsRef.current,
        terminalsRef.current,
      );
      if (openControllerId !== undefined) {
        throw createApplicationError("operation-in-progress", message);
      }
    },
    [savedConfigs, terminalsRef, tmuxControllerConfigIdsRef, tmuxControllerConfigsRef],
  );

  const removeTmuxControllerFromState = useCallback(
    (controllerId: number) => {
      const deadIds = terminalsRef.current
        .filter(
          (terminal) => isTmuxPaneTerminal(terminal) && terminal.tmux.controllerId === controllerId,
        )
        .map((terminal) => terminal.id);
      if (deadIds.length > 0) {
        setSessions((previous) =>
          previous.filter(
            (terminal) =>
              !isTmuxPaneTerminal(terminal) || terminal.tmux.controllerId !== controllerId,
          ),
        );
        setWorkspaces((previous) => removeControllerFromWorkspaces(previous, deadIds));
        for (const terminalId of deadIds) {
          establishingSessionsRef.current.delete(terminalId);
          clearTerminalOutput(terminalId);
        }
      }
      tmuxControllerConfigsRef.current.delete(controllerId);
      tmuxControllerConfigIdsRef.current.delete(controllerId);
      syncOpenTmuxSessions();
      tmuxControllersClosingRef.current.delete(controllerId);
    },
    [
      establishingSessionsRef,
      setSessions,
      setWorkspaces,
      syncOpenTmuxSessions,
      terminalsRef,
      tmuxControllerConfigIdsRef,
      tmuxControllerConfigsRef,
      tmuxControllersClosingRef,
    ],
  );

  return {
    ensureNoOpenController,
    persistTmuxSession,
    removeTmuxControllerFromState,
    withPendingTmuxSession,
  };
}
