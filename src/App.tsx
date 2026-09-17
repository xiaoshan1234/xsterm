import AppLayout from "./ui/AppLayout";
import { SessionBridge } from "./service/bridges/sessionBridge";
import { OutputBridge } from "./service/bridges/outputBridge";
import { TmuxBridge } from "./service/bridges/tmuxBridge";
import { AutoAttachBridge } from "./service/bridges/autoAttachBridge";
import { ThemeBridge } from "./service/bridges/themeBridge";
import { LoggerBridge } from "./service/bridges/loggerBridge";
import { SessionProvider } from "./service/legacy/contexts/SessionContext";
import { ThemeProvider } from "./service/legacy/contexts/ThemeContext";
import { LoggerProvider } from "./service/legacy/contexts/LoggerContext";
import "./styles/global.css";
import "./styles/layout.css";

export default function App() {
  return (
    <SessionProvider>
      <ThemeProvider>
        <LoggerProvider>
          <SessionBridge />
          <OutputBridge />
          <TmuxBridge />
          <AutoAttachBridge />
          <ThemeBridge />
          <LoggerBridge />
          <AppLayout />
        </LoggerProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
