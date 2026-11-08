import { describe, expect, it } from "vitest";
import { type ModelResult } from "../result";
import { createFixedTerminalSizing } from "../terminal/TerminalSizingMode";
import { createSavedLaunchConfig } from "./SavedLaunchConfig";
import {
  createLocalTerminalLaunchConfig,
  createSshTerminalLaunchConfig,
} from "./TerminalLaunchConfig";

function unwrap<Value>(result: ModelResult<Value>): Value {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe("TerminalLaunchConfig", () => {
  it("keeps shell environment and startup settings in the local launch config", () => {
    const config = unwrap(
      createLocalTerminalLaunchConfig({
        shell: "pwsh.exe",
        cwd: "C:\\work",
        environment: {
          variables: {
            PROJECT_MODE: "development",
          },
        },
        startupCommand: "git status",
        startupDelayMs: 250,
      }),
    );

    expect(config).toMatchObject({
      kind: "local",
      shell: "pwsh.exe",
      cwd: "C:\\work",
      environment: {
        inheritParent: true,
        variables: {
          PROJECT_MODE: "development",
        },
      },
      startupCommand: "git status",
      startupDelayMs: 250,
    });
  });

  it("keeps full SSH connection properties nested under the launch config", () => {
    const config = unwrap(
      createSshTerminalLaunchConfig({
        connection: {
          host: "example.com",
          port: 22,
          username: "developer",
          authentication: {
            kind: "private-key",
            keyFile: "~/.ssh/id_ed25519",
          },
          keepaliveIntervalSeconds: 30,
          connectionTimeoutSeconds: 10,
        },
        termType: "xterm-256color",
      }),
    );

    expect(config).toMatchObject({
      kind: "ssh",
      connection: {
        host: "example.com",
        port: 22,
        username: "developer",
        authentication: {
          kind: "private-key",
        },
        keepaliveIntervalSeconds: 30,
      },
      termType: "xterm-256color",
    });
  });

  it("stores display overrides separately from launch configuration", () => {
    const config = unwrap(
      createLocalTerminalLaunchConfig({
        shell: "bash",
      }),
    );
    const sizingMode = unwrap(createFixedTerminalSizing(100, 30));
    const saved = unwrap(
      createSavedLaunchConfig({
        id: "config-1",
        name: "Project Shell",
        config,
        displayConfig: {
          fontSize: 16,
          sizingMode,
        },
      }),
    );

    expect(saved.config).toEqual(config);
    expect(saved.displayConfig).toMatchObject({
      fontSize: 16,
      sizingMode: {
        kind: "fixed",
        columns: 100,
        rows: 30,
      },
    });
  });
});
