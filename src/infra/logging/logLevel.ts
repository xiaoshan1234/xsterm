export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

export const LOG_LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40,
};

export function parseLogLevel(value: string): LogLevel | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === LogLevel.DEBUG) return LogLevel.DEBUG;
  if (normalized === LogLevel.INFO) return LogLevel.INFO;
  if (normalized === LogLevel.WARN) return LogLevel.WARN;
  if (normalized === LogLevel.ERROR) return LogLevel.ERROR;
  return null;
}
