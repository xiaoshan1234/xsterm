import { createTerminalId } from "../../../models";
import { isTmuxPaneTerminal } from "../../../features/terminal";
import { appendOrReplaceInitWindow, closeWindow, renameWindow } from "../../../features/workspace";
import {
  buildTmuxPaneSession,
  buildTmuxWindow,
  findControllerWorkspaceId,
  mergeTmuxPaneMetadata,
} from "./tmuxEventTransitions";
import type { TmuxPaneGeometry } from "./tmuxWorkspacePaneTree";
import type { TmuxEventBridgePorts, TmuxEventHandlerSet } from "./tmuxEventBridgePorts";

export function createTmuxWindowEventHandlers({
  establishingSessionsRef,
  setTerminals,
  setWorkspaces,
  terminalsRef,
  tmuxControllerConfigIdsRef,
  workspacesRef,
}: TmuxEventBridgePorts): TmuxEventHandlerSet {
  return {
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
        const terminalId = createTerminalId(Number(pane.terminalHandle));
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
        findControllerWorkspaceId(workspacesRef.current, terminalsRef.current, controllerId) ??
        workspacesRef.current[0]?.id;
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
        .filter(
          (terminal) => isTmuxPaneTerminal(terminal) && terminal.tmux.windowId === tmuxWindowId,
        )
        .map((terminal) => terminal.id);

      if (deadIds.length > 0) {
        for (const terminalId of deadIds) {
          establishingSessionsRef.current.delete(terminalId);
        }
        setTerminals((terminals) => terminals.filter((terminal) => !deadIds.includes(terminal.id)));
      }
      setWorkspaces((workspaces) => closeWindow(workspaces, xstermWindowId));
    },

    onWindowRenamed: ({ backendWindowHandle, name }) => {
      setWorkspaces((workspaces) => renameWindow(workspaces, Number(backendWindowHandle), name));
    },

    onLayoutChanged: ({ controllerHandle, tmuxWindowId, sessionName, panes }) => {
      const controllerId = Number(controllerHandle);
      const panesByTerminalId = new Map(
        panes.map((pane) => [createTerminalId(Number(pane.terminalHandle)), pane]),
      );
      setTerminals((terminals) =>
        terminals.map((terminal) => {
          if (!isTmuxPaneTerminal(terminal) || terminal.tmux.controllerId !== controllerId) {
            return terminal;
          }
          const pane = panesByTerminalId.get(terminal.id);
          if (!pane) return terminal;
          return mergeTmuxPaneMetadata(terminal, {
            controllerId,
            paneId: pane.tmuxPaneId,
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
        }),
      );
    },
  };
}
