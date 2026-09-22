/**
 * closePane — close a single pane: shut down its bound session
 * (if any) and remove the pane leaf from the window's tree.
 */
import * as tauri from "../../infra/tauri/commands/sessions";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { clearSessionOutput } from "../../infra/buffers/sessionOutputBuffer";
import { findPaneNode, getLeafPaneIds, removePaneFromTree } from "../../app/rules/paneTree";
import { withRecomputedSessionIds } from "../../service/legacy/contexts/session/paneUtils";

export async function closePane(
  workspaceId: string,
  windowId: string,
  paneId: string,
): Promise<void> {
  const wsStore = useWorkspaceStore.getState();
  const workspace = wsStore.workspaces.find((w) => w.id === workspaceId);
  const window = workspace?.windows.find((w) => w.id === windowId);
  const pane = window && window.kind === "terminal" ? findPaneNode(window.rootPane, paneId) : null;
  if (!pane) return;

  const sessionId = pane.kind === "leaf" ? pane.binding?.sessionId : undefined;
  if (sessionId !== undefined) {
    try {
      await tauri.closeSession(sessionId);
    } catch (e) {
      console.error("Failed to close session backend:", e);
    }
    clearSessionOutput(sessionId);
    useSessionStore.getState().setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  }

  wsStore.setWorkspaces((prev) =>
    prev.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      return withRecomputedSessionIds({
        ...workspace,
        windows: workspace.windows.map((window) => {
          if (window.id !== windowId) return window;
          if (window.kind !== "terminal") return window;
          const newRoot = removePaneFromTree(window.rootPane, paneId);
          const newActivePaneId =
            window.activePaneId === paneId
              ? (getLeafPaneIds(newRoot)[0] ?? null)
              : window.activePaneId;
          return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
        }),
      });
    }),
  );
}
