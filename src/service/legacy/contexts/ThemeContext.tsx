/**
 * ThemeContext — reads from `src/service/theme/store.ts`.
 *
 * **Migration**: the legacy implementation kept `currentThemeKey` in
 * `useState`. The store-based version owns the state in Zustand so
 * non-React callers (bridges, settings dialog) can read it via
 * `useThemeStore.getState()`.
 *
 * The provider API (`currentTheme`, `currentThemeKey`, `setTheme`,
 * `themeKeys`) is preserved so the rest of the React tree doesn't
 * change.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useThemeStore } from "../../theme/store";

interface ThemeContextType {
  currentTheme: ReturnType<typeof useThemeStore.getState>["currentTheme"];
  currentThemeKey: string;
  setTheme: (key: string) => void;
  themeKeys: string[];
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const currentThemeKey = useThemeStore((s) => s.currentThemeKey);
  const currentTheme = useThemeStore((s) => s.currentTheme);
  const themeKeys = useThemeStore((s) => s.themeKeys);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <ThemeContext.Provider value={{ currentTheme, currentThemeKey, setTheme, themeKeys }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
