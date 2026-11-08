import { invoke } from "@tauri-apps/api/core";
import { LOG_LEVEL_ORDER, LogLevel, parseLogLevel } from "./logLevel";

export interface LogConfigDto {
  maxFileSize: number;
  maxLogFiles: number;
  logLevel: string;
}

export interface Logger {
  debug(source: string, message: string, data?: unknown): void;
  info(source: string, message: string, data?: unknown): void;
  warn(source: string, message: string, data?: unknown): void;
  error(source: string, message: string, data?: unknown): void;
}

export interface FrontendLogger extends Logger {
  applyLogLevel(level: string): void;
  getLogConfig(): Promise<LogConfigDto>;
  setLogConfig(config: LogConfigDto): Promise<void>;
  getLogDir(): Promise<string>;
}

type InvokeFunction = <Value>(command: string, args?: Record<string, unknown>) => Promise<Value>;

interface LoggerConsole {
  debug(...data: unknown[]): void;
  info(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
}

export interface CreateFrontendLoggerOptions {
  invokeFunction?: InvokeFunction;
  isProduction?: boolean;
  loggerConsole?: LoggerConsole;
}

export function createFrontendLogger(options: CreateFrontendLoggerOptions = {}): FrontendLogger {
  const invokeFunction = options.invokeFunction ?? defaultInvoke;
  const isProduction = options.isProduction ?? import.meta.env.PROD;
  const loggerConsole = options.loggerConsole ?? console;
  let minimumBackendLevel = isProduction ? LogLevel.WARN : LogLevel.DEBUG;

  function applyLevel(level: string): void {
    const parsedLevel = parseLogLevel(level);
    if (parsedLevel) {
      minimumBackendLevel = parsedLevel;
    }
  }

  function writeLog(level: LogLevel, source: string, message: string, data?: unknown): void {
    const prefix = `[${source}]`;
    const showInConsole = !isProduction || (level !== LogLevel.DEBUG && level !== LogLevel.INFO);

    if (showInConsole) {
      const args = data === undefined ? [prefix, message] : [prefix, message, data];
      loggerConsole[level](...args);
    }

    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[minimumBackendLevel]) {
      return;
    }

    invokeFunction<void>("log_message", {
      level: level.toUpperCase(),
      source,
      message,
      data: data === undefined ? null : JSON.stringify(data),
    }).catch(() => {
      // Logging must never interfere with application operation.
    });
  }

  return {
    debug: (source, message, data) => writeLog(LogLevel.DEBUG, source, message, data),
    info: (source, message, data) => writeLog(LogLevel.INFO, source, message, data),
    warn: (source, message, data) => writeLog(LogLevel.WARN, source, message, data),
    error: (source, message, data) => writeLog(LogLevel.ERROR, source, message, data),

    applyLogLevel: applyLevel,

    async getLogConfig(): Promise<LogConfigDto> {
      const config = await invokeFunction<LogConfigDto>("get_log_config");
      applyLevel(config.logLevel);
      return config;
    },

    async setLogConfig(config: LogConfigDto): Promise<void> {
      await invokeFunction<void>("set_log_config", { config });
      applyLevel(config.logLevel);
    },

    getLogDir(): Promise<string> {
      return invokeFunction<string>("get_log_dir");
    },
  };
}

async function defaultInvoke<Value>(
  command: string,
  args?: Record<string, unknown>,
): Promise<Value> {
  return invoke<Value>(command, args);
}

export const frontendLogger = createFrontendLogger();
