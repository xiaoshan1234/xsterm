import type { Workspace } from "../../model/workspace";
import { collectSessionIdsFromPaneTree } from "./paneTree";

/**
 * Union of session ids attached to panes across every window of a workspace,
 * deduplicated and ordered by first occurrence.
 */
export function collectSessionIdsFromWorkspace(workspace: Workspace): number[] {
  const ids = new Set<number>();
  workspace.windows.forEach((window) => {
    if (window.kind !== "terminal") return;
    collectSessionIdsFromPaneTree(window.rootPane).forEach((id) => ids.add(id));
  });
  return Array.from(ids);
}
