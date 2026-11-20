import { useCallback } from "react";
import type { TerminalId, WorkspaceId } from "../../../models";
import {
  terminalSessionActions,
  type LocalTerminalConfig,
  type SshConfig,
  type Terminal,
  type TerminalDisplayConfig,
} from "../../../features/terminal";
import {
  defaultTmuxDisplayName,
  uniqueTmuxDisplayName,
  type SavedTerminalConfig,
  type TerminalGroup,
  type TmuxSessionConfig,
} from "../../../features/launch-config";
import {
  findPaneNode,
  getLeafPaneIds,
  removeSessionAndCollapse,
  withRecomputedSessionIds,
  type Window,
  type Workspace,
} from "../../../features/workspace";
import { clearTerminalOutput } from "../../../features/terminal-surface";

interface UseSavedTerminalConfigActionsOptions {
  savedConfigs: SavedTerminalConfig[];
  terminalsRef: React.MutableRefObject<Terminal[]>;
  activeWorkspaceId: WorkspaceId | null;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  setWorkspaces: React.Dispatch<React.SetStateAction<Workspace[]>>;
  updateConfigs: (updater: (previous: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
  updateGroups: (updater: (previous: TerminalGroup[]) => TerminalGroup[]) => void;
  openFromConfigInternal: (configId: string) => Promise<Terminal>;
  createWindowFromSession: (
    terminalId: TerminalId,
    configId: string,
    name?: string,
    targetWorkspaceId?: WorkspaceId,
  ) => Window;
}

export function useSavedTerminalConfigActions({
  savedConfigs,
  terminalsRef,
  activeWorkspaceId,
  setSessions,
  setWorkspaces,
  updateConfigs,
  updateGroups,
  openFromConfigInternal,
  createWindowFromSession,
}: UseSavedTerminalConfigActionsOptions) {
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
              const newActivePaneId = findPaneNode(newRoot, window.activePaneId)
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

  return { openFromConfig, removeConfig, saveConfigOnly };
}
