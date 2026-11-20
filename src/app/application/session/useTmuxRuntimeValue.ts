import { useMemo } from "react";
import {
  tmuxControllerActions,
  tmuxWindowActions,
  type TmuxRuntimeContextType,
} from "../../../features/tmux";
import type { SessionState } from "./types";
import type { useTerminalActions } from "./useTerminalActions";

interface UseTmuxRuntimeValueOptions {
  state: SessionState;
  actions: ReturnType<typeof useTerminalActions>;
}

export function useTmuxRuntimeValue({
  state,
  actions,
}: UseTmuxRuntimeValueOptions): TmuxRuntimeContextType {
  return useMemo(
    () => ({
      openTmuxSessions: state.tmux.openTmuxSessions,
      tmuxControllerErrors: state.tmux.tmuxControllerErrors,
      createTmuxSession: actions.createTmuxSession,
      attachTmuxSession: actions.attachTmuxSession,
      detachTmuxSession: actions.detachTmuxSession,
      reconnectTmuxSession: actions.reconnectTmuxSession,
      createTmuxWindow: tmuxWindowActions.createWindow,
      killTmuxWindow: tmuxWindowActions.killWindow,
      renameTmuxWindow: tmuxWindowActions.renameWindow,
      resizeTmuxWindow: tmuxControllerActions.resizeWindow,
      dismissTmuxControllerError: actions.dismissTmuxControllerError,
    }),
    [
      actions.attachTmuxSession,
      actions.createTmuxSession,
      actions.detachTmuxSession,
      actions.dismissTmuxControllerError,
      actions.reconnectTmuxSession,
      state.tmux.openTmuxSessions,
      state.tmux.tmuxControllerErrors,
    ],
  );
}
