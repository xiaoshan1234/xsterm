/**
 * setActiveWindow — set the active window inside a workspace.
 */
import { useWorkspaceStore } from "../../service/workspace/store";

export function setActiveWindow(workspaceId: string, windowId: string): void {
  useWorkspaceStore
    .getState()
    .setWorkspaces((prev) =>
      prev.map((workspace) =>
        workspace.id === workspaceId ? { ...workspace, activeWindowId: windowId } : workspace,
      ),
    );
}
