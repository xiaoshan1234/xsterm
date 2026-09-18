/**
 * createGroup — create a new group with the next available id.
 */
import { usePersistenceStore } from "../../service/persistence/store";
import type { SessionGroup } from "../../model";

export function createGroup(name: string): void {
  const persistenceStore = usePersistenceStore.getState();
  const id = persistenceStore.nextGroupId;
  const group: SessionGroup = { id, name, configIds: [], collapsed: false };
  persistenceStore.setNextGroupId((prev) => prev + 1);
  persistenceStore.addGroup(group);
}
