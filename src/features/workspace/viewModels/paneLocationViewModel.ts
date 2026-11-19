import type { PaneId, TerminalId, WindowId, WorkspaceId } from "../../../models";
import type { Terminal } from "../../../features/terminal";
import type { EditablePaneNode } from "../contracts";
import type { Workspace } from "../contracts";

export interface PaneLocationViewData {
  workspaceId: WorkspaceId;
  workspaceName: string;
  windowId: WindowId;
  windowName: string;
  windowIndex: number;
  paneId: PaneId;
  paneNumber: number;
  terminalId?: TerminalId;
  configId?: string;
}

export function selectPaneLocations(
  workspaces: readonly Workspace[],
  terminals: readonly Terminal[],
): ReadonlyMap<TerminalId, PaneLocationViewData> {
  const terminalIds = new Set(terminals.map((terminal) => terminal.id));
  const locations = new Map<TerminalId, PaneLocationViewData>();

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

function visitPane(node: EditablePaneNode, visitor: (pane: EditablePaneNode) => void): void {
  if (node.type === "leaf") {
    visitor(node);
    return;
  }
  for (const child of node.children ?? []) {
    visitPane(child, visitor);
  }
}
