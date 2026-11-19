import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { createApplicationError } from "../../../models/applicationError";
import type { WorkspaceId } from "../../../models";
import {
  isTmuxPaneTerminal,
  terminalSessionActions,
  type LocalTerminalConfig,
  type SshConfig,
  type Terminal,
} from "../../../features/terminal";
import {
  tmuxSessionKey,
  type SavedTerminalConfig,
  type TmuxSessionConfig,
} from "../../../features/launch-config";
import { tmuxControllerActions } from "../../../features/tmux";
import type { Workspace } from "../../../features/workspace";
import { dispatchByType } from "./useTerminalActions.helpers";
import { buildFrontendTerminal } from "./useTerminalActions.helpers";
import { findTerminalPaneLocation, focusTerminalInWorkspaces } from "./terminalPaneLocation";
import { findOpenTmuxControllerId } from "../../../features/tmux";

interface UseSavedConfigTerminalOpenOptions {
  savedConfigs: SavedTerminalConfig[];
  terminalsRef: MutableRefObject<Terminal[]>;
  workspacesRef: MutableRefObject<Workspace[]>;
  setTerminals: Dispatch<SetStateAction<Terminal[]>>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  setActiveWorkspaceId: Dispatch<SetStateAction<WorkspaceId | null>>;
  tmuxControllerConfigsRef: MutableRefObject<Map<number, TmuxSessionConfig>>;
  tmuxControllerConfigIdsRef: MutableRefObject<Map<number, string>>;
  pendingTmuxSessionKeysRef: MutableRefObject<Set<string>>;
  syncOpenTmuxSessions: () => void;
}

export function useSavedConfigTerminalOpen({
  savedConfigs,
  terminalsRef,
  workspacesRef,
  setTerminals,
  setWorkspaces,
  setActiveWorkspaceId,
  tmuxControllerConfigsRef,
  tmuxControllerConfigIdsRef,
  pendingTmuxSessionKeysRef,
  syncOpenTmuxSessions,
}: UseSavedConfigTerminalOpenOptions): (configId: string) => Promise<Terminal> {
  return useCallback(
    async (configId: string): Promise<Terminal> => {
      const config = savedConfigs.find((candidate) => candidate.id === configId);
      if (!config) throw createApplicationError("not-found", "Config not found");

      if (config.type === "tmux-pane") {
        const tmuxConfig = config.config as TmuxSessionConfig;
        const openControllerId = findOpenTmuxControllerId(
          tmuxConfig,
          savedConfigs,
          tmuxControllerConfigIdsRef.current,
          tmuxControllerConfigsRef.current,
          terminalsRef.current,
        );
        if (openControllerId !== undefined) {
          const existing = terminalsRef.current.find(
            (terminal) =>
              isTmuxPaneTerminal(terminal) && terminal.tmux.controllerId === openControllerId,
          );
          if (existing) {
            const target = findTerminalPaneLocation(workspacesRef.current, existing.id);
            if (target) {
              setWorkspaces((previous) => focusTerminalInWorkspaces(previous, target));
              setActiveWorkspaceId(target.workspaceId);
            }
            return existing;
          }
        }

        const sessionKey = tmuxSessionKey(tmuxConfig);
        if (pendingTmuxSessionKeysRef.current.has(sessionKey)) {
          throw createApplicationError(
            "operation-in-progress",
            "This tmux session is already opening.",
          );
        }
        pendingTmuxSessionKeysRef.current.add(sessionKey);
        // Attach is event-driven: tmux events create the real windows and
        // terminals. Return a representative Terminal without adding it to state.
        try {
          const info = await tmuxControllerActions.attachSession(tmuxConfig);
          const terminal = buildFrontendTerminal(info, configId, "tmux-pane", config.displayConfig);
          const controllerId = isTmuxPaneTerminal(terminal)
            ? terminal.tmux.controllerId
            : undefined;
          if (controllerId !== undefined) {
            tmuxControllerConfigsRef.current.set(controllerId, tmuxConfig);
            tmuxControllerConfigIdsRef.current.set(controllerId, configId);
            syncOpenTmuxSessions();
            setTerminals((previous) =>
              previous.map((session) =>
                isTmuxPaneTerminal(session) && session.tmux.controllerId === controllerId
                  ? { ...session, configId, displayConfig: config.displayConfig }
                  : session,
              ),
            );
          }
          return terminal;
        } finally {
          pendingTmuxSessionKeysRef.current.delete(sessionKey);
        }
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
      const terminal = buildFrontendTerminal(info, configId, config.type, config.displayConfig);
      setTerminals((previous) => [...previous, terminal]);
      return terminal;
    },
    [
      pendingTmuxSessionKeysRef,
      savedConfigs,
      setActiveWorkspaceId,
      setTerminals,
      setWorkspaces,
      syncOpenTmuxSessions,
      terminalsRef,
      tmuxControllerConfigIdsRef,
      tmuxControllerConfigsRef,
      workspacesRef,
    ],
  );
}
