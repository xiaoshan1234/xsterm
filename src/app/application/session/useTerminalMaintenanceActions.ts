import { useCallback } from "react";
import { terminalSessionActions } from "../../../features/terminal";
import {
  defaultTmuxDisplayName,
  tmuxControllerActions,
  uniqueTmuxDisplayName,
} from "../../../features/tmux";
import {
  findPaneNode,
  getLeafPaneIds,
  removeSessionAndCollapse,
  replaceSessionIdInPaneTree,
  withRecomputedSessionIds,
} from "../../../features/workspace";
import type {
  LocalTerminalConfig,
  SshConfig,
  Terminal,
  TerminalDisplayConfig,
} from "../../../models/runtime/config";
import type { SavedTerminalConfig } from "../../../models/runtime/savedConfig";
import type { TmuxSessionConfig } from "../../../models/tmux/TmuxSessionConfig";
import { clearTerminalOutput } from "../../../shared/utils/terminalOutputBuffer";
import { type UseSessionLifecycleDeps } from "./terminalLifecycleTypes";
import { buildFrontendTerminal, dispatchByType } from "./useTerminalActions.helpers";

type MaintenanceDeps = Pick<
  UseSessionLifecycleDeps,
  | "savedConfigs"
  | "terminalsRef"
  | "setSessions"
  | "setWorkspaces"
  | "activeWorkspaceId"
  | "establishingSessionsRef"
  | "updateConfigs"
  | "updateGroups"
  | "openFromConfigInternal"
  | "createWindowFromSession"
>;

