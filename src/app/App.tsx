import { SessionProvider } from "../features/sessions";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LoggerProvider } from "../contexts/LoggerContext";
import AppLayout from "./AppLayout";
import { AppShellPreview } from "./shell/AppShellPreview";
import { AppShellRuntime } from "./shell/AppShellRuntime";
import "../styles/global.css";
import "../styles/layout.css";

export default function App() {
  const isStaticUiPreview = import.meta.env.DEV && window.location.hash === "#ui-preview";
  const isLegacyApp = import.meta.env.DEV && import.meta.env.VITE_LEGACY_APP === "true";

  if (isStaticUiPreview) {
    return <AppShellPreview />;
  }

  return (
    <SessionProvider>
      <ThemeProvider>
        <LoggerProvider>{isLegacyApp ? <AppLayout /> : <AppShellRuntime />}</LoggerProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
