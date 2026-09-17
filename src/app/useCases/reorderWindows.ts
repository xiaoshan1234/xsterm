/**
 * reorderWindows — move a window from one tab index to another
 * inside the same workspace.
 */
import { useWorkspaceStore } from "../../service/workspace/store";

export function reorderWindows(workspaceId: string, fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) return;
  if (fromIndex < 0 || toIndex < 0) return;
  useWorkspaceStore.getState().setWorkspaces((prev) =>
    prev.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      const windows = [...workspace.windows];
      if (fromIndex >= windows.length || toIndex >= windows.length) return workspace;
      const [moved] = windows.splice(fromIndex, 1);
      windows.splice(toIndex, 0, moved);
      return { ...workspace, windows };
    }),
  );
}
