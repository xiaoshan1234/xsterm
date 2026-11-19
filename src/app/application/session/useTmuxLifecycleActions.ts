import { useCallback } from "react";
import { createApplicationError } from "../../../models/applicationError";
import { tmuxControllerActions } from "../../../features/tmux";
import { removeControllerFromWorkspaces } from "../../../features/workspace";
import {
  isTmuxPaneTerminal,
  type Terminal,
  type TerminalDisplayConfig,
} from "../../../features/terminal";
import {
  defaultTmuxDisplayName,
  tmuxSessionKey,
  uniqueTmuxDisplayName,
  type SavedTerminalConfig,
  type TmuxSessionConfig,
} from "../../../features/launch-config";
import { clearTerminalOutput } from "../../../features/terminal-surface";
import { type UseSessionLifecycleDeps } from "./terminalLifecycleTypes";
import { buildFrontendTerminal } from "./useTerminalActions.helpers";
import { findOpenTmuxControllerId } from "../../../features/tmux";

type TmuxLifecycleDeps = Pick<
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

export function useTmuxLifecycleActions({
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
}: TmuxLifecycleDeps) {
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
        tmuxControllerConfigsRef?.current.set(controllerId, config);
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
      if (!tmuxControllerConfigIdsRef || !tmuxControllerConfigsRef) return;

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

  const attachTmuxSession = useCallback(
    async (
      config: TmuxSessionConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> => {
      ensureNoOpenController(
        config,
        "This tmux session is already open. Detach it before attaching again.",
      );
      const configId = crypto.randomUUID();
      const info = await withPendingTmuxSession(config, () =>
        tmuxControllerActions.attachSession(config),
      );
      const terminal = buildFrontendTerminal(info, configId, "tmux-pane", displayConfig);
      persistTmuxSession(terminal, config, save, displayConfig);
      return terminal;
    },
    [ensureNoOpenController, persistTmuxSession, withPendingTmuxSession],
  );

  const createTmuxSession = useCallback(
    async (
      config: TmuxSessionConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> => {
      ensureNoOpenController(
        config,
        "This tmux session is already open. Detach it before creating it again.",
      );
      const configId = crypto.randomUUID();
      const info = await withPendingTmuxSession(config, () =>
        tmuxControllerActions.createSession(config),
      );
      const terminal = buildFrontendTerminal(info, configId, "tmux-pane", displayConfig);
      persistTmuxSession(terminal, config, save, displayConfig);
      return terminal;
    },
    [ensureNoOpenController, persistTmuxSession, withPendingTmuxSession],
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
      tmuxControllerConfigsRef?.current.delete(controllerId);
      tmuxControllerConfigIdsRef?.current.delete(controllerId);
      syncOpenTmuxSessions();
      tmuxControllersClosingRef?.current.delete(controllerId);
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

  const detachTmuxSession = useCallback(
    async (controllerId: number): Promise<void> => {
      tmuxControllersClosingRef?.current.add(controllerId);
      try {
        await tmuxControllerActions.detachSession(controllerId);
      } catch (error) {
        tmuxControllersClosingRef?.current.delete(controllerId);
        throw error;
      }
      removeTmuxControllerFromState(controllerId);
    },
    [removeTmuxControllerFromState, tmuxControllersClosingRef],
  );

  const reconnectTmuxSession = useCallback(
    async (controllerId: number): Promise<Terminal> => {
      const controlledTerminals = terminalsRef.current.filter(
        (terminal) => isTmuxPaneTerminal(terminal) && terminal.tmux.controllerId === controllerId,
      );
      if (controlledTerminals.length === 0) {
        throw createApplicationError("not-found", "Tmux session not found");
      }

      const sessionName = controlledTerminals
        .filter(isTmuxPaneTerminal)
        .map((terminal) => terminal.tmux.sessionName)
        .find((name) => name !== undefined)
        ?.trim();
      const terminalConfigId = controlledTerminals.find((terminal) => terminal.configId)?.configId;
      const savedConfig =
        savedConfigs.find(
          (config) => config.id === terminalConfigId && config.type === "tmux-pane",
        ) ??
        savedConfigs.find(
          (config) =>
            config.type === "tmux-pane" &&
            sessionName !== undefined &&
            config.config.tmuxSessionName?.trim() === sessionName,
        );
      const configId = savedConfig?.id ?? terminalConfigId ?? "";
      const config =
        tmuxControllerConfigsRef?.current.get(controllerId) ??
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

      tmuxControllerConfigsRef?.current.set(newControllerId, config);
      if (configId) {
        tmuxControllerConfigIdsRef?.current.set(newControllerId, configId);
        syncOpenTmuxSessions();
        setSessions((previous) =>
          previous.map((session) =>
            isTmuxPaneTerminal(session) && session.tmux.controllerId === newControllerId
              ? { ...session, configId, displayConfig }
              : session,
          ),
        );
      }

      tmuxControllersClosingRef?.current.add(controllerId);
      try {
        await tmuxControllerActions.detachSession(controllerId);
      } catch (error) {
        tmuxControllersClosingRef?.current.delete(controllerId);
        throw error;
      }
      removeTmuxControllerFromState(controllerId);
      return terminal;
    },
    [
      removeTmuxControllerFromState,
      savedConfigs,
      setSessions,
      syncOpenTmuxSessions,
      terminalsRef,
      tmuxControllerConfigIdsRef,
      tmuxControllerConfigsRef,
      tmuxControllersClosingRef,
    ],
  );

  return {
    attachTmuxSession,
    createTmuxSession,
    detachTmuxSession,
    reconnectTmuxSession,
  };
}
