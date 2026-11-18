import { useLaunchConfigState } from "../../../features/launch-config/composition";
import { useTerminalPreferencesState } from "../../../features/settings";
import { useTerminalSessionState } from "../../../features/terminal/composition";
import { useTmuxRuntimeState } from "../../../features/tmux/composition";
import { useWorkspaceState } from "../../../features/workspace/composition";
import { type SessionState } from "./types";

export function useSessionState(): SessionState {
  const launchConfig = useLaunchConfigState();
  const workspace = useWorkspaceState();
  const terminal = useTerminalSessionState();
  const tmux = useTmuxRuntimeState();
  const preferences = useTerminalPreferencesState();

  return { launchConfig, workspace, terminal, tmux, preferences };
}
