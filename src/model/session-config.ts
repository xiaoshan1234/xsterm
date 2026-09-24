/**
 * Legacy re-export shim — types moved to `model/session/types.ts`.
 *
 * Historically this file also held the persisted
 * `PersistedSessionConfig` / `SessionGroup` shapes. Those now live in
 * `model/persistence/types.ts` and are re-exported here for backward
 * compat with callers that imported `PersistedSessionConfig` /
 * `SessionGroup` from this path.
 *
 * The path uses the explicit `/index` suffix because TS would
 * otherwise resolve `./session` to this very file (the directory
 * `./session/` and the file `./session-config.ts` are co-located
 * here, and `./session` matches the sibling directory).
 */
export type {
  SessionInput,
  LocalSessionConfig,
  SessionDisplayConfig,
  SessionEnvConfig,
  SessionLoggingConfig,
  SessionType,
  SSHSessionConfig,
  TmuxCcConfig,
} from "./session/index";

export type { PersistedSessionConfig, SessionGroup } from "./persistence/index";
