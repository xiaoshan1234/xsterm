/**
 * Standalone structured logger used by the `infra/` layer (and any
 * downstream layer that wants to log without depending on React).
 *
 * Mirrors the public surface of the legacy `logger` singleton in
 * `src/contexts/LoggerContext.tsx`, but without the React dependency
 * and without the mutation-on-mount pattern. The legacy LoggerProvider
 * keeps a separate `logger` (which it overwrites in `useEffect`) so the
 * existing component tree is unaffected; once Commit 6 deletes the
 * legacy file, the entire app routes through this module.
 */

import { invoke } from "@tauri-apps/api/core";
import { LogLevel } from "./types";
import type { Logger } from "./types";

function consoleLog(level: LogLevel, prefix: string, message: string, data?: unknown): void {
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

function forward(level: LogLevel, source: string, message: string, data?: unknown): void {
  if (import.meta.env.PROD && (level === LogLevel.DEBUG || level === LogLevel.INFO)) {
    return;
  }
  invoke("log_message", {
    level: level.toUpperCase(),
    source,
    message,
    data: data ? JSON.stringify(data) : null,
  }).catch(() => {
    // Backend logging is best-effort; never throw from the logger.
  });
}

function emit(level: LogLevel, source: string, message: string, data?: unknown): void {
  const prefix = `[FE] [${source}]`;
  consoleLog(level, prefix, message, data);
  forward(level, source, message, data);
}

export const logger: Logger = {
  debug: (source, message, data) => emit(LogLevel.DEBUG, source, message, data),
  info: (source, message, data) => emit(LogLevel.INFO, source, message, data),
  warn: (source, message, data) => emit(LogLevel.WARN, source, message, data),
  error: (source, message, data) => emit(LogLevel.ERROR, source, message, data),
};
