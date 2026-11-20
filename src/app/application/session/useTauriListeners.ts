import { useTmuxEventBridge } from "./useTmuxEventBridge";
import { useTerminalEventBridge } from "./useTerminalEventBridge";
import { type ApplicationState } from "./types";

export function useTauriListeners(state: ApplicationState, isEnabled: boolean): void {
  useTerminalEventBridge({
    isEnabled,
    setTerminals: state.terminal.setTerminals,
    setWorkspaces: state.workspace.setWorkspaces,
    terminalsRef: state.terminal.terminalsRef,
    establishingTerminalsRef: state.terminal.establishingTerminalsRef,
  });

  useTmuxEventBridge({
    isEnabled,
    setTerminals: state.terminal.setTerminals,
    setWorkspaces: state.workspace.setWorkspaces,
    terminalsRef: state.terminal.terminalsRef,
    workspacesRef: state.workspace.workspacesRef,
    establishingTerminalsRef: state.terminal.establishingTerminalsRef,
    setTmuxControllerErrors: state.tmux.setTmuxControllerErrors,
    tmuxControllerConfigsRef: state.tmux.tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef: state.tmux.tmuxControllerConfigIdsRef,
    syncOpenTmuxSessions: state.tmux.syncOpenTmuxSessions,
    tmuxControllersClosingRef: state.tmux.tmuxControllersClosingRef,
  });
}
