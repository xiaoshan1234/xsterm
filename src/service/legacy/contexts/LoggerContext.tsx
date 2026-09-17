/**
 * LoggerContext — IPC-bridged logger with the level filter driven by
 * `src/service/logger/store.ts`.
 *
 * **Migration**: state was previously React-local. After Commit 3 it
 * lives in the logger Zustand store so the settings dialog and the
 * `LoggerBridge` can read/write it directly. This provider:
 *
 * 1. Subscribes to `useLoggerStore.getState().effectiveLevel` for the
 *    min-level filter (so production builds can suppress DEBUG/INFO).
 * 2. Owns the IPC `log_message` call to the Rust backend.
 * 3. Exposes the same `{ debug, info, warn, error }` API as before so
 *    the rest of the React tree doesn't change.
 */
import { createContext, useContext, useCallback, useEffect, type ReactNode } from "react";
// eslint-disable-next-line boundaries/dependencies -- legacy shim: tauri-apps IPC bridge before infra layer existed
import { invoke } from "@tauri-apps/api/core";
import { LogLevel } from "../types/log";
import { useLoggerStore } from "../../logger/store";

interface LoggerContextType {
  debug: (source: string, message: string, data?: unknown) => void;
  info: (source: string, message: string, data?: unknown) => void;
  warn: (source: string, message: string, data?: unknown) => void;
  error: (source: string, message: string, data?: unknown) => void;
}

const LoggerContext = createContext<LoggerContextType | null>(null);

/**
 * Global logger singleton, for use outside React context (e.g., service files).
 * LoggerProvider injects the actual implementation here once mounted.
 */
export const logger: LoggerContextType = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function consoleLog(level: LogLevel, prefix: string, message: string, data?: unknown) {
  const args = data === undefined ? [prefix, message] : [prefix, message, data];
  switch (level) {
    case LogLevel.DEBUG:
      console.debug(...args);
      break;
    case LogLevel.INFO:
      console.info(...args);
      break;
    case LogLevel.WARN:
      console.warn(...args);
      break;
    case LogLevel.ERROR:
      console.error(...args);
      break;
  }
}

export function LoggerProvider({ children }: { children: ReactNode }) {
  // Read the level filter from the logger store so the provider can
  // honour it on every render. (Commit 3 keeps this read-only here; the
  // bridge wires the persistence side-effect.)
  const effectiveLevel = useLoggerStore((s) => s.effectiveLevel);

  const log = useCallback(
    (level: LogLevel, source: string, message: string, data?: unknown) => {
      if (import.meta.env.PROD && (level === LogLevel.DEBUG || level === LogLevel.INFO)) {
        return;
      }

      // Drop logs below the user-configured effective level.
      if (level < effectiveLevel) {
        return;
      }

      const prefix = `[${source}]`;
      consoleLog(level, prefix, message, data);

      invoke("log_message", {
        level: level.toUpperCase(),
        source,
        message,
        data: data ? JSON.stringify(data) : null,
      }).catch(() => {});
    },
    [effectiveLevel],
  );

  const debug = useCallback(
    (source: string, message: string, data?: unknown) => {
      log(LogLevel.DEBUG, source, message, data);
    },
    [log],
  );

  const info = useCallback(
    (source: string, message: string, data?: unknown) => {
      log(LogLevel.INFO, source, message, data);
    },
    [log],
  );

  const warn = useCallback(
    (source: string, message: string, data?: unknown) => {
      log(LogLevel.WARN, source, message, data);
    },
    [log],
  );

  const error = useCallback(
    (source: string, message: string, data?: unknown) => {
      log(LogLevel.ERROR, source, message, data);
    },
    [log],
  );

  // Inject the actual implementation into the global logger singleton, so non-React modules (e.g., service files) can also use it.
  useEffect(() => {
    logger.debug = debug;
    logger.info = info;
    logger.warn = warn;
    logger.error = error;
  }, [debug, info, warn, error]);

  return (
    <LoggerContext.Provider value={{ debug, info, warn, error }}>{children}</LoggerContext.Provider>
  );
}

export function useLogger() {
  const context = useContext(LoggerContext);
  if (!context) {
    throw new Error("useLogger must be used within a LoggerProvider");
  }
  return context;
}