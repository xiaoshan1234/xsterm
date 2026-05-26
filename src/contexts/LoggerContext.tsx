import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LogEntry, LogLevel } from "../types/log";

interface LoggerContextType {
  logs: LogEntry[];
  debug: (source: LogEntry["source"], message: string, data?: unknown) => void;
  info: (source: LogEntry["source"], message: string, data?: unknown) => void;
  warn: (source: LogEntry["source"], message: string, data?: unknown) => void;
  error: (source: LogEntry["source"], message: string, data?: unknown) => void;
  clearLogs: () => void;
}

const LoggerContext = createContext<LoggerContextType | null>(null);

const idCounter = { value: 0 };

function createLogEntry(level: LogLevel, source: LogEntry["source"], message: string, data?: unknown): LogEntry {
  return {
    id: `log-${++idCounter.value}`,
    timestamp: new Date(),
    level,
    source,
    message,
    data,
  };
}

export function LoggerProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const maxLogs = 1000;

  const addLog = useCallback((level: LogLevel, source: LogEntry["source"], message: string, data?: unknown) => {
    const entry = createLogEntry(level, source, message, data);
    
    setLogs(prev => {
      const updated = [...prev, entry];
      if (updated.length > maxLogs) {
        return updated.slice(-maxLogs);
      }
      return updated;
    });

    // Console output
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

  const debug = useCallback((source: LogEntry["source"], message: string, data?: unknown) => {
    addLog(LogLevel.DEBUG, source, message, data);
  }, [addLog]);

  const info = useCallback((source: LogEntry["source"], message: string, data?: unknown) => {
    addLog(LogLevel.INFO, source, message, data);
  }, [addLog]);

  const warn = useCallback((source: LogEntry["source"], message: string, data?: unknown) => {
    addLog(LogLevel.WARN, source, message, data);
  }, [addLog]);

  const error = useCallback((source: LogEntry["source"], message: string, data?: unknown) => {
    addLog(LogLevel.ERROR, source, message, data);
  }, [addLog]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // Listen for backend logs
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<{ level: string; source: string; message: string; data?: string }>(
      "backend-log",
      (event) => {
        const { level, source, message, data } = event.payload;
        const logLevel = level.toLowerCase() as LogLevel;
        const entry = createLogEntry(logLevel, source as LogEntry["source"], message, data ? JSON.parse(data) : undefined);
        setLogs(prev => {
          const updated = [...prev, entry];
          if (updated.length > maxLogs) {
            return updated.slice(-maxLogs);
          }
          return updated;
        });
      }
    ).then((fn) => {
      unlisten = fn;
    });

    info("frontend", "Logger initialized");

    return () => {
      unlisten?.();
    };
  }, [info]);

  return (
    <LoggerContext.Provider value={{ logs, debug, info, warn, error, clearLogs }}>
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
