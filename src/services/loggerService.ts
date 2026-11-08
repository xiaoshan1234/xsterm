import { invoke } from "@tauri-apps/api/core";
import { LogLevel } from "../types/log";

export interface Logger {
  debug: (source: string, message: string, data?: unknown) => void;
  info: (source: string, message: string, data?: unknown) => void;
  warn: (source: string, message: string, data?: unknown) => void;
  error: (source: string, message: string, data?: unknown) => void;
}

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

function log(level: LogLevel, source: string, message: string, data?: unknown): void {
  if (import.meta.env.PROD && (level === LogLevel.DEBUG || level === LogLevel.INFO)) {
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
}

export const logger: Logger = {
  debug: (source, message, data) => log(LogLevel.DEBUG, source, message, data),
  info: (source, message, data) => log(LogLevel.INFO, source, message, data),
  warn: (source, message, data) => log(LogLevel.WARN, source, message, data),
  error: (source, message, data) => log(LogLevel.ERROR, source, message, data),
};
