/**
 * Persistence-shaped data types.
 *
 * Pure schema definitions only — migration logic lives in
 * `src/infra/store/migrations.ts` (IO-adjacent, tied to the
 * on-disk format that the `tauri-plugin-store` adapters read).
 */
import type { SessionDisplayConfig } from "./session";

export interface SavedSessionConfig {
  id: string;
  name: string;
  version: number;
  /** Transport used to reach the backend (matches `Session.sessionType`). */
  type: "local" | "ssh" | "tmux-cc";
  /** Per-transport configuration. */
  config: object;
  displayConfig?: SessionDisplayConfig;
  /** @deprecated Alias for `type` from pre-refactor model. */
  kind?: string;
}

export interface SessionGroup {
  id: number;
  name: string;
  configIds: string[];
  collapsed: boolean;
}
