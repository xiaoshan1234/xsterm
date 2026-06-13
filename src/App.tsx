import { SessionProvider } from "./contexts/SessionContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LoggerProvider } from "./contexts/LoggerContext";
import AppLayout from "./components/AppLayout";
import "./styles/global.css";
import "./styles/layout.css";

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
