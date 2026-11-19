import type { Terminal } from "../../../features/terminal";
import {
  buildTmuxPaneTree,
  TMUX_PANE_CAPABILITIES,
  type TmuxPaneGeometry,
} from "../../../features/tmux";

export type { TmuxPaneGeometry } from "../../../features/tmux";
import {
  createLeafPane,
  forEachPane,
  getLeafPaneIds,
  type Window,
  type Workspace,
} from "../../../features/workspace";

export interface TmuxPaneSessionInfo {
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
}

export interface TmuxPaneMetadata {
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

export function buildTmuxPaneSession(info: TmuxPaneSessionInfo): Terminal {
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

export function mergeTmuxPaneMetadata(terminal: Terminal, metadata: TmuxPaneMetadata): Terminal {
  return {
    ...terminal,
    ...(metadata.tmuxWindowId ? { tmuxWindowId: metadata.tmuxWindowId } : {}),
    ...(metadata.tmuxSessionName ? { tmuxSessionName: metadata.tmuxSessionName } : {}),
    ...(metadata.tmuxWindowName ? { tmuxWindowName: metadata.tmuxWindowName } : {}),
    ...(metadata.tmuxWindowIndex !== undefined
      ? { tmuxWindowIndex: metadata.tmuxWindowIndex }
      : {}),
    ...(metadata.tmuxPaneIndex !== undefined ? { tmuxPaneIndex: metadata.tmuxPaneIndex } : {}),
    ...(metadata.tmuxPaneWidth !== undefined ? { tmuxPaneWidth: metadata.tmuxPaneWidth } : {}),
    ...(metadata.tmuxPaneHeight !== undefined ? { tmuxPaneHeight: metadata.tmuxPaneHeight } : {}),
    ...(metadata.tmuxPaneCommand ? { tmuxPaneCommand: metadata.tmuxPaneCommand } : {}),
    ...(metadata.tmuxPaneActive !== undefined ? { tmuxPaneActive: metadata.tmuxPaneActive } : {}),
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
        if (
          terminals.find((terminal) => terminal.id === node.terminalId)?.tmuxSessionId ===
          controllerId
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
    id: crypto.randomUUID(),
    name: input.name,
    rootPane,
    activePaneId: leafIds[0] ?? null,
    windowType: "terminal",
    xstermWindowId: input.xstermWindowId,
  };
}
