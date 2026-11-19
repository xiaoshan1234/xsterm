import { createWindowId, type TerminalId } from "../../../models";
import type { Terminal, TmuxPaneRuntimeState, TmuxPaneTerminal } from "../../../features/terminal";
import { isTmuxPaneTerminal } from "../../../features/terminal";
import { TMUX_PANE_CAPABILITIES } from "../../../features/tmux";
import {
  createLeafPane,
  forEachPane,
  getLeafPaneIds,
  type Window,
  type Workspace,
} from "../../../features/workspace";
import { buildTmuxPaneTree, type TmuxPaneGeometry } from "./tmuxWorkspacePaneTree";

export type { TmuxPaneGeometry } from "./tmuxWorkspacePaneTree";

export interface TmuxPaneSessionInfo {
  id: TerminalId;
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
}

export interface TmuxPaneMetadata {
  controllerId?: number;
  paneId?: string;
  tmuxWindowId?: string;
  tmuxSessionName?: string;
  tmuxWindowName?: string;
  tmuxWindowIndex?: number;
  tmuxPaneIndex?: number;
  tmuxPaneWidth?: number;
  tmuxPaneHeight?: number;
  tmuxPaneCommand?: string;
  tmuxPaneActive?: boolean;
}

export function buildTmuxPaneSession(info: TmuxPaneSessionInfo): TmuxPaneTerminal {
  const tmux: TmuxPaneRuntimeState = {
    controllerId: info.tmuxSessionId,
    paneId: info.tmuxPaneId,
    ...(info.tmuxWindowId ? { windowId: info.tmuxWindowId } : {}),
    ...(info.tmuxSessionName ? { sessionName: info.tmuxSessionName } : {}),
    ...(info.tmuxWindowName ? { windowName: info.tmuxWindowName } : {}),
    ...(info.tmuxWindowIndex !== undefined ? { windowIndex: info.tmuxWindowIndex } : {}),
    ...(info.tmuxPaneIndex !== undefined ? { paneIndex: info.tmuxPaneIndex } : {}),
    ...(info.tmuxPaneWidth !== undefined ? { width: info.tmuxPaneWidth } : {}),
    ...(info.tmuxPaneHeight !== undefined ? { height: info.tmuxPaneHeight } : {}),
    ...(info.tmuxPaneCommand ? { command: info.tmuxPaneCommand } : {}),
    ...(info.tmuxPaneActive !== undefined ? { isActive: info.tmuxPaneActive } : {}),
  };

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
    tmux,
    isHidden: false,
    capabilities: TMUX_PANE_CAPABILITIES,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
}

export function mergeTmuxPaneMetadata(terminal: Terminal, metadata: TmuxPaneMetadata): Terminal {
  if (!isTmuxPaneTerminal(terminal)) return terminal;
  const controllerId = metadata.controllerId ?? terminal.tmux.controllerId;
  const paneId = metadata.paneId ?? terminal.tmux.paneId;
  return {
    ...terminal,
    kind: {
      type: "tmux-pane",
      sessionId: controllerId,
      paneId,
    },
    tmux: {
      ...terminal.tmux,
      controllerId,
      paneId,
      ...(metadata.tmuxWindowId ? { windowId: metadata.tmuxWindowId } : {}),
      ...(metadata.tmuxSessionName ? { sessionName: metadata.tmuxSessionName } : {}),
      ...(metadata.tmuxWindowName ? { windowName: metadata.tmuxWindowName } : {}),
      ...(metadata.tmuxWindowIndex !== undefined ? { windowIndex: metadata.tmuxWindowIndex } : {}),
      ...(metadata.tmuxPaneIndex !== undefined ? { paneIndex: metadata.tmuxPaneIndex } : {}),
      ...(metadata.tmuxPaneWidth !== undefined ? { width: metadata.tmuxPaneWidth } : {}),
      ...(metadata.tmuxPaneHeight !== undefined ? { height: metadata.tmuxPaneHeight } : {}),
      ...(metadata.tmuxPaneCommand ? { command: metadata.tmuxPaneCommand } : {}),
      ...(metadata.tmuxPaneActive !== undefined ? { isActive: metadata.tmuxPaneActive } : {}),
    },
  };
}

export function findControllerWorkspaceId(
  workspaces: readonly Workspace[],
  terminals: readonly Terminal[],
  controllerId: number,
): string | undefined {
  return workspaces.find((workspace) =>
    workspace.windows.some((window) => {
      let belongsToController = false;
      forEachPane(window.rootPane, (node) => {
        if (node.type !== "leaf" || node.terminalId === undefined) return;
        const terminal = terminals.find((candidate) => candidate.id === node.terminalId);
        if (
          terminal &&
          isTmuxPaneTerminal(terminal) &&
          terminal.tmux.controllerId === controllerId
        ) {
          belongsToController = true;
        }
      });
      return belongsToController;
    }),
  )?.id;
}

export function buildTmuxWindow(input: {
  layout: string;
  panes: readonly TmuxPaneGeometry[];
  configId: string;
  name: string;
  xstermWindowId: number;
}): Window {
  const rootPane =
    buildTmuxPaneTree(input.layout, input.panes, input.configId) ??
    createLeafPane(100, input.panes[0]?.terminalId, "");
  const leafIds = getLeafPaneIds(rootPane);
  return {
    id: createWindowId(crypto.randomUUID()),
    name: input.name,
    rootPane,
    activePaneId: leafIds[0] ?? null,
    windowType: "terminal",
    xstermWindowId: input.xstermWindowId,
  };
}
