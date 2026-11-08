import { describe, expect, it } from "vitest";
import { type ModelResult } from "../result";
import { createShellEnvironmentConfig, mergeShellEnvironment } from "./ShellEnvironmentConfig";

function unwrap<Value>(result: ModelResult<Value>): Value {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe("ShellEnvironmentConfig", () => {
  it("inherits the parent environment and applies shell overrides", () => {
    const environment = unwrap(
      createShellEnvironmentConfig({
        variables: {
          PATH: "/custom/bin",
          PROJECT_MODE: "development",
        },
      }),
    );

    const merged = mergeShellEnvironment(
      {
        PATH: "/usr/bin",
        HOME: "/home/user",
      },
      environment,
    );

    expect(merged).toMatchObject({
      PATH: "/custom/bin",
      HOME: "/home/user",
      PROJECT_MODE: "development",
    });
  });

  it("can start without the parent environment", () => {
    const environment = unwrap(
      createShellEnvironmentConfig({
        inheritParent: false,
        variables: { ONLY_THIS: "1" },
      }),
    );

    expect(mergeShellEnvironment({ HOME: "/home/user" }, environment)).toMatchObject({
      ONLY_THIS: "1",
    });
    expect(mergeShellEnvironment({ HOME: "/home/user" }, environment)).not.toHaveProperty("HOME");
  });

  it("rejects invalid and case-insensitive duplicate names", () => {
    expect(
      createShellEnvironmentConfig({
        nameCase: "insensitive",
        variables: { PATH: "/a", Path: "/b" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-value" },
    });

    expect(
      createShellEnvironmentConfig({
        variables: { "INVALID=NAME": "value" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-value" },
    });
  });

  it("replaces inherited variables case-insensitively when configured", () => {
    const environment = unwrap(
      createShellEnvironmentConfig({
        nameCase: "insensitive",
        variables: {
          Path: "C:\\Custom",
        },
      }),
    );
    const merged = mergeShellEnvironment(
      {
        PATH: "C:\\Windows",
        HOME: "C:\\Users\\developer",
      },
      environment,
    );

    expect(merged).toMatchObject({
      Path: "C:\\Custom",
      HOME: "C:\\Users\\developer",
    });
    expect(merged).not.toHaveProperty("PATH");
  });
});
