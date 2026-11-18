import { useCallback } from "react";
import { terminalSessionActions, type TerminalConnectionInfo } from "../../../features/terminal";
import type {
  LocalTerminalConfig,
  SshConfig,
  Terminal,
  TerminalDisplayConfig,
} from "../../../models/runtime/config";
import type { SavedTerminalConfig } from "../../../models/runtime/savedConfig";
import { buildFrontendTerminal } from "./useTerminalActions.helpers";
import { type UseSessionLifecycleDeps } from "./terminalLifecycleTypes";

type LocalCreationDeps = Pick<
  UseSessionLifecycleDeps,
  "activeWorkspaceId" | "createWindowFromSession" | "setSessions" | "updateConfigs"
>;

export function useLocalTerminalCreationActions({
  activeWorkspaceId,
  createWindowFromSession,
  setSessions,
  updateConfigs,
}: LocalCreationDeps) {
  const createAndActivateSession = useCallback(
    async (
      type: "local" | "ssh",
      create: () => Promise<TerminalConnectionInfo>,
      config: LocalTerminalConfig | SshConfig,
      save: boolean,
      skipAutoWindow = false,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> => {
      const configId = crypto.randomUUID();
      const info = await create();
      const terminal = buildFrontendTerminal(info, configId, type, displayConfig);

      setSessions((previous) => [...previous, terminal]);

      if (save) {
        const savedConfig: SavedTerminalConfig =
          type === "local"
            ? {
                id: configId,
                name: info.name,
                version: 1,
                type: "local",
                config: config as LocalTerminalConfig,
                displayConfig,
              }
            : {
                id: configId,
                name: info.name,
                version: 1,
                type: "ssh",
                config: config as SshConfig,
                displayConfig,
              };
        updateConfigs((previous) => [...previous, savedConfig]);
      }

      if (!skipAutoWindow) {
        createWindowFromSession(
          terminal.id,
          terminal.configId,
          terminal.name,
          activeWorkspaceId ?? undefined,
        );
      }
      return terminal;
    },
    [activeWorkspaceId, createWindowFromSession, setSessions, updateConfigs],
  );

  const createLocalSession = useCallback(
    async (
      config: LocalTerminalConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> =>
      createAndActivateSession(
        "local",
        () => terminalSessionActions.createLocal(config, displayConfig?.logging),
        config,
        save,
        false,
        displayConfig,
      ),
    [createAndActivateSession],
  );

  const createSshSession = useCallback(
    async (
      config: SshConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> =>
      createAndActivateSession(
        "ssh",
        () => terminalSessionActions.createSsh(config, displayConfig?.logging),
        config,
        save,
        false,
        displayConfig,
      ),
    [createAndActivateSession],
  );

  const createLocalSessionOnly = useCallback(
    async (
      config: LocalTerminalConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> =>
      createAndActivateSession(
        "local",
        () => terminalSessionActions.createLocal(config, displayConfig?.logging),
        config,
        save,
        true,
        displayConfig,
      ),
    [createAndActivateSession],
  );

  const createSshSessionOnly = useCallback(
    async (
      config: SshConfig,
      save = true,
      displayConfig?: TerminalDisplayConfig,
    ): Promise<Terminal> =>
      createAndActivateSession(
        "ssh",
        () => terminalSessionActions.createSsh(config, displayConfig?.logging),
        config,
        save,
        true,
        displayConfig,
      ),
    [createAndActivateSession],
  );

  return {
    createLocalSession,
    createSshSession,
    createLocalSessionOnly,
    createSshSessionOnly,
  };
}
