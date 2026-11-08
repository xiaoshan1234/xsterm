import { describe, expect, it, vi } from "vitest";
import { createFrontendLogger, type LogConfigDto } from "./frontendLogger";

type InvokeFunction = <Value>(command: string, args?: Record<string, unknown>) => Promise<Value>;

function createInvokeSpy() {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const invokeFunction: InvokeFunction = async <Value>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<Value> => {
    calls.push({ command, args });
    if (command === "get_log_config") {
      return {
        maxFileSize: 10,
        maxLogFiles: 5,
        logLevel: "debug",
      } as Value;
    }
    return undefined as Value;
  };
  return { calls, invokeFunction };
}

describe("frontendLogger", () => {
  it("forwards levels that meet the backend minimum", () => {
    const { calls, invokeFunction } = createInvokeSpy();
    const logger = createFrontendLogger({
      invokeFunction,
      isProduction: true,
      loggerConsole: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    logger.debug("test", "hidden");
    logger.warn("test", "forwarded", { id: 1 });

    expect(calls).toEqual([
      {
        command: "log_message",
        args: {
          level: "WARN",
          source: "test",
          message: "forwarded",
          data: JSON.stringify({ id: 1 }),
        },
      },
    ]);
  });

  it("applies log config even when methods are destructured", async () => {
    const { calls, invokeFunction } = createInvokeSpy();
    const logger = createFrontendLogger({
      invokeFunction,
      isProduction: true,
      loggerConsole: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
    const { setLogConfig, debug } = logger;
    const config: LogConfigDto = {
      maxFileSize: 20,
      maxLogFiles: 4,
      logLevel: "debug",
    };

    await setLogConfig(config);
    debug("test", "visible-after-update");

    expect(calls[0]).toEqual({
      command: "set_log_config",
      args: { config },
    });
    expect(calls[1]).toMatchObject({
      command: "log_message",
      args: {
        level: "DEBUG",
        message: "visible-after-update",
      },
    });
  });

  it("refreshes the backend level when loading config", async () => {
    const { invokeFunction } = createInvokeSpy();
    const logger = createFrontendLogger({
      invokeFunction,
      isProduction: true,
      loggerConsole: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    const config = await logger.getLogConfig();

    expect(config.logLevel).toBe("debug");
  });
});
