import { useCallback } from "react";
import { terminalSessionActions } from "../../../features/terminal";
import { tmuxWindowActions } from "../../../features/tmux";
import { useGroupActions } from "../../../features/launch-config";
import { usePersistenceActions } from "../../../features/workspace";
import { type SessionPersistence, type SessionState } from "./types";
import { usePaneActions } from "./usePaneActions";
import { useSavedConfigTerminalOpen } from "./useSavedConfigTerminalOpen";
import { useTerminalLifecycle } from "./useTerminalLifecycle";
import { useTerminalStreamActions } from "./useTerminalStreamActions";
import { useTerminalWorkspaceAttachmentActions } from "./useTerminalWorkspaceAttachmentActions";
import { useWindowActions } from "./useWindowActions";
import { useWorkspaceActions } from "./useWorkspaceActions";

interface UseSessionCoordinatorOptions {
  state: SessionState;
  persistence: SessionPersistence;
}

/**
 * Composes concern-focused session hooks. Cross-aggregate use cases live in
 * dedicated hooks; this function only wires their state, persistence, and
 * event-facing contracts together.
 */
export function useTerminalActions({
  state,
  persistence: sessionPersistence,
}: UseSessionCoordinatorOptions) {
  const { savedConfigs, nextGroupId, setNextGroupId } = state.launchConfig;
  const { terminalsRef, setSessions, establishingSessionsRef, reportTerminalSize } = state.terminal;
  const {
    workspacesRef,
    setWorkspaces,
    setActiveWorkspaceId,
    activeWorkspaceId,
    savedWorkspaces,
    savedWindowConfigs,
    setSavedWorkspaces,
    setSavedWindowConfigs,
  } = state.workspace;
  const {
    tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef,
    tmuxControllersClosingRef,
    pendingTmuxSessionKeysRef,
    syncOpenTmuxSessions,
    setTmuxControllerErrors,
  } = state.tmux;
  const { updateConfigs, updateGroups, persistSavedWorkspaces, persistSavedWindowConfigs } =
    sessionPersistence;

  const createTerminalFromSavedConfig = useSavedConfigTerminalOpen({
    savedConfigs,
    terminalsRef,
    workspacesRef,
    setTerminals: setSessions,
    setWorkspaces,
    setActiveWorkspaceId,
    tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef,
    pendingTmuxSessionKeysRef,
    syncOpenTmuxSessions,
  });
  const { createWindowFromSession, createWorkspaceFromSession } =
    useTerminalWorkspaceAttachmentActions({
      terminalsRef,
      workspacesRef,
      setWorkspaces,
      setActiveWorkspaceId,
    });

  const lifecycle = useTerminalLifecycle({
    savedConfigs,
    terminalsRef,
    setSessions,
    setWorkspaces,
    activeWorkspaceId,
    establishingSessionsRef,
    updateConfigs,
    updateGroups,
    tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef,
    syncOpenTmuxSessions,
    pendingTmuxSessionKeysRef,
    tmuxControllersClosingRef,
    openFromConfigInternal: createTerminalFromSavedConfig,
    createWindowFromSession,
  });

  const pane = usePaneActions({
    terminalsRef,
    workspacesRef,
    setSessions,
    setWorkspaces,
    establishingSessionsRef,
  });

  const terminalStream = useTerminalStreamActions({ setSessions });

  const windowActions = useWindowActions({
    savedConfigs,
    terminalsRef,
    workspacesRef,
    activeWorkspaceId,
    setSessions,
    setWorkspaces,
    establishingSessionsRef,
    createTerminalFromSavedConfig,
    createWindowFromSession,
    closeTerminal: terminalSessionActions.closeTerminal,
    killTmuxWindow: tmuxWindowActions.killWindow,
  });

  const workspaceActions = useWorkspaceActions({
    workspacesRef,
    setWorkspaces,
    setActiveWorkspaceId,
    setSessions,
    establishingSessionsRef,
    closeTerminal: terminalSessionActions.closeTerminal,
  });

  const workspacePersistence = usePersistenceActions({
    savedWorkspaces,
    savedWindowConfigs,
    workspacesRef,
    terminalsRef,
    setWorkspaces,
    setActiveWorkspaceId,
    setSavedWorkspaces,
    setSavedWindowConfigs,
    setSessions,
    establishingSessionsRef,
    persistSavedWorkspaces,
    persistSavedWindowConfigs,
    openFromConfigInternal: createTerminalFromSavedConfig,
    closeTerminal: terminalSessionActions.closeTerminal,
  });

  const group = useGroupActions({
    nextGroupId,
    setNextGroupId,
    updateConfigs,
    updateGroups,
  });

  const dismissTmuxControllerError = useCallback(
    (controllerId: number) => {
      setTmuxControllerErrors((previous) => {
        const next = new Map(previous);
        next.delete(controllerId);
        return next;
      });
    },
    [setTmuxControllerErrors],
  );

  return {
    createTerminalFromSavedConfig,
    createWindowFromSession,
    createWindowFromSavedConfig: windowActions.createWindowFromSavedConfig,
    createWorkspaceFromSession,
    ...lifecycle,
    ...pane,
    ...terminalStream,
    reportTerminalSize,
    createWindow: windowActions.createWindow,
    createInitWindow: windowActions.createInitWindow,
    replaceInitWindowWithTerminal: windowActions.replaceInitWindowWithTerminal,
    closeWindow: windowActions.closeWindow,
    setActiveWindow: windowActions.setActiveWindow,
    setActivePane: windowActions.setActivePane,
    reorderWindows: windowActions.reorderWindows,
    renameWindow: windowActions.renameWindow,
    createDefaultWorkspace: workspaceActions.createDefaultWorkspace,
    createEmptyWorkspace: workspaceActions.createEmptyWorkspace,
    setActiveWorkspace: workspaceActions.setActiveWorkspace,
    closeWorkspace: workspaceActions.closeWorkspace,
    ...workspacePersistence,
    ...group,
    applyDisplayConfigToLiveSession: lifecycle.applyDisplayConfigToLiveSession,
    dismissTmuxControllerError,
  };
}
