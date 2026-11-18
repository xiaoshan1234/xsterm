import { useLaunchConfigState } from "../../../features/launch-config";
import { useTerminalPreferencesState } from "../../../features/settings";
import { useTerminalSessionState } from "../../../features/terminal";
import { useTmuxRuntimeState } from "../../../features/tmux";
import { useWorkspaceState } from "../../../features/workspace";
import { type TerminalState } from "./types";

export function useTerminalState(): TerminalState {
  const launchConfig = useLaunchConfigState();
  const workspace = useWorkspaceState();
  const terminal = useTerminalSessionState();
  const tmux = useTmuxRuntimeState();
  const preferences = useTerminalPreferencesState();

  return {
    ...launchConfig,
    ...workspace,
    ...terminal,
    ...tmux,
    ...preferences,
  };
}
