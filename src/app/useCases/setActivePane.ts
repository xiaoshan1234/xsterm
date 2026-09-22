/**
 * setActivePane — focus a pane inside a window and bump
 * `lastActivityAt` on the matching session.
 */
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { findPaneNode } from "../../app/rules/paneTree";

export function setActivePane(workspaceId: string, windowId: string, paneId: string): void {
  useWorkspaceStore.getState().setWorkspaces((prev) =>
    prev.map((workspace) =>
      workspace.id === workspaceId
        ? {
            ...workspace,
            activeWindowId: windowId,
            windows: workspace.windows.map((window) =>
              window.id === windowId ? { ...window, activePaneId: paneId } : window,
            ),
          }
        : workspace,
    ),
  );

  const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
  const win = ws?.windows.find((w) => w.id === windowId);
  const root = win?.kind === "terminal" ? win.rootPane : null;
  const target = root ? findPaneNode(root, paneId) : null;
  const sessionId = target?.kind === "leaf" ? target.binding?.sessionId : undefined;
  if (sessionId !== undefined) {
    const now = Date.now();
    useSessionStore
      .getState()
      .setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, lastActivityAt: now } : s)),
      );
  }
}
