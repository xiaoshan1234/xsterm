/**
 * Legacy re-export shim — types moved to `model/session/types.ts`.
 * Kept so existing `import { Session } from "../../model/session"`
 * consumers keep resolving.
 *
 * The path uses the explicit `/index` suffix because TS would
 * otherwise resolve `./session` to this very file (the directory
 * `./session/` and the file `./session.ts` both exist here).
 */
export type {
  CapabilityFlags,
  CreateSessionInput,
  LocalSessionConfig,
  Session,
  SessionConnectionType,
  SessionDisplayConfig,
  SessionEnvConfig,
  SessionInfo,
  SessionLoggingConfig,
  SessionType,
  SSHSessionConfig,
  TmuxCcConfig,
  TmuxSessionBackend,
} from "./session/index";
