import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Terminal } from "../../../features/terminal";
import type { TmuxSessionConfig } from "../../../features/launch-config";
import type { Workspace } from "../../../features/workspace";
import {
  appendOrReplaceInitWindow,
  closeWindow,
  removeControllerFromWorkspaces,
  removeSessionsFromWorkspaces,
  renameWindow,
} from "../../../features/workspace";
import { tmuxEventStream } from "../../../features/tmux";
import { type TmuxControllerError } from "../../../features/tmux";
import {
  buildTmuxPaneSession,
  buildTmuxWindow,
  findControllerWorkspaceId,
  mergeTmuxPaneMetadata,
  type TmuxPaneGeometry,
} from "./tmuxEventTransitions";

interface TmuxEventBridgeOptions {
  setTerminals: Dispatch<SetStateAction<Terminal[]>>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  terminalsRef: MutableRefObject<Terminal[]>;
  workspacesRef: MutableRefObject<Workspace[]>;
  establishingSessionsRef: MutableRefObject<Set<number>>;
  setTmuxControllerErrors: Dispatch<SetStateAction<Map<number, TmuxControllerError>>>;
  tmuxControllerConfigsRef: MutableRefObject<Map<number, TmuxSessionConfig>>;
  tmuxControllerConfigIdsRef: MutableRefObject<Map<number, string>>;
  syncOpenTmuxSessions: () => void;
  tmuxControllersClosingRef: MutableRefObject<Set<number>>;
}

