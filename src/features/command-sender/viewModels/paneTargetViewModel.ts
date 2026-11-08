import {
  createPaneTargetKey,
  createPaneTargetDisplayInfo,
  createRawPaneTargetRef,
  createTmuxPaneTargetRef,
  type PaneTargetDisplayInfo,
} from "../../../models";
import { type SavedTerminalConfig, type Terminal, type Workspace } from "../../../types/terminal";
import {
  selectPaneLocations,
  type PaneLocationViewData,
} from "../../workspace/viewModels/paneLocationViewModel";

export function selectPaneTargetDisplayInfos(
  workspaces: readonly Workspace[],
  terminals: readonly Terminal[],
  savedConfigs: readonly SavedTerminalConfig[],
): readonly PaneTargetDisplayInfo[] {
  return selectPaneTargetOptions(workspaces, terminals, savedConfigs).map(
    (option) => option.displayInfo,
  );
}

export interface PaneTargetOptionViewData {
  targetKey: string;
  terminalId: number;
  displayInfo: PaneTargetDisplayInfo;
}

export function selectPaneTargetOptions(
  workspaces: readonly Workspace[],
  terminals: readonly Terminal[],
  savedConfigs: readonly SavedTerminalConfig[],
): readonly PaneTargetOptionViewData[] {
  const terminalById = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  const configNames = new Map(savedConfigs.map((config) => [config.id, config.name]));
  const targets: PaneTargetOptionViewData[] = [];

  for (const location of selectPaneLocations(workspaces, terminals).values()) {
    if (location.terminalId === undefined) continue;
    const terminal = terminalById.get(location.terminalId);
    if (!terminal) continue;

    if (terminal.type === "tmux-pane") {
      if (
        terminal.tmuxSessionId === undefined ||
        terminal.tmuxWindowId === undefined ||
        terminal.tmuxPaneId === undefined
      ) {
        continue;
      }
      const targetResult = createTmuxPaneTargetRef({
        controllerId: terminal.tmuxSessionId,
        tmuxWindowId: terminal.tmuxWindowId,
        tmuxPaneId: terminal.tmuxPaneId,
      });
      if (!targetResult.ok) continue;
      const displayResult = createPaneTargetDisplayInfo({
        target: targetResult.value,
        displayId: `P${location.paneNumber}`,
        title: terminal.name,
        breadcrumb: toBreadcrumb(location, configNames.get(terminal.configId)),
        technicalId: `${terminal.tmuxWindowId}/${terminal.tmuxPaneId}`,
        isAvailable: terminal.isConnected,
      });
      if (displayResult.ok) {
        targets.push({
          targetKey: createPaneTargetKey(targetResult.value),
          terminalId: terminal.id,
          displayInfo: displayResult.value,
        });
      }
      continue;
    }

    const targetResult = createRawPaneTargetRef({
      workspaceId: location.workspaceId,
      windowId: location.windowId,
      paneId: location.paneId,
    });
    if (!targetResult.ok) continue;
    const displayResult = createPaneTargetDisplayInfo({
      target: targetResult.value,
      displayId: `P${location.paneNumber}`,
      title: terminal.name,
      breadcrumb: toBreadcrumb(location, configNames.get(terminal.configId)),
      isAvailable: terminal.isConnected,
    });
    if (displayResult.ok) {
      targets.push({
        targetKey: createPaneTargetKey(targetResult.value),
        terminalId: terminal.id,
        displayInfo: displayResult.value,
      });
    }
  }

  return targets;
}

function toBreadcrumb(location: PaneLocationViewData, configName: string | undefined): string {
  const title = configName ?? location.windowName;
  return `${location.workspaceName} / ${title} / Pane ${location.paneNumber}`;
}
