import { type PaneNode, type Terminal, type Workspace } from "../../../types/terminal";

export interface PaneLocationViewData {
  workspaceId: string;
  workspaceName: string;
  windowId: string;
  windowName: string;
  windowIndex: number;
  paneId: string;
  paneNumber: number;
  terminalId?: number;
  configId?: string;
}

export function selectPaneLocations(
  workspaces: readonly Workspace[],
  terminals: readonly Terminal[],
): ReadonlyMap<number, PaneLocationViewData> {
  const terminalIds = new Set(terminals.map((terminal) => terminal.id));
  const locations = new Map<number, PaneLocationViewData>();

  for (const workspace of workspaces) {
    workspace.windows.forEach((window, windowIndex) => {
      let paneNumber = 0;
      visitPane(window.rootPane, (pane) => {
        paneNumber += 1;
        if (pane.terminalId === undefined || !terminalIds.has(pane.terminalId)) {
          return;
        }

        locations.set(pane.terminalId, {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          windowId: window.id,
          windowName: window.name,
          windowIndex,
          paneId: pane.id,
          paneNumber,
          terminalId: pane.terminalId,
          configId: pane.configId,
        });
      });
    });
  }

  return locations;
}

function visitPane(node: PaneNode, visitor: (pane: PaneNode) => void): void {
  if (node.type === "leaf") {
    visitor(node);
    return;
  }
  for (const child of node.children ?? []) {
    visitPane(child, visitor);
  }
}
