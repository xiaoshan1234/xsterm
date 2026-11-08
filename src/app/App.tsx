import { SessionProvider } from "../features/terminal/logic/TerminalContext";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LoggerProvider } from "../contexts/LoggerContext";
import AppLayout from "./AppLayout";
import { AppShellPreview } from "./shell/AppShellPreview";
import { AppShellRuntime } from "./shell/AppShellRuntime";
import "../styles/global.css";
import "../styles/layout.css";

export default function App() {
  const isRuntimeShellPreview = import.meta.env.DEV && import.meta.env.VITE_UI_PREVIEW === "true";
  const isStaticUiPreview =
    import.meta.env.DEV && !isRuntimeShellPreview && window.location.hash === "#ui-preview";

  if (isStaticUiPreview) {
    return <AppShellPreview />;
  }

  return (
    <SessionProvider>
      <ThemeProvider>
        <LoggerProvider>
          {isRuntimeShellPreview ? <AppShellRuntime /> : <AppLayout />}
        </LoggerProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
