import { useEffect } from "react";
import { type Terminal } from "../../../models/legacy/terminal";
import { subscribeTerminalEvents } from "../../terminal/infrastructure";
import { subscribeTmuxEvents } from "../../tmux/infrastructure";
import { createLeafPane, forEachPane, getLeafPaneIds, withRecomputedSessionIds } from "./paneUtils";
import { closeWindow, removeSessionsFromWorkspaces, renameWindow } from "./eventTransitions";
import { TMUX_PANE_CAPABILITIES } from "./capabilities";
import { buildTmuxPaneTree, type TmuxPaneGeometry } from "./tmuxPaneTree";
import { type TerminalState } from "./types";

function buildTmuxPaneSession(info: {
  id: number;
  name: string;
  tmuxPaneId: string;
  tmuxSessionId: number;
  configId?: string;
  tmuxWindowId?: string;
  tmuxSessionName?: string;
  tmuxWindowName?: string;
  tmuxWindowIndex?: number;
  tmuxPaneIndex?: number;
  tmuxPaneWidth?: number;
  tmuxPaneHeight?: number;
  tmuxPaneCommand?: string;
  tmuxPaneActive?: boolean;
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
    ...(info.tmuxWindowId ? { tmuxWindowId: info.tmuxWindowId } : {}),
    ...(info.tmuxSessionName ? { tmuxSessionName: info.tmuxSessionName } : {}),
    ...(info.tmuxWindowName ? { tmuxWindowName: info.tmuxWindowName } : {}),
    ...(info.tmuxWindowIndex !== undefined ? { tmuxWindowIndex: info.tmuxWindowIndex } : {}),
    ...(info.tmuxPaneIndex !== undefined ? { tmuxPaneIndex: info.tmuxPaneIndex } : {}),
    ...(info.tmuxPaneWidth !== undefined ? { tmuxPaneWidth: info.tmuxPaneWidth } : {}),
    ...(info.tmuxPaneHeight !== undefined ? { tmuxPaneHeight: info.tmuxPaneHeight } : {}),
    ...(info.tmuxPaneCommand ? { tmuxPaneCommand: info.tmuxPaneCommand } : {}),
    ...(info.tmuxPaneActive !== undefined ? { tmuxPaneActive: info.tmuxPaneActive } : {}),
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
  | "tmuxControllersClosingRef"
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
  tmuxControllersClosingRef,
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
            const isIntentionalClose = tmuxControllersClosingRef.current.has(controllerId);
            if (isIntentionalClose) {
              tmuxControllersClosingRef.current.delete(controllerId);
              tmuxControllerConfigsRef.current.delete(controllerId);
              tmuxControllerConfigIdsRef.current.delete(controllerId);
            }

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

            if (isIntentionalClose || !storedConfig) return;
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
            const terminalId = Number(terminalHandle);
            const controllerId = Number(controllerHandle);
            const existing = terminalsRef.current.find((terminal) => terminal.id === terminalId);
            if (existing) {
              setSessions((prev) =>
                prev.map((terminal) =>
                  terminal.id === terminalId
                    ? {
                        ...terminal,
                        tmuxPaneId,
                        tmuxWindowId: parentTmuxWindowId,
                        tmuxSessionName: sessionName ?? terminal.tmuxSessionName,
                        tmuxWindowName: windowName ?? terminal.tmuxWindowName,
                        tmuxWindowIndex: windowIndex,
                        tmuxPaneIndex: paneIndex,
                        tmuxPaneWidth: width,
                        tmuxPaneHeight: height,
                        tmuxPaneCommand: currentCommand ?? terminal.tmuxPaneCommand,
                        tmuxPaneActive: isActive ?? terminal.tmuxPaneActive,
                        kind: {
                          type: "tmux-pane",
                          sessionId: controllerId,
                          paneId: tmuxPaneId,
                        },
                      }
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
            backendWindowHandle,
            tmuxWindowId,
            name,
            sessionName,
            panes,
            layout,
          }) => {
            const controllerId = Number(controllerHandle);
            const xstermWindowId = Number(backendWindowHandle);
            const configId = tmuxControllerConfigIdsRef.current.get(controllerId) ?? "";

            const paneGeometries: TmuxPaneGeometry[] = panes.map((pane) => {
              const terminalId = Number(pane.terminalHandle);
              const tmuxPaneId = pane.tmuxPaneId;
              if (!terminalsRef.current.some((terminal) => terminal.id === terminalId)) {
                const terminal = buildTmuxPaneSession({
                  id: terminalId,
                  name: `tmux-${controllerId}:${tmuxPaneId}`,
                  tmuxPaneId,
                  tmuxSessionId: controllerId,
                  configId,
                  tmuxWindowId,
                  tmuxSessionName: sessionName,
                  tmuxWindowName: pane.windowName,
                  tmuxWindowIndex: pane.windowIndex,
                  tmuxPaneIndex: pane.paneIndex,
                  tmuxPaneWidth: pane.width,
                  tmuxPaneHeight: pane.height,
                  tmuxPaneCommand: pane.currentCommand,
                  tmuxPaneActive: pane.isActive,
                });
                setSessions((prev) =>
                  prev.some((candidate) => candidate.id === terminalId)
                    ? prev
                    : [...prev, terminal],
                );
              } else {
                setSessions((prev) =>
                  prev.map((terminal) =>
                    terminal.id === terminalId
                      ? {
                          ...terminal,
                          tmuxWindowId,
                          tmuxSessionName: sessionName ?? terminal.tmuxSessionName,
                          tmuxWindowName: pane.windowName ?? terminal.tmuxWindowName,
                          tmuxWindowIndex: pane.windowIndex,
                          tmuxPaneIndex: pane.paneIndex,
                          tmuxPaneWidth: pane.width,
                          tmuxPaneHeight: pane.height,
                          tmuxPaneCommand: pane.currentCommand ?? terminal.tmuxPaneCommand,
                          tmuxPaneActive: pane.isActive ?? terminal.tmuxPaneActive,
                        }
                      : terminal,
                  ),
                );
              }
              return {
                terminalId,
                width: pane.width,
                height: pane.height,
                x: pane.x,
                y: pane.y,
              };
            });

            const targetWorkspaceId = (() => {
              const withController = workspacesRef.current.find((workspace) =>
                workspace.windows.some((window) => {
                  let belongsToController = false;
                  forEachPane(window.rootPane, (node) => {
                    if (node.type !== "leaf" || node.terminalId === undefined) return;
                    const terminal = terminalsRef.current.find(
                      (candidate) => candidate.id === node.terminalId,
                    );
                    if (terminal?.tmuxSessionId === controllerId) {
                      belongsToController = true;
                    }
                  });
                  return belongsToController;
                }),
              );
              if (withController) return withController.id;
              return workspacesRef.current[0]?.id ?? null;
            })();
            if (!targetWorkspaceId) return;

            const rootPane =
              buildTmuxPaneTree(layout, paneGeometries, configId) ??
              createLeafPane(100, paneGeometries[0]?.terminalId, "");
            const leafIds = getLeafPaneIds(rootPane);
            const windowName = name || `Window ${tmuxWindowId}`;
            setWorkspaces((prev) =>
              prev.map((workspace) => {
                if (workspace.id !== targetWorkspaceId) return workspace;
                const newWindow = {
                  id: crypto.randomUUID(),
                  name: windowName,
                  rootPane,
                  activePaneId: leafIds[0] ?? null,
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
          onLayoutChanged: ({ controllerHandle, tmuxWindowId, sessionName, panes }) => {
            const controllerId = Number(controllerHandle);
            const panesByTerminalId = new Map(
              panes.map((pane) => [Number(pane.terminalHandle), pane]),
            );
            setSessions((prev) =>
              prev.map((terminal) => {
                if (terminal.tmuxSessionId !== controllerId) return terminal;
                const pane = panesByTerminalId.get(terminal.id);
                if (!pane) return terminal;
                return {
                  ...terminal,
                  tmuxPaneId: pane.tmuxPaneId,
                  tmuxWindowId,
                  tmuxSessionName: sessionName ?? terminal.tmuxSessionName,
                  tmuxWindowName: pane.windowName ?? terminal.tmuxWindowName,
                  tmuxWindowIndex: pane.windowIndex,
                  tmuxPaneIndex: pane.paneIndex,
                  tmuxPaneWidth: pane.width,
                  tmuxPaneHeight: pane.height,
                  tmuxPaneCommand: pane.currentCommand ?? terminal.tmuxPaneCommand,
                  tmuxPaneActive: pane.isActive ?? terminal.tmuxPaneActive,
                  ...(terminal.kind.type === "tmux-pane"
                    ? {
                        kind: {
                          type: "tmux-pane" as const,
                          sessionId: terminal.kind.sessionId,
                          paneId: pane.tmuxPaneId,
                        },
                      }
                    : {}),
                };
              }),
            );
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
    tmuxControllersClosingRef,
  ]);
}
