import {
  useSavedLaunchConfigs,
  type EditableTerminalConfig,
  type EditableTmuxConfig,
} from "../../../features/launch-config";
import { useTerminalRuntime } from "../../../features/terminal";
import { useTmuxRuntime } from "../../../features/tmux";
import { useWorkspaceLayout } from "../../../features/workspace";

export function useOverlayActions() {
  const { createLocalSession, createSshSession, applyDisplayConfigToLiveSession, terminals } =
    useTerminalRuntime();
  const { createTmuxSession, attachTmuxSession } = useTmuxRuntime();
  const { groups, createGroup, moveConfigToGroup, renameGroup } = useSavedLaunchConfigs();
  const { renameSavedWindow, renameSavedWorkspace } = useWorkspaceLayout();

  const saveTerminalConfig = (config: EditableTerminalConfig, groupId: number | null) => {
    moveConfigToGroup(config.id, groupId);
    const liveTerminal = terminals.find((terminal) => terminal.configId === config.id);
    if (liveTerminal && config.displayConfig) {
      applyDisplayConfigToLiveSession(liveTerminal.id, config.displayConfig);
    }
  };

  const saveTmuxConfig = (config: EditableTmuxConfig) => {
    const liveTerminal = terminals.find((terminal) => terminal.configId === config.id);
    if (liveTerminal && config.displayConfig) {
      applyDisplayConfigToLiveSession(liveTerminal.id, config.displayConfig);
    }
  };

  return {
    groups,
    createLocalSession,
    createSshSession,
    createTmuxSession,
    attachTmuxSession,
    createGroup,
    moveConfigToGroup,
    renameGroup,
    renameSavedWindow,
    renameSavedWorkspace,
    saveTerminalConfig,
    saveTmuxConfig,
  };
}
