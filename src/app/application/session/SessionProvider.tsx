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
import { useTerminalState } from "./useTerminalState";
import { useTerminalPersistence } from "./useTerminalPersistence";
import { useTerminalActions } from "./useTerminalActions";
import { useTauriListeners } from "./useTauriListeners";
import { usePaneIntentActions } from "./usePaneIntentActions";

export function SessionProvider({ children }: { children: ReactNode }) {
  const state = useTerminalState();
  const persistence = useTerminalPersistence(state);
  const actions = useTerminalActions({ ...state, ...persistence });
  const paneIntents = usePaneIntentActions({ state, actions });
  useTauriListeners(state);
  const getTerminalSize = useCallback(
    (terminalId: number) => state.terminalSizesRef.current.get(terminalId),
    [state.terminalSizesRef],
  );

  const preferences = useMemo<SessionPreferencesContextType>(
    () => ({
      globalLocalEcho: state.globalLocalEcho,
      setGlobalLocalEcho: state.setGlobalLocalEcho,
    }),
    [state.globalLocalEcho, state.setGlobalLocalEcho],
  );

  const savedLaunchConfigs = useMemo<SavedLaunchConfigsContextType>(
    () => ({
      savedConfigs: state.savedConfigs,
      groups: state.groups,
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
      state.savedConfigs,
      state.groups,
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
      terminals: state.terminals,
      terminalSizesVersion: state.terminalSizesVersion,
      getTerminalSize,
      getEffectiveLocalEcho: state.getEffectiveLocalEcho,
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
      state.terminals,
      state.terminalSizesVersion,
      getTerminalSize,
      state.getEffectiveLocalEcho,
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
      openTmuxSessions: state.openTmuxSessions,
      tmuxControllerErrors: state.tmuxControllerErrors,
      createTmuxSession: actions.createTmuxSession,
      attachTmuxSession: actions.attachTmuxSession,
      detachTmuxSession: actions.detachTmuxSession,
      reconnectTmuxSession: actions.reconnectTmuxSession,
      resizeTmuxWindow: tmuxControllerActions.resizeWindow,
      dismissTmuxControllerError: actions.dismissTmuxControllerError,
    }),
    [
      state.openTmuxSessions,
      state.tmuxControllerErrors,
      actions.createTmuxSession,
      actions.attachTmuxSession,
      actions.detachTmuxSession,
      actions.reconnectTmuxSession,
      actions.dismissTmuxControllerError,
    ],
  );

  const workspaceLayout = useMemo<WorkspaceLayoutContextType>(
    () => ({
      workspaces: state.workspaces,
      activeWorkspaceId: state.activeWorkspaceId,
      savedWorkspaces: state.savedWorkspaces,
      savedWindowConfigs: state.savedWindowConfigs,
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
      state.workspaces,
      state.activeWorkspaceId,
      state.savedWorkspaces,
      state.savedWindowConfigs,
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
