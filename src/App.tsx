import { SessionProvider } from "./contexts/SessionContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LoggerProvider } from "./contexts/LoggerContext";
import AppLayout from "./components/AppLayout";

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
