/**
 * renameSavedWorkspace — rename a snapshot. Refuses the reserved
 * "default" name and rejects duplicates.
 */
import { usePersistenceStore } from "../../service/persistence/store";

export function renameSavedWorkspace(id: string, name: string): void {
  const trimmed = name.trim();
  if (trimmed === "default") throw new Error("Workspace name is reserved");
  const persistenceStore = usePersistenceStore.getState();
  if (persistenceStore.savedWorkspaces.some((w) => w.id !== id && w.name.trim() === trimmed)) {
    throw new Error("Workspace name already exists");
  }
  persistenceStore.renameSavedWorkspace(id, trimmed);
}
