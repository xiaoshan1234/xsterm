/**
 * moveConfigToGroup — relocate a saved config to a different group
 * (or to no group when `groupId === null`).
 */
import { usePersistenceStore } from "../../service/persistence/store";

export function moveConfigToGroup(configId: string, groupId: number | null): void {
  const persistenceStore = usePersistenceStore.getState();
  persistenceStore.setGroups((prev) =>
    prev.map((g) => ({ ...g, configIds: g.configIds.filter((id) => id !== configId) })),
  );
  if (groupId !== null) {
    persistenceStore.setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, configIds: [...g.configIds, configId] } : g,
      ),
    );
  }
}