/**
 * toggleGroup — flip a group's `collapsed` flag.
 */
import { usePersistenceStore } from "../../service/persistence/store";

export function toggleGroup(id: number): void {
  usePersistenceStore.getState().toggleGroup(id);
}
