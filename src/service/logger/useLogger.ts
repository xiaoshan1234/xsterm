/**
 * `useLogger` hook — replaces the legacy `useLogger()` import that
 * bridges used to pull from `src/service/legacy/contexts/LoggerContext`.
 *
 * Wraps the infra `logger` singleton with the same `{ debug, info,
 * warn, error }` surface the legacy context exposed, plus a level
 * filter driven by `useLoggerStore.effectiveLevel` so the bridges'
 * debug output is suppressed when the user has raised the effective
 * level (matching legacy behavior).
 *
 * The legacy `LoggerProvider` continues to exist (Commit 6 will delete
 * it) and still injects its own `logger` for UI components; bridges
 * are non-legacy service code and must not import from the shim.
 */
import { useMemo } from "react";
import { logger as infraLogger, LogLevel } from "../../infra/logger";
import { useLoggerStore } from "./store";

export interface LoggerHandle {
  debug: (source: string, message: string, data?: unknown) => void;
  info: (source: string, message: string, data?: unknown) => void;
  warn: (source: string, message: string, data?: unknown) => void;
  error: (source: string, message: string, data?: unknown) => void;
}

export function useLogger(): LoggerHandle {
  const effectiveLevel = useLoggerStore((s) => s.effectiveLevel);
  return useMemo<LoggerHandle>(
    () => ({
      debug: (source, message, data) => {
        if (LogLevel.DEBUG < effectiveLevel) return;
        infraLogger.debug(source, message, data);
      },
      info: (source, message, data) => {
        if (LogLevel.INFO < effectiveLevel) return;
        infraLogger.info(source, message, data);
      },
      warn: (source, message, data) => infraLogger.warn(source, message, data),
      error: (source, message, data) => infraLogger.error(source, message, data),
    }),
    [effectiveLevel],
  );
}