export function useTmuxEventBridge({
  setTerminals,
  setWorkspaces,
  terminalsRef,
  workspacesRef,
  establishingSessionsRef,
  setTmuxControllerErrors,
  tmuxControllerConfigsRef,
  tmuxControllerConfigIdsRef,
  syncOpenTmuxSessions,
  tmuxControllersClosingRef,
}: TmuxEventBridgeOptions): void {
  useEffect(() => {
    let isDisposed = false;
    let cleanup: (() => void) | undefined;

    const subscribe = async () => {
      try {
        const unsubscribe = await tmuxEventStream.subscribe({
          onControllerExited: ({ controllerHandle, reason }) => {
            const controllerId = Number(controllerHandle);
            const deadTerminals = terminalsRef.current.filter(
              (terminal) => terminal.tmux?.controllerId === controllerId,
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
                establishingSessionsRef.current.delete(terminalId);
              }
              setTerminals((terminals) =>
                terminals.filter((terminal) => !deadIds.has(terminal.id)),
              );
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
            const terminalId = Number(terminalHandle);
            const controllerId = Number(controllerHandle);
            const existing = terminalsRef.current.find((terminal) => terminal.id === terminalId);

            if (existing) {
              setTerminals((terminals) =>
                terminals.map((terminal) =>
                  terminal.id === terminalId
                    ? {
                        ...mergeTmuxPaneMetadata(terminal, {
                          tmuxWindowId: parentTmuxWindowId,
                          tmuxSessionName: sessionName,
                          tmuxWindowName: windowName,
                          tmuxWindowIndex: windowIndex,
                          tmuxPaneIndex: paneIndex,
                          tmuxPaneWidth: width,
                          tmuxPaneHeight: height,
                          tmuxPaneCommand: currentCommand,
                          tmuxPaneActive: isActive,
                        }),
                        tmux: {
                          controllerId,
                          paneId: tmuxPaneId,
                          ...(parentTmuxWindowId ? { windowId: parentTmuxWindowId } : {}),
                          ...(sessionName ? { sessionName } : {}),
                          ...(windowName ? { windowName } : {}),
                          ...(windowIndex !== undefined ? { windowIndex } : {}),
                          ...(paneIndex !== undefined ? { paneIndex } : {}),
                          ...(width !== undefined ? { width } : {}),
                          ...(height !== undefined ? { height } : {}),
                          ...(currentCommand ? { command: currentCommand } : {}),
                          ...(isActive !== undefined ? { isActive } : {}),
                        },
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
            setTerminals((terminals) =>
              terminals.some((candidate) => candidate.id === terminalId)
                ? terminals
                : [...terminals, terminal],
            );
          },
          onPaneRemoved: ({ terminalHandle }) => {
            const terminalId = Number(terminalHandle);
            establishingSessionsRef.current.delete(terminalId);
            if (!terminalsRef.current.some((terminal) => terminal.id === terminalId)) return;
            setTerminals((terminals) => terminals.filter((terminal) => terminal.id !== terminalId));
            setWorkspaces((workspaces) => removeSessionsFromWorkspaces(workspaces, [terminalId]));
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
              const existing = terminalsRef.current.find((terminal) => terminal.id === terminalId);

              if (existing) {
                setTerminals((terminals) =>
                  terminals.map((terminal) =>
                    terminal.id === terminalId
                      ? mergeTmuxPaneMetadata(terminal, {
                          tmuxWindowId,
                          tmuxSessionName: sessionName,
                          tmuxWindowName: pane.windowName,
                          tmuxWindowIndex: pane.windowIndex,
                          tmuxPaneIndex: pane.paneIndex,
                          tmuxPaneWidth: pane.width,
                          tmuxPaneHeight: pane.height,
                          tmuxPaneCommand: pane.currentCommand,
                          tmuxPaneActive: pane.isActive,
                        })
                      : terminal,
                  ),
                );
              } else {
                const terminal = buildTmuxPaneSession({
                  id: terminalId,
                  name: `tmux-${controllerId}:${pane.tmuxPaneId}`,
                  tmuxPaneId: pane.tmuxPaneId,
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
                setTerminals((terminals) =>
                  terminals.some((candidate) => candidate.id === terminalId)
                    ? terminals
                    : [...terminals, terminal],
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

            const targetWorkspaceId =
              findControllerWorkspaceId(
                workspacesRef.current,
                terminalsRef.current,
                controllerId,
              ) ?? workspacesRef.current[0]?.id;
            if (!targetWorkspaceId) return;

            const windowName = name || `Window ${tmuxWindowId}`;

            setWorkspaces((workspaces) =>
              workspaces.map((workspace) => {
                if (workspace.id !== targetWorkspaceId) return workspace;
                return appendOrReplaceInitWindow(
                  workspace,
                  buildTmuxWindow({
                    layout,
                    panes: paneGeometries,
                    configId,
                    name: windowName,
                    xstermWindowId,
                  }),
                );
              }),
            );
          },
          onWindowClosed: ({ backendWindowHandle, tmuxWindowId }) => {
            const xstermWindowId = Number(backendWindowHandle);
            const deadIds = terminalsRef.current
              .filter((terminal) => terminal.tmux?.windowId === tmuxWindowId)
              .map((terminal) => terminal.id);

            if (deadIds.length > 0) {
              for (const terminalId of deadIds) {
                establishingSessionsRef.current.delete(terminalId);
              }
              setTerminals((terminals) =>
                terminals.filter((terminal) => !deadIds.includes(terminal.id)),
              );
            }
            setWorkspaces((workspaces) => closeWindow(workspaces, xstermWindowId));
          },
          onWindowRenamed: ({ backendWindowHandle, name }) => {
            setWorkspaces((workspaces) =>
              renameWindow(workspaces, Number(backendWindowHandle), name),
            );
          },
          onLayoutChanged: ({ controllerHandle, tmuxWindowId, sessionName, panes }) => {
            const controllerId = Number(controllerHandle);
            const panesByTerminalId = new Map(
              panes.map((pane) => [Number(pane.terminalHandle), pane]),
            );
            setTerminals((terminals) =>
              terminals.map((terminal) => {
                if (terminal.tmux?.controllerId !== controllerId) return terminal;
                const pane = panesByTerminalId.get(terminal.id);
                if (!pane) return terminal;
                return {
                  ...terminal,
                  tmux: {
                    ...terminal.tmux,
                    paneId: pane.tmuxPaneId,
                    windowId: tmuxWindowId,
                    sessionName: sessionName ?? terminal.tmux.sessionName,
                    windowName: pane.windowName ?? terminal.tmux.windowName,
                    windowIndex: pane.windowIndex,
                    paneIndex: pane.paneIndex,
                    width: pane.width,
                    height: pane.height,
                    command: pane.currentCommand ?? terminal.tmux.command,
                    isActive: pane.isActive ?? terminal.tmux.isActive,
                  },
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

        if (isDisposed) {
          unsubscribe();
        } else {
          cleanup = unsubscribe;
        }
      } catch (error) {
        console.error("Failed to subscribe to tmux events:", error);
      }
    };

    void subscribe();
    return () => {
      isDisposed = true;
      cleanup?.();
    };
  }, [
    establishingSessionsRef,
    setTerminals,
    setTmuxControllerErrors,
    setWorkspaces,
    syncOpenTmuxSessions,
    terminalsRef,
    tmuxControllerConfigIdsRef,
    tmuxControllerConfigsRef,
    tmuxControllersClosingRef,
    workspacesRef,
  ]);
}
