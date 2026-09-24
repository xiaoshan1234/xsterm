/**
 * Legacy re-export shim — types moved to `model/session/types.ts`.
 *
 * Historically this file also held the persisted
 * `SavedSessionConfig` / `SessionGroup` shapes. Those now live in
 * `model/persistence/types.ts` and are re-exported here for backward
 * compat with callers that imported `SavedSessionConfig` /
 * `SessionGroup` from this path.
 *
 * The path uses the explicit `/index` suffix because TS would
 * otherwise resolve `./session` to this very file (the directory
 * `./session/` and the file `./session-config.ts` are co-located
 * here, and `./session` matches the sibling directory).
 */
export type {
  CreateSessionInput,
  LocalSessionConfig,
  SessionDisplayConfig,
  SessionEnvConfig,
  SessionLoggingConfig,
  SessionType,
  SSHSessionConfig,
  TmuxCcConfig,
} from "./session/index";

export type { SavedSessionConfig, SessionGroup } from "./persistence/index";
