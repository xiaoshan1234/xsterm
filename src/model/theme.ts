/**
 * Legacy re-export shim — `TerminalTheme` + `PRESET_THEMES` moved to
 * `model/theme/types.ts`.
 *
 * The path uses the explicit `/index` suffix because TS would
 * otherwise resolve `./theme` to this very file (the directory
 * `./theme/` and the file `./theme.ts` both exist here).
 */
export { PRESET_THEMES, THEME_KEYS, type TerminalTheme } from "./theme/index";
