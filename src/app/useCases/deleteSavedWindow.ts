/**
 * deleteSavedWindow — remove a saved window config from the
 * persistence store.
 */
import { usePersistenceStore } from "../../service/persistence/store";

export function deleteSavedWindow(id: string): void {
  usePersistenceStore.getState().removeSavedWindowConfig(id);
}
