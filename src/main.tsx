import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Theme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import App from "./App";
import { darkTheme, lightTheme } from "./theme/theme";
import { GlobalStyles } from "./theme/globalStyles";
import { useAppTheme } from "./hooks/useAppTheme";

function applyThemeCssVars(theme: Theme): void {
  const root = document.documentElement;
  const isDark = theme.palette.mode === "dark";
  const accent = theme.palette.primary.main;
  const error = theme.palette.error.main;
  const hexToRgb = (hex: string): string => {
    const h = hex.replace("#", "");
    const n = parseInt(
      h.length === 3
        ? h.split("").map((c) => c + c).join("")
        : h,
      16,
    );
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  };
  const vars: Record<string, string> = {
    "--bg-primary": theme.palette.background.default,
    "--bg-secondary": theme.palette.background.paper,
    "--bg-tertiary": isDark ? "#2d2d2d" : "#f0f0f0",
    "--bg-hover": isDark ? "#3a3a3a" : "rgba(0,0,0,0.04)",
    "--bg-active": isDark ? "#37373d" : "rgba(0,0,0,0.08)",
    "--border-color": theme.palette.divider,
    "--text-primary": theme.palette.text.primary,
    "--text-secondary": theme.palette.text.secondary,
    "--text-muted": theme.palette.text.disabled,
    "--accent": accent,
    "--accent-hover": theme.palette.primary.light,
    "--accent-bg": `rgba(${hexToRgb(accent)}, ${isDark ? 0.15 : 0.08})`,
    "--error": error,
    "--error-bg": `rgba(${hexToRgb(error)}, ${isDark ? 0.1 : 0.08})`,
    "--font-stack": theme.typography.fontFamily as string,
    "--font-mono": 'Menlo, Monaco, "Courier New", monospace',
  };
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
}

function ThemedApp() {
  const { effectiveMode } = useAppTheme();
  const theme = effectiveMode === "dark" ? darkTheme : lightTheme;
  useEffect(() => {
    applyThemeCssVars(theme);
  }, [theme]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles />
      <App />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemedApp />
  </React.StrictMode>,
);
