/**
 * deleteGroup — remove a group. The default group (id 0) is protected.
 */
import { usePersistenceStore } from "../../service/persistence/store";
import { DEFAULT_GROUP_ID } from "../../model/rules/constants";

export function deleteGroup(id: number): void {
  if (id === DEFAULT_GROUP_ID) return;
  usePersistenceStore.getState().removeGroup(id);
}