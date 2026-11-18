import { useCallback, useMemo, type ReactNode } from "react";
import { LaunchConfigProvider } from "../../../features/launch-config";
import { SessionPreferencesProvider } from "../../../features/settings";
import { TerminalRuntimeProvider } from "../../../features/terminal";
import { PaneIntentProvider, WorkspaceProvider } from "../../../features/workspace";
import { TmuxRuntimeProvider, type TmuxRuntimeContextType } from "../../../features/tmux";
import { tmuxControllerActions } from "../../../features/tmux/ports";
import {
  type SavedLaunchConfigsContextType,
  type SessionPreferencesContextType,
  type TerminalRuntimeContextType,
  type WorkspaceLayoutContextType,
} from "./types";
import { useSessionState } from "./useSessionState";
import { useTerminalPersistence } from "./useTerminalPersistence";
import { useTerminalActions } from "./useTerminalActions";
import { useTauriListeners } from "./useTauriListeners";
import { usePaneIntentActions } from "./usePaneIntentActions";

export function SessionProvider({ children }: { children: ReactNode }) {
  const state = useSessionState();
  const persistence = useTerminalPersistence({
    setSavedConfigs: state.launchConfig.setSavedConfigs,
    setGroups: state.launchConfig.setGroups,
    setNextGroupId: state.launchConfig.setNextGroupId,
    setSavedWorkspaces: state.workspace.setSavedWorkspaces,
    setSavedWindowConfigs: state.workspace.setSavedWindowConfigs,
    setGlobalLocalEcho: state.preferences.setGlobalLocalEcho,
    globalLocalEcho: state.preferences.globalLocalEcho,
    nextGroupId: state.launchConfig.nextGroupId,
  });
  const actions = useTerminalActions({ state, persistence });
  const paneIntents = usePaneIntentActions({
    state: {
      terminals: state.terminal.terminals,
      workspaces: state.workspace.workspaces,
    },
    actions,
  });
  useTauriListeners(state);
  const getTerminalSize = useCallback(
    (terminalId: number) => state.terminal.terminalSizesRef.current.get(terminalId),
    [state.terminal.terminalSizesRef],
  );

  const preferences = useMemo<SessionPreferencesContextType>(
    () => ({
      globalLocalEcho: state.preferences.globalLocalEcho,
      setGlobalLocalEcho: state.preferences.setGlobalLocalEcho,
    }),
    [state.preferences.globalLocalEcho, state.preferences.setGlobalLocalEcho],
  );

  const savedLaunchConfigs = useMemo<SavedLaunchConfigsContextType>(
    () => ({
      savedConfigs: state.launchConfig.savedConfigs,
      groups: state.launchConfig.groups,
      saveConfigOnly: actions.saveConfigOnly,
      removeConfig: actions.removeConfig,
      addToGroup: actions.addToGroup,
      removeFromGroup: actions.removeFromGroup,
      moveConfigToGroup: actions.moveConfigToGroup,
      createGroup: actions.createGroup,
      deleteGroup: actions.deleteGroup,
      renameGroup: actions.renameGroup,
      updateConfig: actions.updateConfig,
      toggleGroup: actions.toggleGroup,
    }),
    [
      state.launchConfig.savedConfigs,
      state.launchConfig.groups,
      actions.saveConfigOnly,
      actions.removeConfig,
      actions.addToGroup,
      actions.removeFromGroup,
      actions.moveConfigToGroup,
      actions.createGroup,
      actions.deleteGroup,
      actions.renameGroup,
      actions.updateConfig,
      actions.toggleGroup,
    ],
  );

  const terminalRuntime = useMemo<TerminalRuntimeContextType>(
    () => ({
      terminals: state.terminal.terminals,
      terminalSizesVersion: state.terminal.terminalSizesVersion,
      getTerminalSize,
      getEffectiveLocalEcho: state.preferences.getEffectiveLocalEcho,
      createLocalSession: actions.createLocalSession,
      createSshSession: actions.createSshSession,
      createLocalSessionOnly: actions.createLocalSessionOnly,
      createSshSessionOnly: actions.createSshSessionOnly,
      closeTerminal: actions.closeTerminal,
      reconnectSession: actions.reconnectSession,
      renameSession: actions.renameSession,
      writeTerminal: actions.writeTerminal,
      resizeTerminal: actions.resizeTerminal,
      uploadImageToSshTerminal: actions.uploadImageToSshTerminal,
      reportTerminalSize: actions.reportTerminalSize,
      applyDisplayConfigToLiveSession: actions.applyDisplayConfigToLiveSession,
      touchTerminalActivity: actions.touchTerminalActivity,
    }),
    [
      state.terminal.terminals,
      state.terminal.terminalSizesVersion,
      getTerminalSize,
      state.preferences.getEffectiveLocalEcho,
      actions.createLocalSession,
      actions.createSshSession,
      actions.createLocalSessionOnly,
      actions.createSshSessionOnly,
      actions.closeTerminal,
      actions.reconnectSession,
      actions.renameSession,
      actions.writeTerminal,
      actions.resizeTerminal,
      actions.uploadImageToSshTerminal,
      actions.reportTerminalSize,
      actions.applyDisplayConfigToLiveSession,
      actions.touchTerminalActivity,
    ],
  );

  const tmuxRuntime = useMemo<TmuxRuntimeContextType>(
    () => ({
      openTmuxSessions: state.tmux.openTmuxSessions,
      tmuxControllerErrors: state.tmux.tmuxControllerErrors,
      createTmuxSession: actions.createTmuxSession,
      attachTmuxSession: actions.attachTmuxSession,
      detachTmuxSession: actions.detachTmuxSession,
      reconnectTmuxSession: actions.reconnectTmuxSession,
      resizeTmuxWindow: tmuxControllerActions.resizeWindow,
      dismissTmuxControllerError: actions.dismissTmuxControllerError,
    }),
    [
      state.tmux.openTmuxSessions,
      state.tmux.tmuxControllerErrors,
      actions.createTmuxSession,
      actions.attachTmuxSession,
      actions.detachTmuxSession,
      actions.reconnectTmuxSession,
      actions.dismissTmuxControllerError,
    ],
  );

  const workspaceLayout = useMemo<WorkspaceLayoutContextType>(
    () => ({
      workspaces: state.workspace.workspaces,
      activeWorkspaceId: state.workspace.activeWorkspaceId,
      savedWorkspaces: state.workspace.savedWorkspaces,
      savedWindowConfigs: state.workspace.savedWindowConfigs,
      createWorkspaceFromSession: actions.createWorkspaceFromSession,
      createWindowFromSession: actions.createWindowFromSession,
      createWindowFromSavedConfig: actions.createWindowFromSavedConfig,
      createWindow: actions.createWindow,
      createDefaultWorkspace: actions.createDefaultWorkspace,
      createEmptyWorkspace: actions.createEmptyWorkspace,
      createInitWindow: actions.createInitWindow,
      replaceInitWindowWithTerminal: actions.replaceInitWindowWithTerminal,
      closeWindow: actions.closeWindow,
      setActiveWindow: actions.setActiveWindow,
      splitPane: actions.splitPane,
      updateWindowPaneTree: actions.updateWindowPaneTree,
      setActivePane: actions.setActivePane,
      setActiveWorkspace: actions.setActiveWorkspace,
      saveWorkspace: actions.saveWorkspace,
      loadWorkspace: actions.loadWorkspace,
      closeWorkspace: actions.closeWorkspace,
      deleteSavedWorkspace: actions.deleteSavedWorkspace,
      renameSavedWorkspace: actions.renameSavedWorkspace,
      saveWindow: actions.saveWindow,
      saveAllWindows: actions.saveAllWindows,
      loadWindow: actions.loadWindow,
      deleteSavedWindow: actions.deleteSavedWindow,
      renameSavedWindow: actions.renameSavedWindow,
      renameWindow: actions.renameWindow,
      reorderWindows: actions.reorderWindows,
      closePane: actions.closePane,
    }),
    [
      state.workspace.workspaces,
      state.workspace.activeWorkspaceId,
      state.workspace.savedWorkspaces,
      state.workspace.savedWindowConfigs,
      actions.createWorkspaceFromSession,
      actions.createWindowFromSession,
      actions.createWindowFromSavedConfig,
      actions.createWindow,
      actions.createDefaultWorkspace,
      actions.createEmptyWorkspace,
      actions.createInitWindow,
      actions.replaceInitWindowWithTerminal,
      actions.closeWindow,
      actions.setActiveWindow,
      actions.splitPane,
      actions.updateWindowPaneTree,
      actions.setActivePane,
      actions.setActiveWorkspace,
      actions.saveWorkspace,
      actions.loadWorkspace,
      actions.closeWorkspace,
      actions.deleteSavedWorkspace,
      actions.renameSavedWorkspace,
      actions.saveWindow,
      actions.saveAllWindows,
      actions.loadWindow,
      actions.deleteSavedWindow,
      actions.renameSavedWindow,
      actions.renameWindow,
      actions.reorderWindows,
      actions.closePane,
    ],
  );

  return (
    <SessionPreferencesProvider value={preferences}>
      <LaunchConfigProvider value={savedLaunchConfigs}>
        <TerminalRuntimeProvider value={terminalRuntime}>
          <TmuxRuntimeProvider value={tmuxRuntime}>
            <WorkspaceProvider value={workspaceLayout}>
              <PaneIntentProvider value={paneIntents}>{children}</PaneIntentProvider>
            </WorkspaceProvider>
          </TmuxRuntimeProvider>
        </TerminalRuntimeProvider>
      </LaunchConfigProvider>
    </SessionPreferencesProvider>
  );
}
