import { describe, expect, it } from "vitest";
import { type ModelResult } from "../result";
import {
  createDefaultTerminalDisplayConfig,
  resolveTerminalDisplayConfig,
} from "./TerminalDisplayConfig";
import { createFixedTerminalSizing } from "./TerminalSizingMode";

function unwrap<Value>(result: ModelResult<Value>): Value {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe("TerminalDisplayConfig", () => {
  it("layers saved and runtime overrides over global defaults", () => {
    const defaults = createDefaultTerminalDisplayConfig();
    const fixedSizing = unwrap(createFixedTerminalSizing(120, 40));

    const resolved = unwrap(
      resolveTerminalDisplayConfig(
        defaults,
        {
          fontSize: 16,
          fontFamily: "Cascadia Mono",
          showLineNumbers: false,
        },
        {
          fontSize: 18,
          sizingMode: fixedSizing,
        },
      ),
    );

    expect(resolved).toMatchObject({
      fontSize: 18,
      fontFamily: "Cascadia Mono",
      showLineNumbers: false,
      sizingMode: {
        kind: "fixed",
        columns: 120,
        rows: 40,
      },
    });
  });

  it("rejects invalid display values", () => {
    expect(
      resolveTerminalDisplayConfig(createDefaultTerminalDisplayConfig(), {
        fontSize: 4,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-value" },
    });

    expect(
      resolveTerminalDisplayConfig(createDefaultTerminalDisplayConfig(), {
        sizingMode: {
          kind: "fixed",
          columns: 0,
          rows: 24,
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-value" },
    });
  });
});
