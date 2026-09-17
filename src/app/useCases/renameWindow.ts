/**
 * renameWindow — rename a Window. For tmux-backed windows
 * (`xstermWindowId !== undefined`), the rename round-trips through
 * `infra.renameTmuxWindow`; the actual UI state change is driven by
 * the `tmux-window-renamed` event (idempotent cross-check).
 *
 * For control windows and ordinary terminal windows, the rename is
 * local-only.
 */
import { renameTmuxWindow } from "../../infra/tauri/commands/tmux";
import { useWorkspaceStore } from "../../service/workspace/store";
import { getUniqueWindowName } from "../../model/rules/sessionRules";

export function renameWindow(workspaceId: string, windowId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const wsStore = useWorkspaceStore.getState();
  const window = wsStore.workspaces
    .find((w) => w.id === workspaceId)
    ?.windows.find((w) => w.id === windowId);
  if (window?.xstermWindowId !== undefined) {
    renameTmuxWindow(window.xstermWindowId, trimmed).catch((e: unknown) =>
      console.error("Failed to rename tmux window:", e),
    );
    return;
  }
  wsStore.setWorkspaces((prev) =>
    prev.map((workspace) => {
      if (workspace.id !== workspaceId) return workspace;
      return {
        ...workspace,
        windows: workspace.windows.map((w) =>
          w.id === windowId
            ? { ...w, name: getUniqueWindowName(prev, workspaceId, trimmed, windowId) }
            : w,
        ),
      };
    }),
  );
}
