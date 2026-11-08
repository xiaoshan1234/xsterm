import { SessionProvider } from "../features/terminal/logic/TerminalContext";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LoggerProvider } from "../contexts/LoggerContext";
import AppLayout from "./AppLayout";
import { AppShellPreview } from "./shell/AppShellPreview";
import "../styles/global.css";
import "../styles/layout.css";

export default function App() {
  const isUiPreview =
    import.meta.env.DEV &&
    (import.meta.env.VITE_UI_PREVIEW === "true" || window.location.hash === "#ui-preview");

  if (isUiPreview) {
    return <AppShellPreview />;
  }

  return (
    <SessionProvider>
      <ThemeProvider>
        <LoggerProvider>
          <AppLayout />
        </LoggerProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
