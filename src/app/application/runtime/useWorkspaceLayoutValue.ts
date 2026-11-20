import { useMemo } from "react";
import type { WorkspaceLayoutContextType, ApplicationState } from "./types";
import type { useTerminalActions } from "./useTerminalActions";

interface UseWorkspaceLayoutValueOptions {
  state: ApplicationState;
  actions: ReturnType<typeof useTerminalActions>;
}

export function useWorkspaceLayoutValue({
  state,
  actions,
}: UseWorkspaceLayoutValueOptions): WorkspaceLayoutContextType {
  return useMemo(
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
      actions.closePane,
      actions.closeWindow,
      actions.closeWorkspace,
      actions.createDefaultWorkspace,
      actions.createEmptyWorkspace,
      actions.createInitWindow,
      actions.createWindow,
      actions.createWindowFromSavedConfig,
      actions.createWindowFromSession,
      actions.createWorkspaceFromSession,
      actions.deleteSavedWindow,
      actions.deleteSavedWorkspace,
      actions.loadWindow,
      actions.loadWorkspace,
      actions.renameSavedWindow,
      actions.renameSavedWorkspace,
      actions.renameWindow,
      actions.reorderWindows,
      actions.replaceInitWindowWithTerminal,
      actions.saveAllWindows,
      actions.saveWindow,
      actions.saveWorkspace,
      actions.setActivePane,
      actions.setActiveWindow,
      actions.setActiveWorkspace,
      actions.splitPane,
      actions.updateWindowPaneTree,
      state.workspace.activeWorkspaceId,
      state.workspace.savedWindowConfigs,
      state.workspace.savedWorkspaces,
      state.workspace.workspaces,
    ],
  );
}
