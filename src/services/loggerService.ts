import { invoke } from "@tauri-apps/api/core";

enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40,
};

export interface Logger {
  debug: (source: string, message: string, data?: unknown) => void;
  info: (source: string, message: string, data?: unknown) => void;
  warn: (source: string, message: string, data?: unknown) => void;
  error: (source: string, message: string, data?: unknown) => void;
}

/** Mirrors the backend `LogConfig` (camelCase). */
export interface LogConfig {
  maxFileSize: number;
  maxLogFiles: number;
  logLevel: string;
}

/**
 * Minimum backend level frontend messages must reach before being forwarded
 * over IPC. The backend `EnvFilter` would drop anything below it anyway, so
 * this client-side gate avoids paying an invoke round-trip per dropped
 * message. Refreshed from `get_log_config` / `set_log_config`.
 */
let backendMinLevel: LogLevel = import.meta.env.PROD ? LogLevel.WARN : LogLevel.DEBUG;

function parseLogLevel(level: string): LogLevel | null {
  const normalized = level.trim().toLowerCase();
  if (normalized === LogLevel.DEBUG) return LogLevel.DEBUG;
  if (normalized === LogLevel.INFO) return LogLevel.INFO;
  if (normalized === LogLevel.WARN) return LogLevel.WARN;
  if (normalized === LogLevel.ERROR) return LogLevel.ERROR;
  return null;
}

/** Apply the backend log level so frontend forwarding matches the backend filter. */
export function applyLogLevel(level: string): void {
  const parsed = parseLogLevel(level);
  if (parsed) {
    backendMinLevel = parsed;
  }
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
  const prefix = `[${source}]`;

  // Console output stays quiet for debug/info in production builds.
  const showInConsole =
    !import.meta.env.PROD || (level !== LogLevel.DEBUG && level !== LogLevel.INFO);
  if (showInConsole) {
    consoleLog(level, prefix, message, data);
  }

  // Backend forwarding is governed by the cached backend level, not the
  // console gate: raising the log level in settings must let frontend
  // debug/info reach the backend even in production.
  if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[backendMinLevel]) {
    return;
  }

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

/** Load the persisted debug log configuration and apply its level. */
export async function getLogConfig(): Promise<LogConfig> {
  const config = await invoke<LogConfig>("get_log_config");
  applyLogLevel(config.logLevel);
  return config;
}

/** Save the debug log configuration and apply its level immediately. */
export async function setLogConfig(config: LogConfig): Promise<void> {
  await invoke("set_log_config", { config });
  applyLogLevel(config.logLevel);
}

/** Return the backend debug log directory path. */
export async function getLogDir(): Promise<string> {
  return invoke<string>("get_log_dir");
}
