/**
 * Legacy re-export shim — types moved to
 * `model/persistence/types.ts`.
 *
 * The path uses the explicit `/index` suffix because TS would
 * otherwise resolve `./persistence` to this very file (the
 * directory `./persistence/` and the file `./persistence.ts` both
 * exist here).
 */
export type { SavedSessionConfig, SessionGroup } from "./persistence/index";
