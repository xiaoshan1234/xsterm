/**
 * Persistence-shaped data types.
 *
 * Pure schema definitions only — migration logic lives in
 * `src/infra/store/migrations.ts` (IO-adjacent, tied to the
 * on-disk format that the `tauri-plugin-store` adapters read).
 */
import type { SessionDisplayConfig, SessionType } from "./session";

export type SavedSessionConfig = ({ id: string; name: string; version: number } & SessionType) & {
  displayConfig?: SessionDisplayConfig;
};

export interface SessionGroup {
  id: number;
  name: string;
  configIds: string[];
  collapsed: boolean;
}
