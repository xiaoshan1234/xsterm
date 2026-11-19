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
  isTmuxPaneTerminal,
  TerminalRuntimeProvider,
  type TerminalRuntimeContextType,
} from "../features/terminal";
import {
  TmuxRuntimeProvider,
  type TmuxRuntimeContextType,
} from "../features/tmux";
import {
  TerminalSurfacePortsProvider,
  type TerminalSurfacePorts,
} from "../features/terminal-surface";
import {
  PaneIntentProvider,
  PaneSessionIntentProvider,
  WorkspaceProvider,
  type PaneIntentActions,
  type PaneSessionIntentActions,
  type WorkspaceLayoutContextType,
} from "../features/workspace";

interface CreateTestApplicationOptions {
  launchConfig?: Partial<SavedLaunchConfigsContextType>;
  preferences?: Partial<SessionPreferencesContextType>;
  terminal?: Partial<TerminalRuntimeContextType>;
  tmux?: Partial<TmuxRuntimeContextType>;
  workspace?: Partial<WorkspaceLayoutContextType>;
  paneIntents?: Partial<PaneIntentActions>;
  paneSessionIntents?: Partial<PaneSessionIntentActions>;
  terminalSurface?: Partial<TerminalSurfacePorts>;
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
    createTmuxWindow: unsupportedAsync,
    killTmuxWindow: unsupportedAsync,
    renameTmuxWindow: unsupportedAsync,
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
    attachExistingTerminalToWindow: unsupportedAsync,
    closePane: unsupportedAsync,
    closeTerminal: unsupportedAsync,
    ...options.paneIntents,
  };

  const paneSessionIntents: PaneSessionIntentActions = {
    splitPaneWithSavedConfig: unsupportedAsync,
    attachSavedConfigToPane: unsupportedAsync,
    createSavedConfigForWindow: unsupportedAsync,
    createLocalTerminalForPane: unsupportedAsync,
    createSshTerminalForPane: unsupportedAsync,
    createLocalTerminalForWindow: unsupportedAsync,
    createSshTerminalForWindow: unsupportedAsync,
    ...options.paneSessionIntents,
  };

  const terminalSurface: TerminalSurfacePorts = {
    session: {
      getEffectiveLocalEcho: terminal.getEffectiveLocalEcho,
      reconnect: terminal.reconnectSession,
      resize: terminal.resizeTerminal,
      reportSize: terminal.reportTerminalSize,
      uploadImage: terminal.uploadImageToSshTerminal,
      write: terminal.writeTerminal,
      isTmuxTerminal: (terminalId) =>
        terminal.terminals.some(
          (candidate) => candidate.id === terminalId && isTmuxPaneTerminal(candidate),
        ),
      touchActivity: terminal.touchTerminalActivity,
    },
    stream: {
      subscribeOutput: async () => () => undefined,
      writeBytes: async () => undefined,
    },
    clipboard: {
      readImages: async () => [],
      readText: async () => "",
      writeText: async () => undefined,
    },
    tmux: {
      capturePane: async () => "",
      getControllerError: () => undefined,
      retryController: async () => undefined,
      dismissControllerError: () => undefined,
    },
    ...options.terminalSurface,
  };

  function Application({ children }: { children: ReactNode }) {
    return (
      <SessionPreferencesProvider value={preferences}>
        <LaunchConfigProvider value={launchConfig}>
          <TerminalRuntimeProvider value={terminal}>
            <TmuxRuntimeProvider value={tmux}>
              <WorkspaceProvider value={workspace}>
                <PaneIntentProvider value={paneIntents}>
                  <PaneSessionIntentProvider value={paneSessionIntents}>
                    <TerminalSurfacePortsProvider ports={terminalSurface}>
                      {children}
                    </TerminalSurfacePortsProvider>
                  </PaneSessionIntentProvider>
                </PaneIntentProvider>
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
    paneSessionIntents,
    terminalSurface,
  };
}
