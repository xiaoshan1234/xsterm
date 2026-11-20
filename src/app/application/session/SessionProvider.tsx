import { useCallback, useMemo, type ReactNode } from "react";
import type { TerminalId } from "../../../models";
import { SessionBootstrapScreen } from "../../SessionBootstrapScreen";
import { SessionRuntimeProviders } from "./SessionRuntimeProviders";
import { usePaneIntentActions } from "./usePaneIntentActions";
import { usePaneSessionIntentActions } from "./usePaneSessionIntentActions";
import { useSavedLaunchConfigsValue } from "./useSavedLaunchConfigsValue";
import { useSessionState } from "./useSessionState";
import { useTauriListeners } from "./useTauriListeners";
import { useTerminalActions } from "./useTerminalActions";
import { useTerminalPersistence } from "./useTerminalPersistence";
import { useTerminalRuntimeValue } from "./useTerminalRuntimeValue";
import { useTmuxRuntimeValue } from "./useTmuxRuntimeValue";
import { useWorkspaceLayoutValue } from "./useWorkspaceLayoutValue";
import type { SessionPersistenceStatus } from "./SessionPersistenceStatusContext";
import type { SessionPreferencesContextType } from "./types";

export function SessionProvider({ children }: { children: ReactNode }) {
  const state = useSessionState();
  const persistence = useTerminalPersistence({
    setSavedConfigs: state.launchConfig.setSavedConfigs,
    setGroups: state.launchConfig.setGroups,
    setNextGroupId: state.launchConfig.setNextGroupId,
    setSavedWorkspaces: state.workspace.setSavedWorkspaces,
    setSavedWindowConfigs: state.workspace.setSavedWindowConfigs,
    setGlobalLocalEcho: state.preferences.setGlobalLocalEcho,
    savedConfigs: state.launchConfig.savedConfigs,
    groups: state.launchConfig.groups,
    globalLocalEcho: state.preferences.globalLocalEcho,
    nextGroupId: state.launchConfig.nextGroupId,
  });
  const actions = useTerminalActions({ state, persistence });
  const paneIntents = usePaneIntentActions({
    state: {
      terminals: state.terminal.terminals,
      workspaces: state.workspace.workspaces,
    },
    actions,
  });
  const paneSessionIntents = usePaneSessionIntentActions({
    actions,
    workspaceIntents: paneIntents,
  });
  useTauriListeners(state, persistence.isLoaded);

  const getTerminalSize = useCallback(
    (terminalId: TerminalId) => state.terminal.terminalSizesRef.current.get(terminalId),
    [state.terminal.terminalSizesRef],
  );
  const persistenceStatus = useMemo<SessionPersistenceStatus>(
    () => ({
      saveError: persistence.saveError,
      clearSaveError: persistence.clearSaveError,
    }),
    [persistence.clearSaveError, persistence.saveError],
  );
  const preferences = useMemo<SessionPreferencesContextType>(
    () => ({
      globalLocalEcho: state.preferences.globalLocalEcho,
      setGlobalLocalEcho: state.preferences.setGlobalLocalEcho,
    }),
    [state.preferences.globalLocalEcho, state.preferences.setGlobalLocalEcho],
  );
  const savedLaunchConfigs = useSavedLaunchConfigsValue({ state, actions });
  const terminalRuntime = useTerminalRuntimeValue({
    state,
    actions,
    getTerminalSize,
  });
  const tmuxRuntime = useTmuxRuntimeValue({ state, actions });
  const workspaceLayout = useWorkspaceLayoutValue({ state, actions });

  if (persistence.error || !persistence.isLoaded) {
    return <SessionBootstrapScreen error={persistence.error ?? undefined} />;
  }

  return (
    <SessionRuntimeProviders
      persistenceStatus={persistenceStatus}
      preferences={preferences}
      savedLaunchConfigs={savedLaunchConfigs}
      terminalRuntime={terminalRuntime}
      tmuxRuntime={tmuxRuntime}
      workspaceLayout={workspaceLayout}
      paneIntents={paneIntents}
      paneSessionIntents={paneSessionIntents}
    >
      {children}
    </SessionRuntimeProviders>
  );
}
