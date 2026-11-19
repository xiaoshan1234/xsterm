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
} from "../../../features/terminal-surface";

export function RuntimeTerminalSurfacePortsProvider({ children }: { children: ReactNode }) {
  const terminalRuntime = useTerminalRuntime();
  const { tmuxControllerErrors, dismissTmuxControllerError } = useTmuxRuntime();
  const terminalsRef = useRef(terminalRuntime.terminals);

  useEffect(() => {
    terminalsRef.current = terminalRuntime.terminals;
  }, [terminalRuntime.terminals]);

  const isTmuxTerminal = useCallback((terminalId: number) => {
    return terminalsRef.current.some(
      (terminal) => terminal.id === terminalId && isTmuxPaneTerminal(terminal),
    );
  }, []);

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
    }),
    [
      dismissTmuxControllerError,
      terminalRuntime.getEffectiveLocalEcho,
      terminalRuntime.reconnectSession,
      terminalRuntime.reportTerminalSize,
      terminalRuntime.resizeTerminal,
      terminalRuntime.touchTerminalActivity,
      terminalRuntime.uploadImageToSshTerminal,
      terminalRuntime.writeTerminal,
      isTmuxTerminal,
      tmuxControllerErrors,
    ],
  );

  return <TerminalSurfacePortsProvider ports={ports}>{children}</TerminalSurfacePortsProvider>;
}
