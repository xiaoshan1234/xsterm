import { createTerminalId } from "../../../models";
import { isTmuxPaneTerminal } from "../../../features/terminal";
import { removeControllerFromWorkspaces } from "../../../features/workspace";
import { buildTmuxPaneSession, mergeTmuxPaneMetadata } from "./tmuxEventTransitions";
import type { TmuxEventBridgePorts, TmuxEventHandlerSet } from "./tmuxEventBridgePorts";
import { removeSessionsFromWorkspaces } from "../../../features/workspace";

export function createTmuxControllerEventHandlers({
  establishingTerminalsRef,
  setTerminals,
  setTmuxControllerErrors,
  setWorkspaces,
  syncOpenTmuxSessions,
  terminalsRef,
  tmuxControllerConfigIdsRef,
  tmuxControllerConfigsRef,
  tmuxControllersClosingRef,
}: TmuxEventBridgePorts): TmuxEventHandlerSet {
  return {
    onControllerExited: ({ controllerHandle, reason }) => {
      const controllerId = Number(controllerHandle);
      const deadTerminals = terminalsRef.current.filter(
        (terminal) => isTmuxPaneTerminal(terminal) && terminal.tmux.controllerId === controllerId,
      );
      const storedConfig = tmuxControllerConfigsRef.current.get(controllerId);
      const isIntentionalClose = tmuxControllersClosingRef.current.has(controllerId);

      if (isIntentionalClose) {
        tmuxControllersClosingRef.current.delete(controllerId);
        tmuxControllerConfigsRef.current.delete(controllerId);
        tmuxControllerConfigIdsRef.current.delete(controllerId);
        syncOpenTmuxSessions();
      }

      if (deadTerminals.length > 0) {
        const deadIds = new Set(deadTerminals.map((terminal) => terminal.id));
        console.warn(
          `[xsterm] tmux-controller-exit controllerId=${controllerId} reason=${reason ?? "(none)"} dropping ${deadTerminals.length} terminal(s)`,
        );
        for (const terminalId of deadIds) {
          establishingTerminalsRef.current.delete(terminalId);
        }
        setTerminals((terminals) => terminals.filter((terminal) => !deadIds.has(terminal.id)));
        setWorkspaces((workspaces) => removeControllerFromWorkspaces(workspaces, deadIds));
      }

      if (isIntentionalClose || !storedConfig) return;
      setTmuxControllerErrors((errors) => {
        const next = new Map(errors);
        next.set(controllerId, {
          config: storedConfig,
          reason,
          timestamp: Date.now(),
        });
        return next;
      });
      tmuxControllerConfigsRef.current.delete(controllerId);
      syncOpenTmuxSessions();
    },

    onPanePaused: ({ tmuxPaneId }) => {
      console.debug("[xsterm] tmux-paused", { tmuxPaneId });
    },

    onPaneContinued: ({ tmuxPaneId }) => {
      console.debug("[xsterm] tmux-continued", { tmuxPaneId });
    },

    onPaneAdded: ({
      terminalHandle,
      controllerHandle,
      tmuxPaneId,
      parentTmuxWindowId,
      sessionName,
      windowIndex,
      paneIndex,
      width,
      height,
      currentCommand,
      isActive,
      windowName,
    }) => {
      const terminalId = createTerminalId(Number(terminalHandle));
      const controllerId = Number(controllerHandle);
      const existing = terminalsRef.current.find((terminal) => terminal.id === terminalId);

      if (existing) {
        setTerminals((terminals) =>
          terminals.map((terminal) =>
            terminal.id === terminalId && isTmuxPaneTerminal(terminal)
              ? mergeTmuxPaneMetadata(terminal, {
                  controllerId,
                  paneId: tmuxPaneId,
                  tmuxWindowId: parentTmuxWindowId,
                  tmuxSessionName: sessionName,
                  tmuxWindowName: windowName,
                  tmuxWindowIndex: windowIndex,
                  tmuxPaneIndex: paneIndex,
                  tmuxPaneWidth: width,
                  tmuxPaneHeight: height,
                  tmuxPaneCommand: currentCommand,
                  tmuxPaneActive: isActive,
                })
              : terminal,
          ),
        );
        return;
      }

      const terminal = buildTmuxPaneSession({
        id: terminalId,
        name: `tmux-${controllerId}:${tmuxPaneId}`,
        tmuxPaneId,
        tmuxSessionId: controllerId,
        configId: tmuxControllerConfigIdsRef.current.get(controllerId),
        tmuxWindowId: parentTmuxWindowId,
        tmuxSessionName: sessionName,
        tmuxWindowName: windowName,
        tmuxWindowIndex: windowIndex,
        tmuxPaneIndex: paneIndex,
        tmuxPaneWidth: width,
        tmuxPaneHeight: height,
        tmuxPaneCommand: currentCommand,
        tmuxPaneActive: isActive,
      });
      setTerminals((terminals) =>
        terminals.some((candidate) => candidate.id === terminalId)
          ? terminals
          : [...terminals, terminal],
      );
    },

    onPaneRemoved: ({ terminalHandle }) => {
      const terminalId = createTerminalId(Number(terminalHandle));
      establishingTerminalsRef.current.delete(terminalId);
      if (!terminalsRef.current.some((terminal) => terminal.id === terminalId)) return;
      setTerminals((terminals) => terminals.filter((terminal) => terminal.id !== terminalId));
      setWorkspaces((workspaces) => removeSessionsFromWorkspaces(workspaces, [terminalId]));
    },
  };
}
