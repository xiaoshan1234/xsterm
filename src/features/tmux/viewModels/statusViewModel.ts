import type { Terminal } from "../../../features/terminal";
import type { SavedTerminalConfig } from "../../../features/launch-config";
import type { Workspace } from "../../../features/workspace";
import { selectPaneLocations, type PaneLocationViewData } from "../../workspace";

export type TmuxRuntimeStatus = "connected" | "disconnected";

export interface TmuxStatusPaneViewData {
  terminalId: number;
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
  location?: PaneLocationViewData;
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
  workspaces: readonly Workspace[],
  savedConfigs: readonly SavedTerminalConfig[],
): readonly TmuxStatusControllerViewData[] {
  const locations = selectPaneLocations(workspaces, terminals);
  const savedConfigById = new Map(savedConfigs.map((config) => [config.id, config]));
  const controllerTerminals = new Map<number, Terminal[]>();

  for (const terminal of terminals) {
    const controllerId = terminal.tmux?.controllerId;
    if (terminal.type !== "tmux-pane" || controllerId === undefined) continue;
    const controllerTerminalsForId = controllerTerminals.get(controllerId) ?? [];
    controllerTerminalsForId.push(terminal);
    controllerTerminals.set(controllerId, controllerTerminalsForId);
  }

  return [...controllerTerminals.entries()].map(([controllerId, panes]) => {
    const config = panes
      .map((pane) => savedConfigById.get(pane.configId))
      .find((candidate) => candidate?.type === "tmux-pane");
    const sessionName =
      panes.find((pane) => pane.tmux?.sessionName)?.tmux?.sessionName ??
      (config?.type === "tmux-pane" ? config.config.tmuxSessionName?.trim() : undefined);
    const windows = groupWindows(panes, locations);
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

function groupWindows(
  panes: readonly Terminal[],
  locations: ReadonlyMap<number, PaneLocationViewData>,
): readonly TmuxStatusWindowViewData[] {
  const windows = new Map<string, Terminal[]>();

  for (const pane of panes) {
    const tmuxWindowId = pane.tmux?.windowId ?? "unknown";
    const windowPanes = windows.get(tmuxWindowId) ?? [];
    windowPanes.push(pane);
    windows.set(tmuxWindowId, windowPanes);
  }

  return [...windows.entries()].map(([tmuxWindowId, windowPanes]) => {
    const status = windowPanes.some((pane) => pane.isConnected) ? "connected" : "disconnected";
    const windowIndex = windowPanes.find((pane) => pane.tmux?.windowIndex !== undefined)?.tmux
      ?.windowIndex;
    return {
      tmuxWindowId,
      ...(windowIndex !== undefined ? { windowIndex } : {}),
      name:
        windowPanes.find((pane) => pane.tmux?.windowName)?.tmux?.windowName ??
        windowPanes[0]?.name ??
        `Window ${tmuxWindowId}`,
      status,
      panes: windowPanes.map((pane) => ({
        terminalId: pane.id,
        tmuxPaneId: pane.tmux?.paneId ?? "unknown",
        tmuxWindowId,
        ...(pane.tmux?.windowIndex !== undefined ? { windowIndex: pane.tmux.windowIndex } : {}),
        ...(pane.tmux?.paneIndex !== undefined ? { paneIndex: pane.tmux.paneIndex } : {}),
        ...(pane.tmux?.width !== undefined ? { width: pane.tmux.width } : {}),
        ...(pane.tmux?.height !== undefined ? { height: pane.tmux.height } : {}),
        ...(pane.tmux?.command ? { currentCommand: pane.tmux.command } : {}),
        ...(pane.tmux?.isActive !== undefined ? { isActive: pane.tmux.isActive } : {}),
        title: pane.name,
        status: pane.isConnected ? "connected" : "disconnected",
        ...(locations.has(pane.id) ? { location: locations.get(pane.id) } : {}),
      })),
    };
  });
}
