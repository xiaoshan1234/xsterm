/**
 * saveWorkspace — snapshot a workspace to the persistence store.
 * Reuses an existing entry with the same name when present.
 */
import { usePersistenceStore } from "../../service/persistence/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { stripSessionIdFromPaneTree } from "../../model/entities/paneTree";
import { generateId } from "../../model/entities/paneTree";
import type { SavedWorkspace, SavedWindow } from "../../model/entities";

export function saveWorkspace(workspaceId: string, name: string): void {
  const wsStore = useWorkspaceStore.getState();
  const workspace = wsStore.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return;

  const finalName = name.trim() || workspace.name;
  if (finalName === "default") throw new Error("Workspace name is reserved");

  const persistenceStore = usePersistenceStore.getState();
  const isDefault = workspace.name === "default";

  const build = (id: string): SavedWorkspace => ({
    id,
    name: finalName,
    windows: workspace.windows.map((window): SavedWindow => ({
      id: generateId(),
      name: window.name,
      rootPane: stripSessionIdFromPaneTree(window.rootPane),
    })),
  });

  if (isDefault) {
    if (persistenceStore.savedWorkspaces.some((w) => w.name.trim() === finalName)) {
      throw new Error("Workspace name already exists");
    }
    const entry = build(generateId());
    persistenceStore.upsertSavedWorkspace(entry);
    return;
  }

  const existing = persistenceStore.savedWorkspaces.find((w) => w.name.trim() === finalName);
  persistenceStore.upsertSavedWorkspace(build(existing?.id ?? generateId()));
}
