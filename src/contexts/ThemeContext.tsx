import { createContext, useContext, useState, ReactNode } from "react";
import { TerminalTheme, PRESET_THEMES, THEME_KEYS } from "../types/theme";

interface ThemeContextType {
  currentTheme: TerminalTheme;
  currentThemeKey: string;
  setTheme: (key: string) => void;
  themeKeys: string[];
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [currentThemeKey, setCurrentThemeKey] = useState<string>("dark");

  const setTheme = (key: string) => {
    if (PRESET_THEMES[key]) {
      setCurrentThemeKey(key);
    }
  };

  const currentTheme = PRESET_THEMES[currentThemeKey];

  return (
    <ThemeContext.Provider
      value={{ currentTheme, currentThemeKey, setTheme, themeKeys: THEME_KEYS }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