export function useTerminalMaintenanceActions({
  savedConfigs,
  terminalsRef,
  setSessions,
  setWorkspaces,
  activeWorkspaceId,
  establishingSessionsRef,
  updateConfigs,
  updateGroups,
  openFromConfigInternal,
  createWindowFromSession,
}: MaintenanceDeps) {
  const saveConfigOnly = useCallback(
    (
      type: Terminal["type"],
      config: LocalTerminalConfig | SshConfig | TmuxSessionConfig,
      displayConfig?: TerminalDisplayConfig,
    ): SavedTerminalConfig => {
      const configId = crypto.randomUUID();
      const configName = config.name?.trim();
      const idAndVersion = { id: configId, version: 1 } as const;

      let savedConfig: SavedTerminalConfig;
      if (type === "local") {
        savedConfig = {
          ...idAndVersion,
          name: configName || "Local",
          type: "local",
          config: config as LocalTerminalConfig,
          displayConfig,
        };
      } else if (type === "ssh") {
        const sshConfig = config as SshConfig;
        savedConfig = {
          ...idAndVersion,
          name:
            configName ||
            `${sshConfig.username?.trim() || "user"}@${sshConfig.host?.trim() || "host"}`,
          type: "ssh",
          config: sshConfig,
          displayConfig,
        };
      } else {
        const tmuxConfig = config as TmuxSessionConfig;
        savedConfig = {
          ...idAndVersion,
          name: uniqueTmuxDisplayName(
            configName || defaultTmuxDisplayName(tmuxConfig),
            savedConfigs,
            { baseConfigId: tmuxConfig.baseConfigId },
          ),
          type: "tmux-pane",
          config: tmuxConfig,
          displayConfig,
        };
      }

      updateConfigs((previous) => [...previous, savedConfig]);
      return savedConfig;
    },
    [savedConfigs, updateConfigs],
  );

  const openFromConfig = useCallback(
    async (configId: string): Promise<Terminal> => {
      const terminal = await openFromConfigInternal(configId);
      if (terminal.type !== "tmux-pane") {
        createWindowFromSession(
          terminal.id,
          terminal.configId,
          terminal.name,
          activeWorkspaceId ?? undefined,
        );
      }
      return terminal;
    },
    [activeWorkspaceId, createWindowFromSession, openFromConfigInternal],
  );

  const removeConfig = useCallback(
    (configId: string) => {
      updateConfigs((previous) => previous.filter((config) => config.id !== configId));
      updateGroups((previous) =>
        previous.map((group) => ({
          ...group,
          configIds: group.configIds.filter((id) => id !== configId),
        })),
      );
      const terminal = terminalsRef.current.find((candidate) => candidate.configId === configId);
      if (!terminal) return;

      terminalSessionActions.closeTerminal(terminal.id).catch(console.error);
      clearTerminalOutput(terminal.id);
      setSessions((previous) => previous.filter((candidate) => candidate.configId !== configId));
      setWorkspaces((previous) =>
        previous.map((workspace) =>
          withRecomputedSessionIds({
            ...workspace,
            windows: workspace.windows.map((window) => {
              const newRoot = removeSessionAndCollapse(window.rootPane, terminal.id);
              const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                ? window.activePaneId
                : (getLeafPaneIds(newRoot)[0] ?? null);
              return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
            }),
          }),
        ),
      );
    },
    [setSessions, setWorkspaces, terminalsRef, updateConfigs, updateGroups],
  );

  const closeTerminal = useCallback(
    async (terminalId: number): Promise<void> => {
      try {
        await terminalSessionActions.closeTerminal(terminalId);
      } catch (error) {
        console.error("Failed to close terminal backend:", error);
      } finally {
        clearTerminalOutput(terminalId);
        setSessions((previous) => previous.filter((terminal) => terminal.id !== terminalId));
        setWorkspaces((previous) =>
          previous.map((workspace) =>
            withRecomputedSessionIds({
              ...workspace,
              windows: workspace.windows.map((window) => {
                const newRoot = removeSessionAndCollapse(window.rootPane, terminalId);
                const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                  ? window.activePaneId
                  : (getLeafPaneIds(newRoot)[0] ?? null);
                return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
              }),
            }),
          ),
        );
      }
    },
    [setSessions, setWorkspaces],
  );

  const reconnectSession = useCallback(
    async (terminalId: number): Promise<Terminal> => {
      const oldTerminal = terminalsRef.current.find((terminal) => terminal.id === terminalId);
      if (!oldTerminal) throw new Error("Terminal not found");
      if (oldTerminal.capabilities && !oldTerminal.capabilities.supportsReconnect) {
        throw new Error("Reconnect not supported for this transport");
      }

      const config = savedConfigs.find((candidate) => candidate.id === oldTerminal.configId);
      if (!config) throw new Error("Saved config not found for terminal");

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
      setSessions((previous) => [...previous, newTerminal]);
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

      establishingSessionsRef.current.delete(terminalId);
      setSessions((previous) => previous.filter((terminal) => terminal.id !== terminalId));

      try {
        await terminalSessionActions.closeTerminal(terminalId);
      } catch (error) {
        console.error("Failed to close old terminal backend during reconnect:", error);
      } finally {
        clearTerminalOutput(terminalId);
      }
      return newTerminal;
    },
    [establishingSessionsRef, savedConfigs, setSessions, setWorkspaces, terminalsRef],
  );

  const renameSession = useCallback(
    (terminalId: number, name: string) => {
      setSessions((previous) =>
        previous.map((terminal) => (terminal.id === terminalId ? { ...terminal, name } : terminal)),
      );
      const terminal = terminalsRef.current.find((candidate) => candidate.id === terminalId);
      if (terminal) {
        updateConfigs((previous) =>
          previous.map((config) =>
            config.id === terminal.configId ? { ...config, name } : config,
          ),
        );
      }
    },
    [setSessions, terminalsRef, updateConfigs],
  );

  const applyDisplayConfigToLiveSession = useCallback(
    (terminalId: number, patch: Partial<TerminalDisplayConfig>) => {
      setSessions((previous) =>
        previous.map((terminal) =>
          terminal.id === terminalId
            ? { ...terminal, displayConfig: { ...(terminal.displayConfig ?? {}), ...patch } }
            : terminal,
        ),
      );
    },
    [setSessions],
  );

  return {
    saveConfigOnly,
    openFromConfig,
    removeConfig,
    closeTerminal,
    reconnectSession,
    renameSession,
    applyDisplayConfigToLiveSession,
  };
}
