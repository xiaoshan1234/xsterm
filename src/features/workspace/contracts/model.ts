export type PaneSplitDirection = "horizontal" | "vertical";

export interface EditablePaneNode {
  id: string;
  type: "leaf" | "split";
  direction?: PaneSplitDirection;
  size: number;
  children?: EditablePaneNode[];
  terminalId?: number;
  configId?: string;
}

export function createEditableLeafPane(
  id: string,
  size: number,
  terminalId?: number,
  configId?: string,
): EditablePaneNode {
  return { id, type: "leaf", size, terminalId, configId };
}

export function createEditableSplitNode(
  id: string,
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
  id: string;
  name: string;
  rootPane: EditablePaneNode;
}

export interface SavedWorkspace {
  id: string;
  name: string;
  windows: SavedWindowConfig[];
}

export interface Window {
  id: string;
  name: string;
  rootPane: EditablePaneNode;
  activePaneId: string | null;
  windowType?: "terminal" | "init";
  xstermWindowId?: number;
}

export interface Workspace {
  id: string;
  name: string;
  windows: Window[];
  activeWindowId: string | null;
  terminalIds: number[];
  savedWorkspaceId?: string;
}

export interface PaneTerminalRef {
  id: number;
  configId: string;
  name: string;
}
