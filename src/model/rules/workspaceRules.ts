import type { Workspace } from "../entities/workspace";
import { collectSessionIdsFromPaneTree } from "../entities/paneTree";

/**
 * Union of session ids attached to panes across every window of a workspace,
 * deduplicated and ordered by first occurrence.
 */
export function collectSessionIdsFromWorkspace(workspace: Workspace): number[] {
  const ids = new Set<number>();
  workspace.windows.forEach((window) => {
    collectSessionIdsFromPaneTree(window.rootPane).forEach((id) => ids.add(id));
  });
  return Array.from(ids);
}

/**
 * Return a new `Workspace` whose `sessionIds` is the deduplicated union
 * of session ids attached to panes across every window of the input
 * workspace. Other fields are preserved.
 */
export function withRecomputedSessionIds(workspace: Workspace): Workspace {
  return {
    ...workspace,
    sessionIds: collectSessionIdsFromWorkspace(workspace),
  };
}