import { createContext, useContext, type ReactNode } from "react";
import { type TerminalContextType } from "./types";
import { useTerminalState } from "./useTerminalState";
import { useTerminalPersistence } from "./useTerminalPersistence";
import { useTerminalActions } from "./useTerminalActions";
import { useTauriListeners } from "./useTauriListeners";

export type { TerminalContextType };

const SessionContext = createContext<TerminalContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const state = useTerminalState();
  const persistence = useTerminalPersistence(state);
  const actions = useTerminalActions({ ...state, ...persistence });
  useTauriListeners(state);

  const value: TerminalContextType = {
    terminals: state.terminals,
    setSessions: state.setSessions,
    savedConfigs: state.savedConfigs,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    savedWorkspaces: state.savedWorkspaces,
    savedWindowConfigs: state.savedWindowConfigs,
    groups: state.groups,
    globalLocalEcho: state.globalLocalEcho,
    setGlobalLocalEcho: state.setGlobalLocalEcho,
    getEffectiveLocalEcho: state.getEffectiveLocalEcho,
    tmuxControllerErrors: state.tmuxControllerErrors,
    setTmuxControllerErrors: state.setTmuxControllerErrors,
    tmuxControllerConfigsRef: state.tmuxControllerConfigsRef,
    ...actions,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}
