/**
 * addToGroup — append a saved config to a group's `configIds` list.
 */
import { usePersistenceStore } from "../../service/persistence/store";

export function addToGroup(groupId: number, configId: string): void {
  usePersistenceStore.getState().addConfigToGroup(groupId, configId);
}
