import { createContext, useContext, type ReactNode } from "react";
import { logger, type Logger } from "../services/loggerService";

const LoggerContext = createContext<Logger | null>(null);

export function LoggerProvider({ children }: { children: ReactNode }) {
  return <LoggerContext.Provider value={logger}>{children}</LoggerContext.Provider>;
}

export function useLogger() {
  const context = useContext(LoggerContext);
  if (!context) {
    throw new Error("useLogger must be used within a LoggerProvider");
  }
  return context;
}
