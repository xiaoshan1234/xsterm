import { useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LogEntry, LogLevel, LoggerConfig } from "../types/log";

const DEFAULT_CONFIG: LoggerConfig = {
  maxEntries: 1000,
  enableConsole: true,
  enableBackend: true,
};

export function useLogger(config: Partial<LoggerConfig> = {}) {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const logsRef = useRef<LogEntry[]>([]);
  const idCounterRef = useRef(0);

  const addLog = useCallback(
    (level: LogLevel, source: LogEntry["source"], message: string, data?: unknown) => {
      const entry: LogEntry = {
        id: `log-${++idCounterRef.current}`,
        timestamp: new Date(),
        level,
        source,
        message,
        data,
      };

      logsRef.current.push(entry);

      // Trim if exceeds max
      if (logsRef.current.length > fullConfig.maxEntries) {
        logsRef.current = logsRef.current.slice(-fullConfig.maxEntries);
      }

      // Console output
      if (fullConfig.enableConsole) {
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
      }

      // Send to backend
      if (fullConfig.enableBackend) {
        invoke("log_message", {
          level: level.toUpperCase(),
          source,
          message,
          data: data ? JSON.stringify(data) : null,
        }).catch(() => {}); // Ignore backend errors
      }

      return entry;
    },
    [fullConfig]
  );

  const debug = useCallback(
    (source: LogEntry["source"], message: string, data?: unknown) =>
      addLog(LogLevel.DEBUG, source, message, data),
    [addLog]
  );

  const info = useCallback(
    (source: LogEntry["source"], message: string, data?: unknown) =>
      addLog(LogLevel.INFO, source, message, data),
    [addLog]
  );

  const warn = useCallback(
    (source: LogEntry["source"], message: string, data?: unknown) =>
      addLog(LogLevel.WARN, source, message, data),
    [addLog]
  );

  const error = useCallback(
    (source: LogEntry["source"], message: string, data?: unknown) =>
      addLog(LogLevel.ERROR, source, message, data),
    [addLog]
  );

  const getLogs = useCallback(() => logsRef.current, []);

  const clearLogs = useCallback(() => {
    logsRef.current = [];
  }, []);

  // Listen for backend logs
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<{ level: string; source: string; message: string; data?: string }>(
      "backend-log",
      (event) => {
        const { level, source, message, data } = event.payload;
        const logLevel = level.toLowerCase() as LogLevel;
        addLog(logLevel, source as LogEntry["source"], message, data ? JSON.parse(data) : undefined);
      }
    ).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [addLog]);

  return { debug, info, warn, error, getLogs, clearLogs };
}
