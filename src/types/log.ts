export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  source: "frontend" | "backend" | "session";
  message: string;
  data?: unknown;
}

export interface LoggerConfig {
  maxEntries: number;
  enableConsole: boolean;
  enableBackend: boolean;
}
