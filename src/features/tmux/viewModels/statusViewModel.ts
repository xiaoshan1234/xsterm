import {
  type SavedTerminalConfig,
  type Terminal,
  type Workspace,
} from "../../../models/legacy/terminal";
import {
  selectPaneLocations,
  type PaneLocationViewData,
} from "../../workspace/viewModels/paneLocationViewModel";

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
    if (terminal.type !== "tmux-pane" || terminal.tmuxSessionId === undefined) continue;
    const controllerTerminalsForId = controllerTerminals.get(terminal.tmuxSessionId) ?? [];
    controllerTerminalsForId.push(terminal);
    controllerTerminals.set(terminal.tmuxSessionId, controllerTerminalsForId);
  }

  return [...controllerTerminals.entries()].map(([controllerId, panes]) => {
    const config = panes
      .map((pane) => savedConfigById.get(pane.configId))
      .find((candidate) => candidate?.type === "tmux-pane");
    const sessionName =
      panes.find((pane) => pane.tmuxSessionName)?.tmuxSessionName ??
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
    const tmuxWindowId = pane.tmuxWindowId ?? "unknown";
    const windowPanes = windows.get(tmuxWindowId) ?? [];
    windowPanes.push(pane);
    windows.set(tmuxWindowId, windowPanes);
  }

  return [...windows.entries()].map(([tmuxWindowId, windowPanes]) => {
    const status = windowPanes.some((pane) => pane.isConnected) ? "connected" : "disconnected";
    const windowIndex = windowPanes.find(
      (pane) => pane.tmuxWindowIndex !== undefined,
    )?.tmuxWindowIndex;
    return {
      tmuxWindowId,
      ...(windowIndex !== undefined ? { windowIndex } : {}),
      name:
        windowPanes.find((pane) => pane.tmuxWindowName)?.tmuxWindowName ??
        windowPanes[0]?.name ??
        `Window ${tmuxWindowId}`,
      status,
      panes: windowPanes.map((pane) => ({
        terminalId: pane.id,
        tmuxPaneId: pane.tmuxPaneId ?? "unknown",
        tmuxWindowId,
        ...(pane.tmuxWindowIndex !== undefined ? { windowIndex: pane.tmuxWindowIndex } : {}),
        ...(pane.tmuxPaneIndex !== undefined ? { paneIndex: pane.tmuxPaneIndex } : {}),
        ...(pane.tmuxPaneWidth !== undefined ? { width: pane.tmuxPaneWidth } : {}),
        ...(pane.tmuxPaneHeight !== undefined ? { height: pane.tmuxPaneHeight } : {}),
        ...(pane.tmuxPaneCommand ? { currentCommand: pane.tmuxPaneCommand } : {}),
        ...(pane.tmuxPaneActive !== undefined ? { isActive: pane.tmuxPaneActive } : {}),
        title: pane.name,
        status: pane.isConnected ? "connected" : "disconnected",
        ...(locations.has(pane.id) ? { location: locations.get(pane.id) } : {}),
      })),
    };
  });
}
