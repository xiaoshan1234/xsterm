/**
 * Theme service store — terminal content theme selection.
 *
 * **Scope**: the *terminal content* theme (the ANSI palette used
 * by xterm.js). This is **separate** from the shell chrome theme
 * (CSS variables in `styles/global.css`). The two are decoupled
 * on purpose — see `doc/design-system.md` §10.
 *
 * The terminal palette set lives in `src/types/theme.ts` (legacy
 * re-export) and will move into `service/theme/types.ts` in
 * Commit 6. For now we keep the import path stable.
 */
import { create } from "zustand";
import { PRESET_THEMES, THEME_KEYS, type TerminalTheme } from "../../model/entities/theme";

export interface ThemeStoreState {
  currentThemeKey: string;
  setTheme: (key: string) => void;
  /** Derived from `currentThemeKey`; updated by the setter. */
  currentTheme: TerminalTheme;
  /** All available theme keys. */
  themeKeys: string[];
  reset: () => void;
}

function deriveTheme(key: string): TerminalTheme {
  return PRESET_THEMES[key] ?? PRESET_THEMES.dark;
}

export const useThemeStore = create<ThemeStoreState>((set) => ({
  currentThemeKey: "dark",
  currentTheme: deriveTheme("dark"),
  themeKeys: THEME_KEYS,
  setTheme: (key) => {
    if (!PRESET_THEMES[key]) return;
    set({ currentThemeKey: key, currentTheme: deriveTheme(key) });
  },
  reset: () =>
    set({
      currentThemeKey: "dark",
      currentTheme: deriveTheme("dark"),
    }),
}));
