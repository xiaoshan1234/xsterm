/**
 * Workspace service — action function surface.
 *
 * **Stub bodies** in Commit 3 — Commit 4 fills in the real
 * mutations (window creation, pane tree updates, etc).
 *
 * **No cross-service imports**: this file MUST NOT import from
 * `service/session/*` or any other service. Bridges compose.
 */
import type { PaneNode, Window, Workspace } from "../../model/entities";
import { useWorkspaceStore, type WorkspaceStoreState } from "./store";

export function setWorkspaces(
  next: Workspace[] | ((prev: Workspace[]) => Workspace[]),
): void {
  useWorkspaceStore.getState().setWorkspaces(next);
}

export function addWorkspace(workspace: Workspace): void {
  useWorkspaceStore.getState().addWorkspace(workspace);
}

export function removeWorkspace(id: string): void {
  useWorkspaceStore.getState().removeWorkspace(id);
}

export function renameWorkspace(id: string, name: string): void {
  useWorkspaceStore.getState().renameWorkspace(id, name);
}

export function setActiveWorkspaceId(
  next: string | null | ((prev: string | null) => string | null),
): void {
  useWorkspaceStore.getState().setActiveWorkspaceId(next);
}

export function setActiveWorkspace(id: string): void {
  useWorkspaceStore.getState().setActiveWorkspace(id);
}

export function reorderWindows(
  workspaceId: string,
  fromIndex: number,
  toIndex: number,
): void {
  useWorkspaceStore.getState().reorderWindows(workspaceId, fromIndex, toIndex);
}

export function addWindow(workspaceId: string, window: Window): void {
  useWorkspaceStore.getState().addWindow(workspaceId, window);
}

export function removeWindow(workspaceId: string, windowId: string): void {
  useWorkspaceStore.getState().removeWindow(workspaceId, windowId);
}

export function renameWindow(workspaceId: string, windowId: string, name: string): void {
  useWorkspaceStore.getState().renameWindow(workspaceId, windowId, name);
}

export function setActiveWindow(workspaceId: string, windowId: string): void {
  useWorkspaceStore.getState().setActiveWindow(workspaceId, windowId);
}

export function updateWindowPaneTree(
  workspaceId: string,
  windowId: string,
  updater: (root: PaneNode) => PaneNode,
): void {
  useWorkspaceStore.getState().updateWindowPaneTree(workspaceId, windowId, updater);
}

export function getWorkspacesRef(): { current: Workspace[] } {
  return useWorkspaceStore.getState().workspacesRef;
}

export function resetWorkspaceService(): void {
  useWorkspaceStore.getState().reset();
}

/**
 * React hook selector — subscribers to the parts of the workspace
 * store the component reads.
 */
export function useWorkspaceActions(): Pick<
  WorkspaceStoreState,
  | "workspaces"
  | "setWorkspaces"
  | "activeWorkspaceId"
  | "setActiveWorkspaceId"
  | "addWorkspace"
  | "setActiveWorkspace"
  | "removeWindow"
  | "setActiveWindow"
  | "reorderWindows"
> {
  return useWorkspaceStore((s) => ({
    workspaces: s.workspaces,
    setWorkspaces: s.setWorkspaces,
    activeWorkspaceId: s.activeWorkspaceId,
    setActiveWorkspaceId: s.setActiveWorkspaceId,
    addWorkspace: s.addWorkspace,
    setActiveWorkspace: s.setActiveWorkspace,
    removeWindow: s.removeWindow,
    setActiveWindow: s.setActiveWindow,
    reorderWindows: s.reorderWindows,
  }));
}
