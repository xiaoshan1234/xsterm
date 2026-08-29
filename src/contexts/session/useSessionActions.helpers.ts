import type * as sessionService from "../../services/sessionService";
import type { Session, SessionDisplayConfig, SessionType, Workspace } from "../../types/session";
import { isSessionUsedInOtherWindow } from "./paneUtils";

/**
 * Dispatches to the appropriate backend session creator based on session type.
 * Acts as an exhaustive `switch` over the `type` literal, throwing at runtime
 * if a new variant is added without being handled here.
 */
export async function dispatchByType(
  type: SessionType["type"],
  local: () => Promise<sessionService.SessionInfo>,
  ssh: () => Promise<sessionService.SessionInfo>,
): Promise<sessionService.SessionInfo> {
  switch (type) {
    case "local":
      return local();
    case "ssh":
      return ssh();
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown session type: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Returns the given `baseName` unchanged. Uniqueness is no longer enforced
 * here — visual uniqueness comes from the position prefix rendered in
 * WindowTabBar (`1.`, `2.`, `3.`). The signature is preserved so existing
 * callers in `useWindowActions.ts` keep working.
 */
export function getUniqueWindowName(
  _workspaces: Workspace[],
  _workspaceId: string,
  baseName: string,
  _excludeWindowId?: string,
): string {
  return baseName;
}

/**
 * Builds the frontend `Session` object from a backend `SessionInfo` returned
 * by `sessionService.createLocal` / `createSsh`.
 */
export function buildFrontendSession(
  info: sessionService.SessionInfo,
  configId: string,
  type: Session["type"],
  displayConfig?: SessionDisplayConfig,
): Session {
  return {
    id: info.id,
    configId,
    name: info.name,
    type,
    isConnected: info.isConnected,
    sessionType: info.sessionType,
    displayConfig,
  };
}

/**
 * Throws when the session is already attached to a pane in a different window.
 * Used to prevent the same session from being shown in two places at once.
 */
export function assertSessionNotUsedElsewhere(
  workspaces: Workspace[],
  workspaceId: string | null,
  windowId: string | null,
  sessionId: number,
): void {
  if (isSessionUsedInOtherWindow(workspaces, workspaceId, windowId, sessionId)) {
    throw new Error("Session is already used in another window");
  }
}
