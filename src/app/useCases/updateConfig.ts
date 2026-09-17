/**
 * updateConfig — replace a saved config with a new revision. The
 * persisted `id` stays the same.
 */
import { usePersistenceStore } from "../../service/persistence/store";
import type { SavedSessionConfig } from "../../model/entities";

export function updateConfig(config: SavedSessionConfig): void {
  usePersistenceStore.getState().upsertSavedConfig(config);
}