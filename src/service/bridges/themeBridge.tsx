/**
 * Theme bridge — keeps the legacy `ThemeContext` /
 * `useTheme()` consumers in sync with the new theme store.
 *
 * **Skeleton in Commit 3**: just subscribes to the theme
 * store and re-renders the React tree. Commit 4 will wire
 * a side-effect that persists the chosen theme to
 * `settings.json`.
 *
 * **Render**: returns `null`. Mount once at the top of the
 * React tree.
 */
import { useEffect } from "react";
import { useThemeStore } from "../theme/store";

export function ThemeBridge(): null {
  // Subscribe to the store so React re-renders when the
  // theme changes. The actual sync to localStorage / settings.json
  // arrives in Commit 4.
  useThemeStore((s) => s.currentThemeKey);
  useThemeStore((s) => s.currentTheme);

  useEffect(() => {
    // No-op for now; reserved for persistence side-effects.
  }, []);

  return null;
}
