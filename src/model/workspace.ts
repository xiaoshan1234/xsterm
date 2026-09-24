/**
 * Legacy re-export shim — types moved to `model/workspace/types.ts`.
 *
 * The path uses the explicit `/index` suffix because TS would
 * otherwise resolve `./workspace` to this very file (the directory
 * `./workspace/` and the file `./workspace.ts` both exist here).
 */
export type { App, Workspace } from "./workspace/index";
