/**
 * removeFromGroup — strip a saved config from a group's `configIds` list.
 */
import { usePersistenceStore } from "../../service/persistence/store";

export function removeFromGroup(groupId: number, configId: string): void {
  usePersistenceStore.getState().removeConfigFromGroup(groupId, configId);
}