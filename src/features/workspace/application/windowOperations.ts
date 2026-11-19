import type { TerminalId, WindowId, WorkspaceId } from "../../../models";
import type { Workspace } from "../contracts";
import { createApplicationError } from "../../../models/applicationError";
import { isSessionUsedInOtherWindow } from "./paneTreeOperations";

export function getUniqueWindowName(
  _workspaces: Workspace[],
  _workspaceId: WorkspaceId | null,
  baseName: string,
  _excludeWindowId?: WindowId,
): string {
  return baseName;
}

export function assertSessionNotUsedElsewhere(
  workspaces: Workspace[],
  workspaceId: WorkspaceId | null,
  windowId: WindowId | null,
  terminalId: TerminalId,
): void {
  if (isSessionUsedInOtherWindow(workspaces, workspaceId, windowId, terminalId)) {
    throw createApplicationError(
      "terminal-already-attached",
      "Terminal is already used in another window",
    );
  }
}
