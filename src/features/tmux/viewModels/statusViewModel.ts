import type { TerminalId } from "../../../models";
import {
  isTmuxPaneTerminal,
  type Terminal,
  type TmuxPaneTerminal,
} from "../../../features/terminal";
import type { SavedTerminalConfig } from "../../../features/launch-config";

export type TmuxRuntimeStatus = "connected" | "disconnected";

export interface TmuxStatusPaneViewData {
  terminalId: TerminalId;
  tmuxPaneId: string;
  tmuxWindowId: string;
  windowIndex?: number;
  paneIndex?: number;
  width?: number;
  height?: number;
  currentCommand?: string;
  isActive?: boolean;
  title: string;
  status: TmuxRuntimeStatus;
}

export interface TmuxStatusWindowViewData {
  tmuxWindowId: string;
  windowIndex?: number;
  name: string;
  status: TmuxRuntimeStatus;
  panes: readonly TmuxStatusPaneViewData[];
}

export interface TmuxStatusControllerViewData {
  controllerId: number;
  title: string;
  /** Real tmux session name (e.g. `work`), when known from the saved config. */
  sessionName?: string;
  status: TmuxRuntimeStatus;
  transport: "local" | "wsl" | "ssh";
  windows: readonly TmuxStatusWindowViewData[];
}

export function selectTmuxStatusControllers(
  terminals: readonly Terminal[],
  savedConfigs: readonly SavedTerminalConfig[],
): readonly TmuxStatusControllerViewData[] {
  const savedConfigById = new Map(savedConfigs.map((config) => [config.id, config]));
  const controllerTerminals = new Map<number, Terminal[]>();

  for (const terminal of terminals) {
    if (!isTmuxPaneTerminal(terminal)) continue;
    const controllerId = terminal.tmux.controllerId;
    const controllerTerminalsForId = controllerTerminals.get(controllerId) ?? [];
    controllerTerminalsForId.push(terminal);
    controllerTerminals.set(controllerId, controllerTerminalsForId);
  }

  return [...controllerTerminals.entries()].map(([controllerId, panes]) => {
    const config = panes
      .map((pane) => savedConfigById.get(pane.configId))
      .find((candidate) => candidate?.type === "tmux-pane");
    const sessionName =
      panes
        .filter(isTmuxPaneTerminal)
        .map((pane) => pane.tmux.sessionName)
        .find((name) => name !== undefined) ??
      (config?.type === "tmux-pane" ? config.config.tmuxSessionName?.trim() : undefined);
    const windows = groupWindows(panes);
    const status = panes.some((pane) => pane.isConnected) ? "connected" : "disconnected";

    return {
      controllerId,
      title: config?.name ?? `Tmux controller ${controllerId}`,
      ...(sessionName ? { sessionName } : {}),
      status,
      transport:
        config?.type === "tmux-pane" && config.config.ssh
          ? "ssh"
          : config?.type === "tmux-pane" && config.config.transport === "wsl"
            ? "wsl"
            : "local",
      windows,
    };
  });
}

function groupWindows(panes: readonly Terminal[]): readonly TmuxStatusWindowViewData[] {
  const windows = new Map<string, TmuxPaneTerminal[]>();

  for (const pane of panes) {
    if (!isTmuxPaneTerminal(pane)) continue;
    const tmuxWindowId = pane.tmux.windowId ?? "unknown";
    const windowPanes = windows.get(tmuxWindowId) ?? [];
    windowPanes.push(pane);
    windows.set(tmuxWindowId, windowPanes);
  }

  return [...windows.entries()].map(([tmuxWindowId, windowPanes]) => {
    const status = windowPanes.some((pane) => pane.isConnected) ? "connected" : "disconnected";
    const windowIndex = windowPanes.find((pane) => pane.tmux.windowIndex !== undefined)?.tmux
      .windowIndex;
    return {
      tmuxWindowId,
      ...(windowIndex !== undefined ? { windowIndex } : {}),
      name:
        windowPanes.find((pane) => pane.tmux.windowName !== undefined)?.tmux.windowName ??
        windowPanes[0]?.name ??
        `Window ${tmuxWindowId}`,
      status,
      panes: windowPanes.flatMap((pane) => {
        const tmux = pane.tmux;
        return [
          {
            terminalId: pane.id,
            tmuxPaneId: tmux.paneId,
            tmuxWindowId,
            ...(tmux.windowIndex !== undefined ? { windowIndex: tmux.windowIndex } : {}),
            ...(tmux.paneIndex !== undefined ? { paneIndex: tmux.paneIndex } : {}),
            ...(tmux.width !== undefined ? { width: tmux.width } : {}),
            ...(tmux.height !== undefined ? { height: tmux.height } : {}),
            ...(tmux.command ? { currentCommand: tmux.command } : {}),
            ...(tmux.isActive !== undefined ? { isActive: tmux.isActive } : {}),
            title: pane.name,
            status: pane.isConnected ? "connected" : "disconnected",
          },
        ];
      }),
    };
  });
}
