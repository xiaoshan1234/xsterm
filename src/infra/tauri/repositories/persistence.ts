/**
 * Tauri-backed implementation of `model/persistence.ConfigRepository`.
 *
 * Wraps the existing `infra/store/{savedConfigs,savedWorkspaces,
 * savedWindows,groups}.ts` `tauri-plugin-store` adapters behind the
 * model-defined `ConfigRepository` interface so the persistence model
 * layer (and tests) can consume the same surface without importing
 * from `infra/*` directly.
 *
 * **Coexistence**: this object is added alongside the legacy
 * function exports (`loadSavedConfigs`, `persistConfigs`, …); no
 * existing call site is migrated in Phase 2 — Phase 3 lands the
 * active `PersistenceModel` and switches persistence actions over.
 */
import type { ConfigRepository, GroupStore } from "../../../model/persistence/repository";
import { loadSavedConfigs, persistConfigs } from "../../store/savedConfigs";
import { loadSavedGroups, persistGroups } from "../../store/groups";
import {
  loadSavedWindowConfigs,
  persistWindowConfigs,
  deleteSavedWindowConfig,
} from "../../store/savedWindows";
import {
  loadSavedWorkspaces,
  persistWorkspaces,
  deleteSavedWorkspace,
} from "../../store/savedWorkspaces";

export const tauriConfigRepository: ConfigRepository = {
  // --- saved session configs ---
  loadConfigs: loadSavedConfigs,
  saveConfigs: persistConfigs,

  // --- saved workspaces ---
  loadWorkspaces: loadSavedWorkspaces,
  saveWorkspaces: persistWorkspaces,
  deleteWorkspace: deleteSavedWorkspace,

  // --- saved window configs ---
  loadWindowConfigs: loadSavedWindowConfigs,
  saveWindowConfigs: persistWindowConfigs,
  deleteWindowConfig: deleteSavedWindowConfig,

  // --- sidebar groups ---
  loadGroups: async (): Promise<GroupStore> => loadSavedGroups(),
  saveGroups: async (payload: GroupStore): Promise<void> => persistGroups(payload),
};
