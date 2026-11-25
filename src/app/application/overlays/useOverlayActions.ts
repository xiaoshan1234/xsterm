import {
  useSavedLaunchConfigs,
  type EditableTerminalConfig,
} from "../../../features/launch-config";
import { useTerminalRuntime } from "../../../features/terminal";
import { useTmuxRuntime } from "../../../features/tmux";
import { useWorkspaceLayout } from "../../../features/workspace";

export function useOverlayActions() {
  const { createLocalSession, createSshSession } = useTerminalRuntime();
  const { createTmuxSession, attachTmuxSession } = useTmuxRuntime();
  const { groups, createGroup, moveConfigToGroup, renameGroup } = useSavedLaunchConfigs();
  const { renameSavedWindow, renameSavedWorkspace } = useWorkspaceLayout();

  const saveTerminalConfig = (config: EditableTerminalConfig, groupId: number | null) => {
    moveConfigToGroup(config.id, groupId);
  };

  // The dialog persists launch-config edits itself. Existing terminals own
  // independent properties and must only change through their property editor.
  const saveTmuxConfig = () => undefined;

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
