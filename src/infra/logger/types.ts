/**
 * Frontend log entry types. Mirrors `src/types/log.ts` (which stays in
 * place for legacy callers until Commit 6 deletes it).
 */

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

export interface LogEntry {
  level: LogLevel;
  source: "frontend" | "backend" | "session";
  message: string;
  data?: unknown;
}

export interface LoggerConfig {
  maxFileSize: number; // MB
  maxLogFiles: number;
  logLevel: LogLevel;
}

export interface Logger {
  debug: (source: string, message: string, data?: unknown) => void;
  info: (source: string, message: string, data?: unknown) => void;
  warn: (source: string, message: string, data?: unknown) => void;
  error: (source: string, message: string, data?: unknown) => void;
}
