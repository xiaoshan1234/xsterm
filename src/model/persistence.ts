/**
 * Persistence-shaped data types.
 *
 * Pure schema definitions only — migration logic lives in
 * `src/infra/store/migrations.ts` (IO-adjacent, tied to the
 * on-disk format that the `tauri-plugin-store` adapters read).
 */
import type { CreateSessionInput } from "./session-config";
import type { SessionDisplayConfig } from "./session";

/** Persisted shape of a session config (what the user saved in the dialog). */
export type SavedSessionConfig = {
  id: string;
  name: string;
  version: number;
} & CreateSessionInput & {
    displayConfig?: SessionDisplayConfig;
  };

/** A group of saved session configs in the sidebar. */
export interface SessionGroup {
  id: number;
  name: string;
  /** Ids of `SavedSessionConfig`s in this group. */
  configIds: string[];
  /** Whether the group is collapsed in the sidebar. */
  collapsed: boolean;
}
