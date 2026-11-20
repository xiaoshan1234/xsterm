import { useMemo } from "react";
import type { SavedLaunchConfigsContextType } from "./types";
import type { ApplicationState } from "./types";
import type { useTerminalActions } from "./useTerminalActions";

interface UseSavedLaunchConfigsValueOptions {
  state: ApplicationState;
  actions: ReturnType<typeof useTerminalActions>;
}

export function useSavedLaunchConfigsValue({
  state,
  actions,
}: UseSavedLaunchConfigsValueOptions): SavedLaunchConfigsContextType {
  return useMemo(
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
      actions.addToGroup,
      actions.createGroup,
      actions.deleteGroup,
      actions.moveConfigToGroup,
      actions.removeConfig,
      actions.removeFromGroup,
      actions.renameGroup,
      actions.saveConfigOnly,
      actions.toggleGroup,
      actions.updateConfig,
      state.launchConfig.groups,
      state.launchConfig.savedConfigs,
    ],
  );
}
