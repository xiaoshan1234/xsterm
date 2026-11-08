import { describe, expect, it } from "vitest";
import { type ModelResult } from "../result";
import { createTerminal, updateTerminalDisplayConfig } from "./Terminal";

function unwrap<Value>(result: ModelResult<Value>): Value {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe("Terminal", () => {
  it("always has a resolved display config", () => {
    const terminal = unwrap(
      createTerminal({
        id: 10,
        configId: null,
        title: "PowerShell",
        transport: {
          kind: "local",
          shell: "powershell.exe",
        },
      }),
    );

    expect(terminal.displayConfig).toMatchObject({
      fontSize: 14,
      showLineNumbers: true,
      sizingMode: { kind: "auto" },
    });
  });

  it("applies runtime display overrides without changing its identity", () => {
    const terminal = unwrap(
      createTerminal({
        id: 11,
        configId: "config-1",
        title: "SSH",
        transport: {
          kind: "ssh",
          host: "example.com",
          port: 22,
          username: "developer",
        },
      }),
    );
    const updated = unwrap(
      updateTerminalDisplayConfig(terminal, {
        fontSize: 18,
        cursorStyle: "bar",
      }),
    );

    expect(updated.id).toBe(terminal.id);
    expect(updated.displayConfig.fontSize).toBe(18);
    expect(updated.displayConfig.cursorStyle).toBe("bar");
    expect(updated.configId).toBe(terminal.configId);
  });
});
