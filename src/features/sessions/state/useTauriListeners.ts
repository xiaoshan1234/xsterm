import { useEffect } from "react";
import { type Terminal } from "../../../models/legacy/terminal";
import { subscribeTerminalEvents } from "../../terminal/infrastructure";
import { subscribeTmuxEvents } from "../../tmux/infrastructure";
import { createLeafPane, withRecomputedSessionIds } from "./paneUtils";
import { closeWindow, removeSessionsFromWorkspaces, renameWindow } from "./eventTransitions";
import { TMUX_PANE_CAPABILITIES } from "./capabilities";
import { type TerminalState } from "./types";

function buildTmuxPaneSession(info: {
  id: number;
  name: string;
  tmuxPaneId: string;
  tmuxSessionId: number;
  configId?: string;
}): Terminal {
  return {
    id: info.id,
    configId: info.configId ?? "",
    name: info.name,
    type: "tmux-pane",
    isConnected: true,
    kind: {
      type: "tmux-pane",
      sessionId: info.tmuxSessionId,
      paneId: info.tmuxPaneId,
    },
    tmuxPaneId: info.tmuxPaneId,
    tmuxSessionId: info.tmuxSessionId,
    isHidden: false,
    capabilities: TMUX_PANE_CAPABILITIES,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
}

type ListenersState = Pick<
  TerminalState,
  | "setSessions"
  | "setWorkspaces"
  | "terminalsRef"
  | "workspacesRef"
  | "establishingSessionsRef"
  | "setTmuxControllerErrors"
  | "tmuxControllerConfigsRef"
  | "tmuxControllerConfigIdsRef"
>;

export function useTauriListeners({
  setSessions,
  setWorkspaces,
  terminalsRef,
  workspacesRef,
  establishingSessionsRef,
  setTmuxControllerErrors,
  tmuxControllerConfigsRef,
  tmuxControllerConfigIdsRef,
}: ListenersState): void {
  useEffect(() => {
    let disposed = false;
    let cleanupTerminal: (() => void) | undefined;
    let cleanupTmux: (() => void) | undefined;

    const subscribe = async () => {
      try {
        const cleanup = await subscribeTerminalEvents({
          onDisconnected: ({ terminalHandle }) => {
            const terminalId = Number(terminalHandle);
            establishingSessionsRef.current.delete(terminalId);
            setSessions((prev) =>
              prev.map((terminal) =>
                terminal.id === terminalId ? { ...terminal, isConnected: false } : terminal,
              ),
            );
          },
          onClosed: ({ terminalHandle }) => {
            const terminalId = Number(terminalHandle);
            establishingSessionsRef.current.delete(terminalId);
            if (!terminalsRef.current.some((terminal) => terminal.id === terminalId)) return;
            setSessions((prev) => prev.filter((terminal) => terminal.id !== terminalId));
            setWorkspaces((prev) => removeSessionsFromWorkspaces(prev, [terminalId]));
          },
        });
        if (disposed) cleanup();
        else cleanupTerminal = cleanup;
      } catch (error) {
        console.error("Failed to subscribe to terminal events:", error);
      }

      try {
        const cleanup = await subscribeTmuxEvents({
          onControllerExited: ({ controllerHandle, reason }) => {
            const controllerId = Number(controllerHandle);
            const deadTerminals = terminalsRef.current.filter(
              (terminal) => terminal.tmuxSessionId === controllerId,
            );
            const storedConfig = tmuxControllerConfigsRef.current.get(controllerId);

            if (deadTerminals.length > 0) {
              const deadIds = new Set(deadTerminals.map((terminal) => terminal.id));
              console.warn(
                `[xsterm] tmux-controller-exit controllerId=${controllerId} reason=${reason ?? "(none)"} dropping ${deadTerminals.length} terminal(s)`,
              );
              for (const terminalId of deadIds) {
                establishingSessionsRef.current.delete(terminalId);
              }
              setSessions((prev) => prev.filter((terminal) => !deadIds.has(terminal.id)));
              setWorkspaces((prev) => removeSessionsFromWorkspaces(prev, deadIds));
            }

            if (!storedConfig) return;
            setTmuxControllerErrors((prev) => {
              const next = new Map(prev);
              next.set(controllerId, {
                config: storedConfig,
                reason,
                timestamp: Date.now(),
              });
              return next;
            });
            tmuxControllerConfigsRef.current.delete(controllerId);
          },
          onPanePaused: ({ tmuxPaneId }) => {
            console.debug("[xsterm] tmux-paused", { tmuxPaneId });
          },
          onPaneContinued: ({ tmuxPaneId }) => {
            console.debug("[xsterm] tmux-continued", { tmuxPaneId });
          },
          onPaneAdded: ({ terminalHandle, controllerHandle, tmuxPaneId }) => {
            const terminalId = Number(terminalHandle);
            const controllerId = Number(controllerHandle);
            if (terminalsRef.current.some((terminal) => terminal.id === terminalId)) return;

            const terminal = buildTmuxPaneSession({
              id: terminalId,
              name: `tmux-${controllerId}:${tmuxPaneId}`,
              tmuxPaneId,
              tmuxSessionId: controllerId,
              configId: tmuxControllerConfigIdsRef.current.get(controllerId),
            });
            setSessions((prev) => {
              if (prev.some((candidate) => candidate.id === terminalId)) return prev;
              return [...prev, terminal];
            });
          },
          onPaneRemoved: ({ terminalHandle }) => {
            const terminalId = Number(terminalHandle);
            establishingSessionsRef.current.delete(terminalId);
            if (!terminalsRef.current.some((terminal) => terminal.id === terminalId)) return;
            setSessions((prev) => prev.filter((terminal) => terminal.id !== terminalId));
            setWorkspaces((prev) => removeSessionsFromWorkspaces(prev, [terminalId]));
          },
          onWindowAdded: ({
            controllerHandle,
            terminalHandle,
            backendWindowHandle,
            tmuxPaneId,
            tmuxWindowId,
            name,
          }) => {
            const controllerId = Number(controllerHandle);
            const terminalId = Number(terminalHandle);
            const xstermWindowId = Number(backendWindowHandle);

            if (!terminalsRef.current.some((terminal) => terminal.id === terminalId)) {
              const terminal = buildTmuxPaneSession({
                id: terminalId,
                name: `tmux-${controllerId}:${tmuxPaneId}`,
                tmuxPaneId,
                tmuxSessionId: controllerId,
                configId: tmuxControllerConfigIdsRef.current.get(controllerId),
              });
              terminal.tmuxWindowId = tmuxWindowId;
              setSessions((prev) =>
                prev.some((candidate) => candidate.id === terminalId) ? prev : [...prev, terminal],
              );
            } else {
              setSessions((prev) =>
                prev.map((terminal) =>
                  terminal.id === terminalId ? { ...terminal, tmuxWindowId } : terminal,
                ),
              );
            }

            const targetWorkspaceId = (() => {
              const withController = workspacesRef.current.find((workspace) =>
                workspace.windows.some(
                  (window) =>
                    window.rootPane.terminalId !== undefined &&
                    terminalsRef.current.some(
                      (terminal) =>
                        terminal.id === window.rootPane.terminalId &&
                        terminal.tmuxSessionId === controllerId,
                    ),
                ),
              );
              if (withController) return withController.id;
              return workspacesRef.current[0]?.id ?? null;
            })();
            if (!targetWorkspaceId) return;

            const rootPane = createLeafPane(100, terminalId, "");
            const windowName = name || `Window ${tmuxPaneId}`;
            setWorkspaces((prev) =>
              prev.map((workspace) => {
                if (workspace.id !== targetWorkspaceId) return workspace;
                const newWindow = {
                  id: crypto.randomUUID(),
                  name: windowName,
                  rootPane,
                  activePaneId: rootPane.id,
                  windowType: "terminal" as const,
                  xstermWindowId,
                };
                return withRecomputedSessionIds({
                  ...workspace,
                  windows: [...workspace.windows, newWindow],
                  activeWindowId: newWindow.id,
                });
              }),
            );
          },
          onWindowClosed: ({ backendWindowHandle, tmuxWindowId }) => {
            const xstermWindowId = Number(backendWindowHandle);
            const deadIds = terminalsRef.current
              .filter((terminal) => terminal.tmuxWindowId === tmuxWindowId)
              .map((terminal) => terminal.id);

            if (deadIds.length > 0) {
              for (const terminalId of deadIds) {
                establishingSessionsRef.current.delete(terminalId);
              }
              setSessions((prev) => prev.filter((terminal) => !deadIds.includes(terminal.id)));
            }
            setWorkspaces((prev) => closeWindow(prev, xstermWindowId));
          },
          onWindowRenamed: ({ backendWindowHandle, name }) => {
            setWorkspaces((prev) => renameWindow(prev, Number(backendWindowHandle), name));
          },
        });
        if (disposed) cleanup();
        else cleanupTmux = cleanup;
      } catch (error) {
        console.error("Failed to subscribe to tmux events:", error);
      }
    };

    void subscribe();

    return () => {
      disposed = true;
      cleanupTerminal?.();
      cleanupTmux?.();
    };
  }, [
    setSessions,
    setWorkspaces,
    terminalsRef,
    workspacesRef,
    establishingSessionsRef,
    setTmuxControllerErrors,
    tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef,
  ]);
}
