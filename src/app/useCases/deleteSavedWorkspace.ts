/**
 * deleteSavedWorkspace — remove a saved workspace from the
 * persistence store.
 */
import { usePersistenceStore } from "../../service/persistence/store";

export function deleteSavedWorkspace(id: string): void {
  usePersistenceStore.getState().removeSavedWorkspace(id);
}