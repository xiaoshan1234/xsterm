import type { CapabilityFlags } from "../entities/capabilities";
import type { Session, SessionDisplayConfig, SessionType } from "../entities/session";
import type { Workspace } from "../entities/workspace";
import { isSessionUsedInOtherWindow } from "./paneTreeRules";

/**
 * Pure-TS shape consumed by `buildFrontendSession`. Mirrors the fields
 * `sessionService.SessionInfo` exposes but does not import from the
 * service module (which depends on `@tauri-apps/api`). Callers that
 * already hold a `sessionService.SessionInfo` can pass it directly because
 * the field set is structurally compatible.
 */
export interface SessionInfoLike {
  id: number;
  name: string;
  sessionType: Session["sessionType"];
  isConnected: boolean;
  capabilities?: CapabilityFlags;
  tmuxPaneId?: string;
  tmuxControllerId?: number;
  tmuxWindowId?: string;
  xstermWindowId?: number;
  isHidden?: boolean;
}

/**
 * Dispatches to the appropriate backend session creator based on session type.
 * Acts as an exhaustive `switch` over the `type` literal, throwing at runtime
 * if a new variant is added without being handled here.
 */
export async function dispatchByType<R>(
  type: SessionType["type"],
  local: () => Promise<R>,
  ssh: () => Promise<R>,
  tmux: () => Promise<R>,
): Promise<R> {
  switch (type) {
    case "local":
      return local();
    case "ssh":
      return ssh();
    case "tmux-cc":
      return tmux();
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
  _workspaces: ReadonlyArray<Workspace>,
  _workspaceId: string,
  baseName: string,
  _excludeWindowId?: string,
): string {
  return baseName;
}

/**
 * Builds the frontend `Session` object from a backend `SessionInfo`-shaped
 * payload returned by `sessionService.createLocal` / `createSsh` / `createTmux`.
 * The tmux fields (`tmuxPaneId`, `tmuxControllerId`, `tmuxWindowId`,
 * `xstermWindowId`, `isHidden`) are forwarded when present.
 */
export function buildFrontendSession(
  info: SessionInfoLike,
  configId: string,
  type: Session["type"],
  displayConfig?: SessionDisplayConfig,
): Session {
  const now = Date.now();
  return {
    id: info.id,
    configId,
    name: info.name,
    type,
    isConnected: info.isConnected,
    sessionType: info.sessionType,
    displayConfig,
    createdAt: now,
    lastActivityAt: now,
    ...(info.tmuxPaneId !== undefined ? { tmuxPaneId: info.tmuxPaneId } : {}),
    ...(info.tmuxControllerId !== undefined ? { tmuxControllerId: info.tmuxControllerId } : {}),
    ...(info.tmuxWindowId !== undefined ? { tmuxWindowId: info.tmuxWindowId } : {}),
    ...(info.xstermWindowId !== undefined ? { xstermWindowId: info.xstermWindowId } : {}),
    ...(info.isHidden !== undefined ? { isHidden: info.isHidden } : {}),
  };
}

/**
 * Throws when the session is already attached to a pane in a different window.
 * Used to prevent the same session from being shown in two places at once.
 */
export function assertSessionNotUsedElsewhere(
  workspaces: ReadonlyArray<Workspace>,
  workspaceId: string | null,
  windowId: string | null,
  sessionId: number,
): void {
  if (isSessionUsedInOtherWindow(workspaces as Workspace[], workspaceId, windowId, sessionId)) {
    throw new Error("Session is already used in another window");
  }
}
