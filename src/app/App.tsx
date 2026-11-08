import { SessionProvider } from "../features/sessions";
import { ThemeProvider } from "../shared/theme/ThemeContext";
import { AppShellPreview } from "./shell/AppShellPreview";
import { AppShellRuntime } from "./shell/AppShellRuntime";
import "../styles/global.css";
import "../styles/layout.css";
import "../styles/pane.css";

export default function App() {
  const isStaticUiPreview = import.meta.env.DEV && window.location.hash === "#ui-preview";

  if (isStaticUiPreview) {
    return <AppShellPreview />;
  }

  return (
    <SessionProvider>
      <ThemeProvider>
        <AppShellRuntime />
      </ThemeProvider>
    </SessionProvider>
  );
}
