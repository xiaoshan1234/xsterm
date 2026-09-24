/**
 * Persistence domain — backend-side data access contract.
 *
 * **Scope**
 * Defines the surface the `PersistenceModel` (Phase 3) uses to read
 * and write the `tauri-plugin-store`-backed files. Concretely:
 * - `sessions.json` holds `SavedSessionConfig[]`, `SessionGroup[]`,
 *   `nextGroupId`, `SavedWorkspace[]`, `SavedWindowConfig[]`.
 *
 * The migration matrix (`infra/store/migrations.ts`) is intentionally
 * **not** part of this surface — it sits between the repo and the
 * disk, applied on `load*()` reads and bypassed on `persist*()` writes
 * (we only write the current shape).
 *
 * **Why a repository**
 * Same rationale as `SessionRepository` — keeps `model/*` free of
 * `@tauri-apps/api/*`, lets `service/` and tests inject a fake.
 */
import type { SavedSessionConfig, SavedWindowConfig, SavedWorkspace, SessionGroup } from "./types";

/** Bundled payload returned by the legacy `loadSavedGroups` call. */
export interface GroupStore {
  groups: SessionGroup[];
  nextGroupId: number;
}

export interface ConfigRepository {
  // --- saved session configs ---
  loadConfigs(): Promise<SavedSessionConfig[]>;
  saveConfigs(items: SavedSessionConfig[]): Promise<void>;

  // --- saved workspaces ---
  loadWorkspaces(): Promise<SavedWorkspace[]>;
  saveWorkspaces(items: SavedWorkspace[]): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;

  // --- saved window configs ---
  loadWindowConfigs(): Promise<SavedWindowConfig[]>;
  saveWindowConfigs(items: SavedWindowConfig[]): Promise<void>;
  deleteWindowConfig(id: string): Promise<void>;

  // --- sidebar groups ---
  loadGroups(): Promise<GroupStore>;
  saveGroups(payload: GroupStore): Promise<void>;
}
