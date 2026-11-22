import { describe, expect, it } from "vitest";
import {
  type PromptJumpTerminal,
  encodeWheelDownSequence,
  readPromptFingerprint,
  screenContainsLine,
  screenSignature,
} from "./promptJump";

function makeLine(text: string) {
  return { translateToString: () => text };
}

function makeTerminal(
  lines: string[],
  overrides: Partial<PromptJumpTerminal["buffer"]["active"]> = {},
): PromptJumpTerminal {
  return {
    buffer: {
      active: {
        type: "alternate",
        baseY: 0,
        cursorY: lines.length - 1,
        length: lines.length,
        getLine: (y) => (lines[y] === undefined ? undefined : makeLine(lines[y])),
        ...overrides,
      },
    },
  };
}

describe("promptJump", () => {
  it("encodes a SGR wheel-down sequence", () => {
    expect(encodeWheelDownSequence(3, 7)).toBe("\x1b[<65;3;7M");
  });

  it("reads the cursor-line fingerprint from an alternate buffer", () => {
    const term = makeTerminal(["$ ls", "file-a", "file-b", "$ "], { cursorY: 3 });
    expect(readPromptFingerprint(term)).toBe("$ ");
  });

  it("matches a screen line exactly ignoring trailing whitespace", () => {
    const term = makeTerminal(["$ ls", "result  ", "$ "]);
    expect(screenContainsLine(term, "result")).toBe(true);
    expect(screenContainsLine(term, "res")).toBe(false);
    expect(screenContainsLine(term, "")).toBe(false);
  });

  it("builds a newline-joined screen signature", () => {
    const term = makeTerminal(["a", "b", "c"]);
    expect(screenSignature(term)).toBe("a\nb\nc");
  });
});
