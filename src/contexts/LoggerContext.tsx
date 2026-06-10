import { createContext, useContext, useCallback, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogLevel } from "../types/log";

interface LoggerContextType {
  debug: (source: string, message: string, data?: unknown) => void;
  info: (source: string, message: string, data?: unknown) => void;
  warn: (source: string, message: string, data?: unknown) => void;
  error: (source: string, message: string, data?: unknown) => void;
}

const LoggerContext = createContext<LoggerContextType | null>(null);

export function LoggerProvider({ children }: { children: ReactNode }) {
  const log = useCallback((level: LogLevel, source: string, message: string, data?: unknown) => {
    // Console output for developer debugging
    const prefix = `[${source}]`;
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(prefix, message, data ?? "");
        break;
      case LogLevel.INFO:
        console.info(prefix, message, data ?? "");
        break;
      case LogLevel.WARN:
        console.warn(prefix, message, data ?? "");
        break;
      case LogLevel.ERROR:
        console.error(prefix, message, data ?? "");
        break;
    }

    // Send to backend
    invoke("log_message", {
      level: level.toUpperCase(),
      source,
      message,
      data: data ? JSON.stringify(data) : null,
    }).catch(() => {});
  }, []);

  const debug = useCallback((source: string, message: string, data?: unknown) => {
    log(LogLevel.DEBUG, source, message, data);
  }, [log]);

  const info = useCallback((source: string, message: string, data?: unknown) => {
    log(LogLevel.INFO, source, message, data);
  }, [log]);

  const warn = useCallback((source: string, message: string, data?: unknown) => {
    log(LogLevel.WARN, source, message, data);
  }, [log]);

  const error = useCallback((source: string, message: string, data?: unknown) => {
    log(LogLevel.ERROR, source, message, data);
  }, [log]);

  return (
    <LoggerContext.Provider value={{ debug, info, warn, error }}>
      {children}
    </LoggerContext.Provider>
  );
}

export function useLogger() {
  const context = useContext(LoggerContext);
  if (!context) {
    throw new Error("useLogger must be used within a LoggerProvider");
  }
  return context;
}
