import { SessionProvider } from "../features/terminals/TerminalContext";
import { ThemeProvider } from "../contexts/ThemeContext";
import { LoggerProvider } from "../contexts/LoggerContext";
import AppLayout from "./AppLayout";
import "../styles/global.css";
import "../styles/layout.css";

export default function App() {
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
