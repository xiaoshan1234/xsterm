import { createContext, useContext, ReactNode } from "react";
import { SessionContextType } from "./session/types";
import { useSessionState } from "./session/useSessionState";
import { useSessionPersistence } from "./session/useSessionPersistence";
import { useSessionActions } from "./session/useSessionActions";
import { useTauriListeners } from "./session/useTauriListeners";

export type { SessionContextType };

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const state = useSessionState();
  const persistence = useSessionPersistence(state);
  const actions = useSessionActions({ ...state, ...persistence });
  useTauriListeners(state);

  const value: SessionContextType = {
    sessions: state.sessions,
    savedConfigs: state.savedConfigs,
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    savedWorkspaces: state.savedWorkspaces,
    savedWindowConfigs: state.savedWindowConfigs,
    groups: state.groups,
    globalLocalEcho: state.globalLocalEcho,
    setGlobalLocalEcho: state.setGlobalLocalEcho,
    getEffectiveLocalEcho: state.getEffectiveLocalEcho,
    tmuxState: state.tmuxState,
    activeTmuxWindowIds: state.activeTmuxWindowIds,
    ...actions,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}
