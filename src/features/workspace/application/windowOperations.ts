import type { Workspace } from "../../../models/runtime/workspace";
import { createApplicationError } from "../../../models/applicationError";
import { isSessionUsedInOtherWindow } from "./paneTreeOperations";

export function getUniqueWindowName(
  _workspaces: Workspace[],
  _workspaceId: string,
  baseName: string,
  _excludeWindowId?: string,
): string {
  return baseName;
}

export function assertSessionNotUsedElsewhere(
  workspaces: Workspace[],
  workspaceId: string | null,
  windowId: string | null,
  terminalId: number,
): void {
  if (isSessionUsedInOtherWindow(workspaces, workspaceId, windowId, terminalId)) {
    throw createApplicationError(
      "terminal-already-attached",
      "Terminal is already used in another window",
    );
  }
}
