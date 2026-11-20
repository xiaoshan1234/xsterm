import { useLaunchConfigState } from "../../../features/launch-config";
import { useTerminalPreferencesState } from "../../../features/settings";
import { useTerminalState } from "../../../features/terminal";
import { useTmuxRuntimeState } from "../../../features/tmux";
import { useWorkspaceState } from "../../../features/workspace";
import { type ApplicationState } from "./types";

export function useApplicationState(): ApplicationState {
  const launchConfig = useLaunchConfigState();
  const workspace = useWorkspaceState();
  const terminal = useTerminalState();
  const tmux = useTmuxRuntimeState();
  const preferences = useTerminalPreferencesState();

  return { launchConfig, workspace, terminal, tmux, preferences };
}
