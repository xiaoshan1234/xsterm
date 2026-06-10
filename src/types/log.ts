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
  maxFileSize: number;   // MB
  maxLogFiles: number;
  logLevel: LogLevel;
}
