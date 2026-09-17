/**
 * Logger service store — log-level config + sink registry.
 *
 * **Scope**: the on-disk log settings the user can tune via the
 * settings dialog (max file size, max log files, log level).
 * The actual `Logger` instance lives in `infra/logger/logger.ts`
 * (it already invokes `log_message` to forward to the Rust
 * backend). This store just exposes the config knobs to the
 * settings UI and provides a stable action surface for the
 * loggerBridge to push log entries into the bridge bus.
 */
import { create } from "zustand";
import { LogLevel, type LoggerConfig } from "../../infra/logger/types";

export interface LoggerStoreState {
  /** On-disk log config (mirrored from settings.json). */
  config: LoggerConfig;
  setConfig: (config: Partial<LoggerConfig>) => void;

  /** Convenience: minimum log level for console + IPC forwarding. */
  effectiveLevel: LogLevel;
  setEffectiveLevel: (level: LogLevel) => void;

  reset: () => void;
}

const defaultConfig: LoggerConfig = {
  maxFileSize: 10,
  maxLogFiles: 5,
  logLevel: LogLevel.INFO,
};

export const useLoggerStore = create<LoggerStoreState>((set, get) => ({
  config: defaultConfig,
  setConfig: (partial) => {
    const next = { ...get().config, ...partial };
    set({ config: next });
  },
  effectiveLevel: defaultConfig.logLevel,
  setEffectiveLevel: (level) => {
    set({ effectiveLevel: level });
    set({ config: { ...get().config, logLevel: level } });
  },
  reset: () => set({ config: defaultConfig, effectiveLevel: defaultConfig.logLevel }),
}));
