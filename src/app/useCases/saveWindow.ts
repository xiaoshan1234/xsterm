/**
 * saveWindow — snapshot a single Window to the persistence store.
 */
import { usePersistenceStore } from "../../service/persistence/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { generateId, stripSessionIdFromPaneTree } from "../../model/entities/paneTree";

export function saveWindow(workspaceId: string, windowId: string, name: string): void {
  const wsStore = useWorkspaceStore.getState();
  const workspace = wsStore.workspaces.find((w) => w.id === workspaceId);
  const window = workspace?.windows.find((w) => w.id === windowId);
  if (!workspace || !window) return;

  usePersistenceStore.getState().upsertSavedWindowConfig({
    id: generateId(),
    name: name.trim() || window.name,
    rootPane: stripSessionIdFromPaneTree(window.rootPane),
  });
}