/**
 * Legacy re-export shim — types moved to `model/window/types.ts`.
 *
 * The path uses the explicit `/index` suffix because TS would
 * otherwise resolve `./window` to this very file (the directory
 * `./window/` and the file `./window.ts` both exist here).
 */
export type {
  InitialWindow,
  TerminalWindow,
  TmuxControlWindow,
  Window,
  WindowBase,
  WindowKind,
} from "./window/index";
