import { useMemo, type ReactNode } from "react";
import {
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

  const ports = useMemo<TerminalSurfacePorts>(
    () => ({
      session: {
        getEffectiveLocalEcho: terminalRuntime.getEffectiveLocalEcho,
        reconnect: terminalRuntime.reconnectSession,
        resize: terminalRuntime.resizeTerminal,
        reportSize: terminalRuntime.reportTerminalSize,
        uploadImage: terminalRuntime.uploadImageToSshTerminal,
        write: terminalRuntime.writeTerminal,
        isTmuxTerminal: (terminalId) =>
          terminalRuntime.terminals.some(
            (terminal) => terminal.id === terminalId && terminal.tmux !== undefined,
          ),
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
      terminalRuntime.terminals,
      terminalRuntime.touchTerminalActivity,
      terminalRuntime.uploadImageToSshTerminal,
      terminalRuntime.writeTerminal,
      tmuxControllerErrors,
    ],
  );

  return <TerminalSurfacePortsProvider ports={ports}>{children}</TerminalSurfacePortsProvider>;
}
