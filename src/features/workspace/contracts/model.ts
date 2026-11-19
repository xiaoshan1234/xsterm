import type { LaunchConfigId, PaneId, TerminalId, WindowId, WorkspaceId } from "../../../models";

export type PaneSplitDirection = "horizontal" | "vertical";

export interface EditablePaneNode {
  id: PaneId;
  type: "leaf" | "split";
  direction?: PaneSplitDirection;
  size: number;
  children?: EditablePaneNode[];
  terminalId?: TerminalId;
  configId?: string;
}

export function createEditableLeafPane(
  id: PaneId,
  size: number,
  terminalId?: TerminalId,
  configId?: string,
): EditablePaneNode {
  return { id, type: "leaf", size, terminalId, configId };
}

export function createEditableSplitNode(
  id: PaneId,
  direction: PaneSplitDirection,
  first: EditablePaneNode,
  second: EditablePaneNode,
): EditablePaneNode {
  return {
    id,
    type: "split",
    direction,
    size: first.size + second.size,
    children: [first, second],
  };
}

export interface SavedWindowConfig {
  id: LaunchConfigId;
  name: string;
  rootPane: EditablePaneNode;
}

export interface SavedWorkspace {
  id: LaunchConfigId;
  name: string;
  windows: SavedWindowConfig[];
}

export interface Window {
  id: WindowId;
  name: string;
  rootPane: EditablePaneNode;
  activePaneId: PaneId | null;
  windowType?: "terminal" | "init";
  xstermWindowId?: number;
}

export interface Workspace {
  id: WorkspaceId;
  name: string;
  windows: Window[];
  activeWindowId: WindowId | null;
  terminalIds: TerminalId[];
  savedWorkspaceId?: LaunchConfigId;
}

export interface PaneTerminalRef {
  id: TerminalId;
  configId: string;
  name: string;
}
