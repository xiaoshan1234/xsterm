import { describe, expect, it } from "vitest";
import { narrowToLiteral, parseOptionalInt } from "./formParsers";

describe("parseOptionalInt", () => {
  it("returns undefined for an empty string", () => {
    expect(parseOptionalInt("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only input", () => {
    expect(parseOptionalInt("   ")).toBeUndefined();
  });

  it("parses a positive integer", () => {
    expect(parseOptionalInt("42")).toBe(42);
  });

  it("parses zero", () => {
    expect(parseOptionalInt("0")).toBe(0);
  });

  it("parses a negative integer", () => {
    expect(parseOptionalInt("-7")).toBe(-7);
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseOptionalInt("  15  ")).toBe(15);
  });

  it("returns undefined for non-numeric input", () => {
    expect(parseOptionalInt("abc")).toBeUndefined();
  });

  it("parses only the leading integer from mixed input", () => {
    expect(parseOptionalInt("12abc")).toBe(12);
  });

  it("parses the leading integer when extra dots follow (parseInt stops at the first non-digit)", () => {
    expect(parseOptionalInt("1.2.3")).toBe(1);
  });

  it("returns undefined for input that starts with a non-digit", () => {
    expect(parseOptionalInt(".5")).toBeUndefined();
  });
});

describe("narrowToLiteral", () => {
  const KEY_ACTION = [
    { value: "auto" as const, label: "Auto" },
    { value: "backspace" as const, label: "Backspace" },
    { value: "delete" as const, label: "Delete" },
  ];

  it("returns the matching literal value", () => {
    expect(narrowToLiteral("backspace", KEY_ACTION)).toBe("backspace");
  });

  it("falls back to the first option when the value is not in the list", () => {
    expect(narrowToLiteral("unknown", KEY_ACTION)).toBe("auto");
  });

  it("falls back to the first option for empty input", () => {
    expect(narrowToLiteral("", KEY_ACTION)).toBe("auto");
  });

  it("preserves the literal type for valid values", () => {
    const result: "auto" | "backspace" | "delete" = narrowToLiteral("delete", KEY_ACTION);
    expect(result).toBe("delete");
  });
});
