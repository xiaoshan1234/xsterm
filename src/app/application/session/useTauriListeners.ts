import { useTmuxEventBridge } from "./useTmuxEventBridge";
import { useTerminalEventBridge } from "./useTerminalEventBridge";
import { type SessionState } from "./types";

export function useTauriListeners(state: SessionState): void {
  useTerminalEventBridge({
    setTerminals: state.terminal.setSessions,
    setWorkspaces: state.workspace.setWorkspaces,
    terminalsRef: state.terminal.terminalsRef,
    establishingSessionsRef: state.terminal.establishingSessionsRef,
  });

  useTmuxEventBridge({
    setTerminals: state.terminal.setSessions,
    setWorkspaces: state.workspace.setWorkspaces,
    terminalsRef: state.terminal.terminalsRef,
    workspacesRef: state.workspace.workspacesRef,
    establishingSessionsRef: state.terminal.establishingSessionsRef,
    setTmuxControllerErrors: state.tmux.setTmuxControllerErrors,
    tmuxControllerConfigsRef: state.tmux.tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef: state.tmux.tmuxControllerConfigIdsRef,
    syncOpenTmuxSessions: state.tmux.syncOpenTmuxSessions,
    tmuxControllersClosingRef: state.tmux.tmuxControllersClosingRef,
  });
}
