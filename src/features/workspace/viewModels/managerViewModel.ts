import {
  type SavedWindowConfig,
  type SavedWorkspace,
  type Workspace,
} from "../../../models/legacy/terminal";

export interface WindowManagerItemViewData {
  configId: string;
  name: string;
  paneCount: number;
}

export interface WorkspaceManagerItemViewData {
  configId: string;
  name: string;
  windowCount: number;
  isLoaded: boolean;
}

export function selectWindowManagerItems(
  savedWindows: readonly SavedWindowConfig[],
): readonly WindowManagerItemViewData[] {
  return savedWindows.map((window) => ({
    configId: window.id,
    name: window.name,
    paneCount: countLeaves(window.rootPane),
  }));
}

export function selectWorkspaceManagerItems(
  savedWorkspaces: readonly SavedWorkspace[],
  liveWorkspaces: readonly Workspace[],
): readonly WorkspaceManagerItemViewData[] {
  const loadedNames = new Set(
    liveWorkspaces.flatMap((workspace) => [
      workspace.id,
      workspace.name,
      workspace.savedWorkspaceId,
    ]),
  );

  return savedWorkspaces.map((workspace) => ({
    configId: workspace.id,
    name: workspace.name,
    windowCount: workspace.windows.length,
    isLoaded:
      loadedNames.has(workspace.id) ||
      liveWorkspaces.some(
        (liveWorkspace) =>
          liveWorkspace.savedWorkspaceId === workspace.id || liveWorkspace.name === workspace.name,
      ),
  }));
}

function countLeaves(node: SavedWindowConfig["rootPane"]): number {
  if (node.type === "leaf") return 1;
  return (node.children ?? []).reduce((count, child) => count + countLeaves(child), 0);
}
