import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import App from "./App";
import { darkTheme, lightTheme } from "./theme/theme";
import { GlobalStyles } from "./theme/globalStyles";
import { useAppTheme } from "./hooks/useAppTheme";

function ThemedApp() {
  const { effectiveMode } = useAppTheme();
  const theme = effectiveMode === "dark" ? darkTheme : lightTheme;
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
