/**
 * renameGroup — set a group's display name.
 */
import { usePersistenceStore } from "../../service/persistence/store";

export function renameGroup(id: number, name: string): void {
  usePersistenceStore.getState().renameGroup(id, name);
}
