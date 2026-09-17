/**
 * removeConfig — delete a saved config and its group membership, then
 * close any live session bound to it and strip the session from pane
 * trees.
 */
import * as tauri from "../../infra/tauri/commands/sessions";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { clearSessionOutput } from "../../infra/buffers/sessionOutputBuffer";
import { findPaneNode, getLeafPaneIds, removeSessionAndCollapse } from "../../app/rules/paneTree";
import { withRecomputedSessionIds } from "../../app/rules/workspaceRules";

export function removeConfig(configId: string): void {
  usePersistenceStore.getState().removeSavedConfig(configId);
  usePersistenceStore
    .getState()
    .setGroups((prev) =>
      prev.map((g) => ({ ...g, configIds: g.configIds.filter((id) => id !== configId) })),
    );

  const session = useSessionStore.getState().sessions.find((s) => s.configId === configId);
  if (!session) return;

  tauri.closeSession(session.id).catch(console.error);
  clearSessionOutput(session.id);
  useSessionStore.getState().removeSession(session.id);

  useWorkspaceStore.getState().setWorkspaces((prev) =>
    prev.map((workspace) =>
      withRecomputedSessionIds({
        ...workspace,
        windows: workspace.windows.map((window) => {
          const newRoot = removeSessionAndCollapse(window.rootPane, session.id);
          const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
            ? window.activePaneId
            : (getLeafPaneIds(newRoot)[0] ?? null);
          return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
        }),
      }),
    ),
  );
}
