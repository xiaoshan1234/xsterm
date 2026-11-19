import { forEachPane, type Workspace } from "../../../features/workspace";

export interface TerminalPaneLocation {
  workspaceId: string;
  windowId: string;
  paneId: string;
}

export function findTerminalPaneLocation(
  workspaces: readonly Workspace[],
  terminalId: number,
): TerminalPaneLocation | undefined {
  for (const workspace of workspaces) {
    for (const window of workspace.windows) {
      let paneId: string | undefined;
      forEachPane(window.rootPane, (pane) => {
        if (!paneId && pane.type === "leaf" && pane.terminalId === terminalId) {
          paneId = pane.id;
        }
      });
      if (paneId) {
        return { workspaceId: workspace.id, windowId: window.id, paneId };
      }
    }
  }
  return undefined;
}

export function focusTerminalInWorkspaces(
  workspaces: readonly Workspace[],
  target: TerminalPaneLocation,
): Workspace[] {
  return workspaces.map((workspace) =>
    workspace.id === target.workspaceId
      ? {
          ...workspace,
          activeWindowId: target.windowId,
          windows: workspace.windows.map((window) =>
            window.id === target.windowId ? { ...window, activePaneId: target.paneId } : window,
          ),
        }
      : workspace,
  );
}
