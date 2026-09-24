/**
 * Legacy re-export shim — `SessionOutputFrame` moved to
 * `model/output/types.ts`.
 *
 * The path uses the explicit `/index` suffix because TS would
 * otherwise resolve `./output` to this very file (the directory
 * `./output/` and the file `./session-output.ts` are co-located
 * here, and `./output` matches the sibling directory).
 */
export type { SessionOutputFrame } from "./output/index";
