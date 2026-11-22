import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  isTmuxPaneTerminal,
  terminalClipboard,
  terminalStreamActions,
  useTerminalRuntime,
} from "../../../features/terminal";
import { tmuxControllerActions, useTmuxRuntime } from "../../../features/tmux";
import {
  TerminalSurfacePortsProvider,
  type TerminalSurfacePorts,
  type TerminalKeyActionId,
} from "../../../features/terminal-surface";
import { findMatchingKeybinding, useSessionPreferences } from "../../../features/settings";
import type { KeyChord } from "../../../shared/keyboard";

export function RuntimeTerminalSurfacePortsProvider({ children }: { children: ReactNode }) {
  const terminalRuntime = useTerminalRuntime();
  const { tmuxControllerErrors, dismissTmuxControllerError } = useTmuxRuntime();
  const { keybindings } = useSessionPreferences();
  const terminalsRef = useRef(terminalRuntime.terminals);

  useEffect(() => {
    terminalsRef.current = terminalRuntime.terminals;
  }, [terminalRuntime.terminals]);

  const isTmuxTerminal = useCallback((terminalId: number) => {
    return terminalsRef.current.some(
      (terminal) => terminal.id === terminalId && isTmuxPaneTerminal(terminal),
    );
  }, []);

  const shouldBlockAppChord = useCallback(
    (chord: KeyChord) => findMatchingKeybinding(keybindings, chord, "app") !== undefined,
    [keybindings],
  );

  const resolveTerminalAction = useCallback(
    (chord: KeyChord): TerminalKeyActionId | undefined => {
      const binding = findMatchingKeybinding(keybindings, chord, "terminal");
      return binding ? (binding.actionId as TerminalKeyActionId) : undefined;
    },
    [keybindings],
  );

  const ports = useMemo<TerminalSurfacePorts>(
    () => ({
      session: {
        getEffectiveLocalEcho: terminalRuntime.getEffectiveLocalEcho,
        reconnect: terminalRuntime.reconnectSession,
        resize: terminalRuntime.resizeTerminal,
        reportSize: terminalRuntime.reportTerminalSize,
        uploadImage: terminalRuntime.uploadImageToSshTerminal,
        write: terminalRuntime.writeTerminal,
        isTmuxTerminal,
        touchActivity: terminalRuntime.touchTerminalActivity,
        toggleBookmark: terminalRuntime.toggleBookmark,
      },
      stream: {
        subscribeOutput: terminalStreamActions.subscribeOutput,
        writeBytes: terminalStreamActions.writeBytes,
      },
      clipboard: terminalClipboard,
      tmux: {
        capturePane: tmuxControllerActions.capturePane,
        getControllerError: (controllerId) => tmuxControllerErrors.get(controllerId),
        retryController: async (controllerId) => {
          const error = tmuxControllerErrors.get(controllerId);
          if (!error) return;
          await tmuxControllerActions.attachSession(error.config);
        },
        dismissControllerError: dismissTmuxControllerError,
      },
      keyboard: {
        shouldBlockAppChord,
        resolveTerminalAction,
      },
    }),
    [
      dismissTmuxControllerError,
      terminalRuntime.getEffectiveLocalEcho,
      terminalRuntime.reconnectSession,
      terminalRuntime.reportTerminalSize,
      terminalRuntime.resizeTerminal,
      terminalRuntime.toggleBookmark,
      terminalRuntime.touchTerminalActivity,
      terminalRuntime.uploadImageToSshTerminal,
      terminalRuntime.writeTerminal,
      isTmuxTerminal,
      tmuxControllerErrors,
      shouldBlockAppChord,
      resolveTerminalAction,
    ],
  );

  return <TerminalSurfacePortsProvider ports={ports}>{children}</TerminalSurfacePortsProvider>;
}
