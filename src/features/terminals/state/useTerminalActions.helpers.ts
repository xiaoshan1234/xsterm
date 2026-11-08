import type * as terminalService from "../../../services/terminalService";
import type {
  Terminal,
  TerminalDisplayConfig,
  TerminalKind,
  Workspace,
} from "../../../types/terminal";
import { isSessionUsedInOtherWindow } from "./paneUtils";

/**
 * Dispatches to the appropriate backend terminal creator based on terminal type.
 * Acts as an exhaustive `switch` over the `type` literal, throwing at runtime
 * if a new variant is added without being handled here.
 */
export async function dispatchByType(
  type: TerminalKind["type"],
  local: () => Promise<terminalService.TerminalInfo>,
  ssh: () => Promise<terminalService.TerminalInfo>,
  tmux: () => Promise<terminalService.TerminalInfo>,
): Promise<terminalService.TerminalInfo> {
  switch (type) {
    case "local":
      return local();
    case "ssh":
      return ssh();
    case "wsl":
      return local();
    case "tmux-pane":
      return tmux();
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown terminal type: ${String(_exhaustive)}`);
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
 * Builds the frontend `Terminal` object from a backend `TerminalInfo` returned
 * by `terminalService.createLocal` / `createSsh` / `createTmux`. The tmux
 * fields (`tmuxPaneId`, `tmuxSessionId`, `isHidden`, `tmuxWindowId`,
 * `xstermWindowId`) are forwarded when present.
 */
export function buildFrontendTerminal(
  info: terminalService.TerminalInfo,
  configId: string,
  _type: Terminal["type"],
  displayConfig?: TerminalDisplayConfig,
): Terminal {
  const now = Date.now();
  const tmux =
    info.kind.type === "tmux-pane"
      ? { tmuxSessionId: info.kind.sessionId, tmuxPaneId: info.kind.paneId }
      : {};
  return {
    id: info.id,
    configId,
    name: info.name,
    type: info.kind.type,
    isConnected: info.isConnected,
    kind: info.kind,
    displayConfig,
    createdAt: now,
    lastActivityAt: now,
    ...tmux,
    ...(info.tmuxWindowId !== undefined ? { tmuxWindowId: info.tmuxWindowId } : {}),
    ...(info.isHidden !== undefined ? { isHidden: info.isHidden } : {}),
    ...(info.capabilities !== undefined ? { capabilities: info.capabilities } : {}),
  };
}

/**
 * Throws when the terminal is already attached to a pane in a different window.
 * Used to prevent the same terminal from being shown in two places at once.
 */
export function assertSessionNotUsedElsewhere(
  workspaces: Workspace[],
  workspaceId: string | null,
  windowId: string | null,
  terminalId: number,
): void {
  if (isSessionUsedInOtherWindow(workspaces, workspaceId, windowId, terminalId)) {
    throw new Error("Terminal is already used in another window");
  }
}
