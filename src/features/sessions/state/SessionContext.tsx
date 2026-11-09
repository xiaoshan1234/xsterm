import { createContext, useContext, useMemo, type Context, type ReactNode } from "react";
import {
  type SavedLaunchConfigsContextType,
  type SessionPreferencesContextType,
  type TerminalContextType,
  type TerminalRuntimeContextType,
  type WorkspaceLayoutContextType,
} from "./types";
import { useTerminalState } from "./useTerminalState";
import { useTerminalPersistence } from "./useTerminalPersistence";
import { useTerminalActions } from "./useTerminalActions";
import { useTauriListeners } from "./useTauriListeners";

const SessionContext = createContext<TerminalContextType | null>(null);
const SessionPreferencesContext = createContext<SessionPreferencesContextType | null>(null);
const SavedLaunchConfigsContext = createContext<SavedLaunchConfigsContextType | null>(null);
const TerminalRuntimeContext = createContext<TerminalRuntimeContextType | null>(null);
const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const state = useTerminalState();
  const persistence = useTerminalPersistence(state);
  const actions = useTerminalActions({ ...state, ...persistence });
  useTauriListeners(state);

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
      getEffectiveLocalEcho: state.getEffectiveLocalEcho,
      tmuxControllerErrors: state.tmuxControllerErrors,
      createLocalSession: actions.createLocalSession,
      createSshSession: actions.createSshSession,
      createLocalSessionOnly: actions.createLocalSessionOnly,
      createSshSessionOnly: actions.createSshSessionOnly,
      attachTmuxSession: actions.attachTmuxSession,
      openFromConfig: actions.openFromConfig,
      createTerminalFromSavedConfig: actions.createTerminalFromSavedConfig,
      closeTerminal: actions.closeTerminal,
      reconnectSession: actions.reconnectSession,
      renameSession: actions.renameSession,
      writeTerminal: actions.writeTerminal,
      resizeTerminal: actions.resizeTerminal,
      applyDisplayConfigToLiveSession: actions.applyDisplayConfigToLiveSession,
      touchTerminalActivity: actions.touchTerminalActivity,
      dismissTmuxControllerError: actions.dismissTmuxControllerError,
    }),
    [
      state.terminals,
      state.getEffectiveLocalEcho,
      state.tmuxControllerErrors,
      actions.createLocalSession,
      actions.createSshSession,
      actions.createLocalSessionOnly,
      actions.createSshSessionOnly,
      actions.attachTmuxSession,
      actions.openFromConfig,
      actions.createTerminalFromSavedConfig,
      actions.closeTerminal,
      actions.reconnectSession,
      actions.renameSession,
      actions.writeTerminal,
      actions.resizeTerminal,
      actions.applyDisplayConfigToLiveSession,
      actions.touchTerminalActivity,
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

  const value = useMemo<TerminalContextType>(
    () => ({
      ...preferences,
      ...savedLaunchConfigs,
      ...terminalRuntime,
      ...workspaceLayout,
    }),
    [preferences, savedLaunchConfigs, terminalRuntime, workspaceLayout],
  );

  return (
    <SessionPreferencesContext.Provider value={preferences}>
      <SavedLaunchConfigsContext.Provider value={savedLaunchConfigs}>
        <TerminalRuntimeContext.Provider value={terminalRuntime}>
          <WorkspaceLayoutContext.Provider value={workspaceLayout}>
            <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
          </WorkspaceLayoutContext.Provider>
        </TerminalRuntimeContext.Provider>
      </SavedLaunchConfigsContext.Provider>
    </SessionPreferencesContext.Provider>
  );
}

/**
 * Legacy aggregate hook retained while older views are migrated.
 * New code should subscribe to the narrow slice it actually consumes.
 */
export function useSession() {
  return useRequiredContext(SessionContext, "useSession");
}

export function useSessionPreferences(): SessionPreferencesContextType {
  return useRequiredContext(SessionPreferencesContext, "useSessionPreferences");
}

export function useSavedLaunchConfigs(): SavedLaunchConfigsContextType {
  return useRequiredContext(SavedLaunchConfigsContext, "useSavedLaunchConfigs");
}

export function useTerminalRuntime(): TerminalRuntimeContextType {
  return useRequiredContext(TerminalRuntimeContext, "useTerminalRuntime");
}

export function useWorkspaceLayout(): WorkspaceLayoutContextType {
  return useRequiredContext(WorkspaceLayoutContext, "useWorkspaceLayout");
}

function useRequiredContext<ContextValue>(
  context: Context<ContextValue | null>,
  hookName: string,
): ContextValue {
  const value = useContext(context);
  if (value === null) {
    throw new Error(`${hookName} must be used within a SessionProvider`);
  }
  return value;
}
