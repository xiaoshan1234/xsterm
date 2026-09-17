/**
 * closeSession — close a backend session and remove it from
 * `sessions[]` and every pane tree across all workspaces.
 *
 * Backend close is best-effort: a failure logs to the console but the
 * store is still updated (so the UI doesn't show a zombie pane).
 */
import * as tauri from "../../infra/tauri/commands/sessions";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { clearSessionOutput } from "../../infra/buffers/sessionOutputBuffer";
import {
  findPaneNode,
  getLeafPaneIds,
  removeSessionAndCollapse,
} from "../../model/entities/paneTree";
import { withRecomputedSessionIds } from "../../model/rules/workspaceRules";

export async function closeSession(id: number): Promise<void> {
  try {
    await tauri.closeSession(id);
  } catch (e) {
    console.error("Failed to close session backend:", e);
  } finally {
    clearSessionOutput(id);
    useSessionStore.getState().removeSession(id);

    const wsStore = useWorkspaceStore.getState();
    wsStore.setWorkspaces((prev) =>
      prev.map((workspace) =>
        withRecomputedSessionIds({
          ...workspace,
          windows: workspace.windows.map((window) => {
            const newRoot = removeSessionAndCollapse(window.rootPane, id);
            const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
              ? window.activePaneId
              : (getLeafPaneIds(newRoot)[0] ?? null);
            return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
          }),
        }),
      ),
    );
  }
}
