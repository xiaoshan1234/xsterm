import { type SavedTerminalConfig, type Terminal, type Workspace } from "../../../types/terminal";
import {
  selectPaneLocations,
  type PaneLocationViewData,
} from "../../workspace/viewModels/paneLocationViewModel";

export type TmuxRuntimeStatus = "connected" | "disconnected";

export interface TmuxStatusPaneViewData {
  terminalId: number;
  tmuxPaneId: string;
  tmuxWindowId: string;
  title: string;
  status: TmuxRuntimeStatus;
  location?: PaneLocationViewData;
}

export interface TmuxStatusWindowViewData {
  tmuxWindowId: string;
  name: string;
  status: TmuxRuntimeStatus;
  panes: readonly TmuxStatusPaneViewData[];
}

export interface TmuxStatusControllerViewData {
  controllerId: number;
  title: string;
  status: TmuxRuntimeStatus;
  transport: "local" | "ssh";
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
    const windows = groupWindows(panes, locations);
    const status = panes.some((pane) => pane.isConnected) ? "connected" : "disconnected";

    return {
      controllerId,
      title: config?.name ?? `tmux controller ${controllerId}`,
      status,
      transport: config?.type === "tmux-pane" && config.config.ssh ? "ssh" : "local",
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
    return {
      tmuxWindowId,
      name: windowPanes[0]?.name ?? `Window ${tmuxWindowId}`,
      status,
      panes: windowPanes.map((pane) => ({
        terminalId: pane.id,
        tmuxPaneId: pane.tmuxPaneId ?? "unknown",
        tmuxWindowId,
        title: pane.name,
        status: pane.isConnected ? "connected" : "disconnected",
        ...(locations.has(pane.id) ? { location: locations.get(pane.id) } : {}),
      })),
    };
  });
}
