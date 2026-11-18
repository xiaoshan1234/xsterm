import { type EditablePaneNode } from "./EditablePaneTree";

export interface SavedWindow {
  id: string;
  name: string;
  rootPane: EditablePaneNode;
}

export interface SavedWindowConfig extends SavedWindow {}

export interface SavedWorkspace {
  id: string;
  name: string;
  windows: SavedWindow[];
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
