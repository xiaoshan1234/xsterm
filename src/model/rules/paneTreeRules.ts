import type { Workspace } from "../entities/workspace";
import { isSessionInPaneTree } from "../entities/paneTree";

/**
 * Scans every workspace and window's pane tree (depth-first) and returns
 * the first location where the given session is attached. Returns null
 * when the session is not used in any window.
 */
export function findSessionWindow(
  workspaces: Workspace[],
  sessionId: number,
): { workspaceId: string; windowId: string } | null {
  for (const workspace of workspaces) {
    for (const window of workspace.windows) {
      if (isSessionInPaneTree(window.rootPane, sessionId)) {
        return { workspaceId: workspace.id, windowId: window.id };
      }
    }
  }
  return null;
}

/**
 * Returns true when the given session is attached to a pane in any
 * window other than the currently active one. A null `currentWorkspaceId`
 * or `currentWindowId` means "no current window" — in that case the
 * session is considered "used elsewhere" as soon as it is found anywhere.
 */
export function isSessionUsedInOtherWindow(
  workspaces: Workspace[],
  currentWorkspaceId: string | null,
  currentWindowId: string | null,
  sessionId: number,
): boolean {
  for (const workspace of workspaces) {
    for (const window of workspace.windows) {
      if (!isSessionInPaneTree(window.rootPane, sessionId)) continue;
      if (currentWorkspaceId === null || currentWindowId === null) return true;
      if (workspace.id !== currentWorkspaceId || window.id !== currentWindowId) return true;
    }
  }
  return false;
}