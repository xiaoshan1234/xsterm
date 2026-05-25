import { createContext, useContext, useState, ReactNode } from "react";
import { PRESET_THEMES, AppTheme } from "../types/theme";

interface ThemeContextType {
  currentTheme: AppTheme;
  setTheme: (name: string) => void;
  themes: AppTheme[];
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState<AppTheme>(PRESET_THEMES[0]);

  const setTheme = (name: string) => {
    const theme = PRESET_THEMES.find((t) => t.name === name);
    if (theme) {
      setCurrentTheme(theme);
    }
  };

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, themes: PRESET_THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
