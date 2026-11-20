import type { ReactNode } from "react";
import { LaunchConfigProvider } from "../../../features/launch-config";
import { SessionPreferencesProvider } from "../../../features/settings";
import { TerminalRuntimeProvider } from "../../../features/terminal";
import { TmuxRuntimeProvider } from "../../../features/tmux";
import {
  PaneIntentProvider,
  PaneSessionIntentProvider,
  WorkspaceProvider,
} from "../../../features/workspace";
import {
  SessionPersistenceStatusProvider,
  type SessionPersistenceStatus,
} from "./SessionPersistenceStatusContext";
import type {
  SavedLaunchConfigsContextType,
  SessionPreferencesContextType,
  TerminalRuntimeContextType,
  WorkspaceLayoutContextType,
} from "./types";
import type { TmuxRuntimeContextType } from "../../../features/tmux";
import type { PaneIntentActions, PaneSessionIntentActions } from "../../../features/workspace";

interface SessionRuntimeProvidersProps {
  persistenceStatus: SessionPersistenceStatus;
  preferences: SessionPreferencesContextType;
  savedLaunchConfigs: SavedLaunchConfigsContextType;
  terminalRuntime: TerminalRuntimeContextType;
  tmuxRuntime: TmuxRuntimeContextType;
  workspaceLayout: WorkspaceLayoutContextType;
  paneIntents: PaneIntentActions;
  paneSessionIntents: PaneSessionIntentActions;
  children: ReactNode;
}

export function SessionRuntimeProviders({
  persistenceStatus,
  preferences,
  savedLaunchConfigs,
  terminalRuntime,
  tmuxRuntime,
  workspaceLayout,
  paneIntents,
  paneSessionIntents,
  children,
}: SessionRuntimeProvidersProps) {
  return (
    <SessionPersistenceStatusProvider value={persistenceStatus}>
      <SessionPreferencesProvider value={preferences}>
        <LaunchConfigProvider value={savedLaunchConfigs}>
          <TerminalRuntimeProvider value={terminalRuntime}>
            <TmuxRuntimeProvider value={tmuxRuntime}>
              <WorkspaceProvider value={workspaceLayout}>
                <PaneIntentProvider value={paneIntents}>
                  <PaneSessionIntentProvider value={paneSessionIntents}>
                    {children}
                  </PaneSessionIntentProvider>
                </PaneIntentProvider>
              </WorkspaceProvider>
            </TmuxRuntimeProvider>
          </TerminalRuntimeProvider>
        </LaunchConfigProvider>
      </SessionPreferencesProvider>
    </SessionPersistenceStatusProvider>
  );
}
