import { type ReactNode } from "react";
import {
  LaunchConfigProvider,
  type SavedLaunchConfigsContextType,
} from "../features/launch-config";
import {
  SessionPreferencesProvider,
  type SessionPreferencesContextType,
} from "../features/settings";
import {
  TerminalRuntimeProvider,
  type TerminalRuntimeContextType,
} from "../features/terminal";
import {
  TmuxRuntimeProvider,
  type TmuxRuntimeContextType,
} from "../features/tmux";
import {
  PaneIntentProvider,
  WorkspaceProvider,
  type PaneIntentActions,
  type WorkspaceLayoutContextType,
} from "../features/workspace";

interface CreateTestApplicationOptions {
  launchConfig?: Partial<SavedLaunchConfigsContextType>;
  preferences?: Partial<SessionPreferencesContextType>;
  terminal?: Partial<TerminalRuntimeContextType>;
  tmux?: Partial<TmuxRuntimeContextType>;
  workspace?: Partial<WorkspaceLayoutContextType>;
  paneIntents?: Partial<PaneIntentActions>;
}

function unsupported(): never {
  throw new Error("Test application operation is not configured");
}

async function unsupportedAsync(): Promise<never> {
  throw new Error("Test application async operation is not configured");
}

export function createTestApplication(options: CreateTestApplicationOptions = {}) {
  const launchConfig: SavedLaunchConfigsContextType = {
    savedConfigs: [],
    groups: [],
    saveConfigOnly: unsupported,
    removeConfig: unsupported,
    addToGroup: unsupported,
    removeFromGroup: unsupported,
    moveConfigToGroup: unsupported,
    createGroup: unsupported,
    deleteGroup: unsupported,
    renameGroup: unsupported,
    updateConfig: unsupported,
    toggleGroup: unsupported,
    ...options.launchConfig,
  };

  const preferences: SessionPreferencesContextType = {
    globalLocalEcho: false,
    setGlobalLocalEcho: () => undefined,
    ...options.preferences,
  };

  const terminal: TerminalRuntimeContextType = {
    terminals: [],
    terminalSizesVersion: 0,
    getTerminalSize: () => undefined,
    getEffectiveLocalEcho: () => false,
    createLocalSession: unsupportedAsync,
    createSshSession: unsupportedAsync,
    createLocalSessionOnly: unsupportedAsync,
    createSshSessionOnly: unsupportedAsync,
    closeTerminal: unsupportedAsync,
    reconnectSession: unsupportedAsync,
    renameSession: unsupported,
    writeTerminal: unsupportedAsync,
    resizeTerminal: unsupportedAsync,
    uploadImageToSshTerminal: unsupportedAsync,
    reportTerminalSize: () => undefined,
    applyDisplayConfigToLiveSession: unsupported,
    touchTerminalActivity: () => undefined,
    ...options.terminal,
  };

  const tmux: TmuxRuntimeContextType = {
    openTmuxSessions: [],
    tmuxControllerErrors: new Map(),
    createTmuxSession: unsupportedAsync,
    attachTmuxSession: unsupportedAsync,
    detachTmuxSession: unsupportedAsync,
    reconnectTmuxSession: unsupportedAsync,
    resizeTmuxWindow: unsupportedAsync,
    dismissTmuxControllerError: () => undefined,
    ...options.tmux,
  };

  const workspace: WorkspaceLayoutContextType = {
    workspaces: [],
    activeWorkspaceId: null,
    savedWorkspaces: [],
    savedWindowConfigs: [],
    createWorkspaceFromSession: unsupported,
    createWindowFromSession: unsupported,
    createWindowFromSavedConfig: unsupportedAsync,
    createWindow: unsupported,
    createDefaultWorkspace: unsupported,
    createEmptyWorkspace: unsupported,
    createInitWindow: unsupported,
    replaceInitWindowWithTerminal: unsupported,
    closeWindow: unsupported,
    setActiveWindow: () => undefined,
    splitPane: unsupported,
    updateWindowPaneTree: unsupported,
    setActivePane: () => undefined,
    setActiveWorkspace: () => undefined,
    saveWorkspace: unsupported,
    loadWorkspace: unsupportedAsync,
    closeWorkspace: unsupported,
    deleteSavedWorkspace: unsupported,
    renameSavedWorkspace: unsupported,
    saveWindow: unsupported,
    saveAllWindows: unsupported,
    loadWindow: unsupportedAsync,
    deleteSavedWindow: unsupported,
    renameSavedWindow: unsupported,
    renameWindow: unsupported,
    reorderWindows: unsupported,
    closePane: unsupportedAsync,
    ...options.workspace,
  };

  const paneIntents: PaneIntentActions = {
    attachExistingTerminal: unsupportedAsync,
    splitPaneWithTerminal: unsupportedAsync,
    splitPaneWithSavedConfig: unsupportedAsync,
    attachSavedConfigToPane: unsupportedAsync,
    createSavedConfigForWindow: unsupportedAsync,
    closePane: unsupportedAsync,
    closeTerminal: unsupportedAsync,
    createTmuxWindow: unsupportedAsync,
    killTmuxWindow: unsupportedAsync,
    renameTmuxWindow: unsupportedAsync,
    ...options.paneIntents,
  };

  function Application({ children }: { children: ReactNode }) {
    return (
      <SessionPreferencesProvider value={preferences}>
        <LaunchConfigProvider value={launchConfig}>
          <TerminalRuntimeProvider value={terminal}>
            <TmuxRuntimeProvider value={tmux}>
              <WorkspaceProvider value={workspace}>
                <PaneIntentProvider value={paneIntents}>{children}</PaneIntentProvider>
              </WorkspaceProvider>
            </TmuxRuntimeProvider>
          </TerminalRuntimeProvider>
        </LaunchConfigProvider>
      </SessionPreferencesProvider>
    );
  }

  return {
    Application,
    launchConfig,
    preferences,
    terminal,
    tmux,
    workspace,
    paneIntents,
  };
}
