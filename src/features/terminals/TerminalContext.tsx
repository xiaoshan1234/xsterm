import { createContext, useContext, type ReactNode } from "react";
import { type TerminalContextType } from "./state/types";
import { useTerminalState } from "./state/useTerminalState";
import { useTerminalPersistence } from "./state/useTerminalPersistence";
import { useTerminalActions } from "./state/useTerminalActions";
import { useTauriListeners } from "./state/useTauriListeners";

export type { TerminalContextType };

const TerminalContext = createContext<TerminalContextType | null>(null);

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

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}

export function useSession() {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}
