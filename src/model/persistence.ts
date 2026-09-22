/**
 * Legacy redirect for the on-disk persistence shapes. Older code paths
 * imported `SavedSessionConfig` / `SessionGroup` from
 * `model/persistence.ts` after those shapes migrated to
 * `model/session-config.ts`. The canonical definitions live there.
 */
export type { SavedSessionConfig, SessionGroup } from "./session-config";
