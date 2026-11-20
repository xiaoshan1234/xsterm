import { useCallback, useMemo, type ReactNode } from "react";
import type { TerminalId } from "../../../models";
import { ApplicationBootstrapScreen } from "../../ApplicationBootstrapScreen";
import { ApplicationRuntimeProviders } from "./ApplicationRuntimeProviders";
import { usePaneIntentActions } from "./usePaneIntentActions";
import { usePaneSessionIntentActions } from "./usePaneSessionIntentActions";
import { useSavedLaunchConfigsValue } from "./useSavedLaunchConfigsValue";
import { useApplicationState } from "./useApplicationState";
import { useTauriListeners } from "./useTauriListeners";
import { useTerminalActions } from "./useTerminalActions";
import { useTerminalPersistence } from "./useTerminalPersistence";
import { useTerminalRuntimeValue } from "./useTerminalRuntimeValue";
import { useTmuxRuntimeValue } from "./useTmuxRuntimeValue";
import { useWorkspaceLayoutValue } from "./useWorkspaceLayoutValue";
import type { ApplicationPersistenceStatus } from "./ApplicationPersistenceStatusContext";
import type { SessionPreferencesContextType } from "./types";

export function ApplicationProvider({ children }: { children: ReactNode }) {
  const state = useApplicationState();
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
  const persistenceStatus = useMemo<ApplicationPersistenceStatus>(
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
    return <ApplicationBootstrapScreen error={persistence.error ?? undefined} />;
  }

  return (
    <ApplicationRuntimeProviders
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
    </ApplicationRuntimeProviders>
  );
}
