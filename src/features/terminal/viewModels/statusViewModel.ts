import {
  type SavedTerminalConfig,
  type Terminal,
  type Workspace,
} from "../../../models/legacy/terminal";
import {
  selectPaneLocations,
  type PaneLocationViewData,
} from "../../workspace/viewModels/paneLocationViewModel";

export type TerminalRuntimeStatus = "connected" | "disconnected";
type NonTmuxTerminal = Terminal & {
  type: "local" | "ssh" | "wsl";
};

export interface TerminalStatusItemViewData {
  terminalId: number;
  title: string;
  transport: "local" | "ssh" | "wsl";
  status: TerminalRuntimeStatus;
  location?: PaneLocationViewData;
  configName?: string;
  canReconnect: boolean;
  lastActivityAt?: number;
}

export function selectTerminalStatusItems(
  terminals: readonly Terminal[],
  workspaces: readonly Workspace[],
  savedConfigs: readonly SavedTerminalConfig[],
): readonly TerminalStatusItemViewData[] {
  const locations = selectPaneLocations(workspaces, terminals);
  const configNames = new Map(savedConfigs.map((config) => [config.id, config.name]));

  return terminals
    .filter((terminal): terminal is NonTmuxTerminal => terminal.type !== "tmux-pane")
    .map((terminal) => ({
      terminalId: terminal.id,
      title: terminal.name,
      transport: terminal.type,
      status: terminal.isConnected ? "connected" : "disconnected",
      ...(locations.has(terminal.id) ? { location: locations.get(terminal.id) } : {}),
      ...(configNames.has(terminal.configId)
        ? { configName: configNames.get(terminal.configId) }
        : {}),
      canReconnect: terminal.capabilities?.supportsReconnect ?? false,
      ...(terminal.lastActivityAt ? { lastActivityAt: terminal.lastActivityAt } : {}),
    }));
}
