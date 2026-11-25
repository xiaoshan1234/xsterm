import type { TerminalConnectionInfo } from "../../../features/terminal";
import type {
  Terminal,
  TerminalDisplayConfig,
  TerminalKind,
  TerminalProperties,
} from "../../../features/terminal";

/**
 * Dispatches to the appropriate backend terminal creator based on terminal type.
 * Acts as an exhaustive `switch` over the `type` literal, throwing at runtime
 * if a new variant is added without being handled here.
 */
export async function dispatchByType(
  type: TerminalKind["type"],
  local: () => Promise<TerminalConnectionInfo>,
  ssh: () => Promise<TerminalConnectionInfo>,
  tmux: () => Promise<TerminalConnectionInfo>,
): Promise<TerminalConnectionInfo> {
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

/** Copies launch defaults into a new per-terminal property object. */
export function createInitialTerminalProperties(
  initialConfig?: TerminalDisplayConfig,
): TerminalProperties {
  const { logging: _logging, ...properties } = initialConfig ?? {};
  return { ...properties };
}

/**
 * Returns the given `baseName` unchanged. Uniqueness is no longer enforced
 * here — visual uniqueness comes from the position prefix rendered in
 * WindowTabBar (`1.`, `2.`, `3.`). The signature is preserved so existing
 * callers in `useWindowActions.ts` keep working.
 */
/**
 * Builds the frontend `Terminal` object from a backend `TerminalInfo` returned
 * by `terminalService.createLocal` / `createSsh` / `createTmux`. Optional tmux
 * metadata is grouped under `tmux` instead of being mixed into the terminal
 * identity fields. Launch settings are copied so later edits to the saved
 * config cannot mutate an existing terminal; logging remains creation-only.
 */
export function buildFrontendTerminal(
  info: TerminalConnectionInfo,
  configId: string,
  _type: Terminal["type"],
  initialConfig?: TerminalDisplayConfig,
): Terminal {
  const now = Date.now();
  const properties = createInitialTerminalProperties(initialConfig);
  const common = {
    id: info.id,
    configId,
    name: info.name,
    isConnected: info.isConnected,
    properties,
    createdAt: now,
    lastActivityAt: now,
    ...(info.isHidden !== undefined ? { isHidden: info.isHidden } : {}),
    ...(info.capabilities !== undefined ? { capabilities: info.capabilities } : {}),
  };

  if (info.kind.type === "local") {
    return { ...common, type: "local", kind: info.kind };
  }
  if (info.kind.type === "ssh") {
    return { ...common, type: "ssh", kind: info.kind };
  }
  if (info.kind.type === "wsl") {
    return { ...common, type: "wsl", kind: info.kind };
  }
  return {
    ...common,
    type: "tmux-pane",
    kind: info.kind,
    tmux: {
      controllerId: info.kind.sessionId,
      paneId: info.kind.paneId,
      ...(info.tmuxWindowId !== undefined ? { windowId: info.tmuxWindowId } : {}),
      ...(info.tmuxSessionName !== undefined ? { sessionName: info.tmuxSessionName } : {}),
    },
  };
}

/**
 * Throws when the terminal is already attached to a pane in a different window.
 * Used to prevent the same terminal from being shown in two places at once.
 */
