import { describe, expect, it } from "vitest";
import { convertLineEndings, convertTabs, countChars, countLines } from "./textTransform";

describe("convertTabs", () => {
  it("returns text unchanged when there are no tabs", () => {
    expect(convertTabs("hello world", 4)).toBe("hello world");
  });

  it("expands a single tab to N spaces", () => {
    expect(convertTabs("a\tb", 4)).toBe("a    b");
  });

  it("expands multiple tabs in one string", () => {
    expect(convertTabs("\t\tfoo\t", 2)).toBe("    foo  ");
  });

  it("uses the configured tab width exactly", () => {
    expect(convertTabs("\tx", 1)).toBe(" x");
    expect(convertTabs("\tx", 8)).toBe("        x");
  });

  it("treats spacesPerTab <= 0 as a no-op (defensive)", () => {
    expect(convertTabs("a\tb", 0)).toBe("a\tb");
    expect(convertTabs("a\tb", -1)).toBe("a\tb");
  });

  it("preserves multibyte characters untouched", () => {
    expect(convertTabs("中\t文", 4)).toBe("中    文");
    expect(convertTabs("😀\t😀", 2)).toBe("😀  😀");
  });

  it("returns empty input unchanged", () => {
    expect(convertTabs("", 4)).toBe("");
  });
});

describe("convertLineEndings", () => {
  it("returns text unchanged when there are no newlines", () => {
    expect(convertLineEndings("hello world")).toBe("hello world");
  });

  it("collapses LF to a single CR", () => {
    expect(convertLineEndings("a\nb\nc")).toBe("a\rb\rc");
  });

  it("collapses bare CR to itself (no double-CR)", () => {
    expect(convertLineEndings("a\rb\rc")).toBe("a\rb\rc");
  });

  it("collapses CRLF to a single CR (not two)", () => {
    expect(convertLineEndings("a\r\nb\r\nc")).toBe("a\rb\rc");
  });

  it("prefers CRLF over bare CR when both appear (CRLF is matched first)", () => {
    // "a\r\nb" — the \r\n is the separator, the \r is part of the LHS.
    expect(convertLineEndings("a\r\nb")).toBe("a\rb");
  });

  it("handles mixed line endings in a single string", () => {
    expect(convertLineEndings("a\nb\r\nc\rd")).toBe("a\rb\rc\rd");
  });

  it("preserves multibyte characters untouched", () => {
    expect(convertLineEndings("中\n文")).toBe("中\r文");
  });

  it("returns empty input unchanged", () => {
    expect(convertLineEndings("")).toBe("");
  });
});

describe("countLines", () => {
  it("treats empty string as a single (empty) line", () => {
    expect(countLines("")).toEqual([""]);
  });

  it("counts a single segment without newlines as one line", () => {
    expect(countLines("abc")).toEqual(["abc"]);
  });

  it("splits on LF by default", () => {
    expect(countLines("a\nb\nc")).toEqual(["a", "b", "c"]);
  });

  it("splits on CRLF when present", () => {
    expect(countLines("a\r\nb\r\nc")).toEqual(["a", "b", "c"]);
  });

  it("splits on bare CR when present", () => {
    expect(countLines("a\rb\rc")).toEqual(["a", "b", "c"]);
  });

  it("CRLF wins over bare CR in mixed input", () => {
    // The first CRLF boundary dictates the split; the remaining bare CR in
    // "b\rc" survives as part of the middle element.
    expect(countLines("a\r\nb\rc")).toEqual(["a", "b\rc"]);
  });

  it("counts a trailing newline as an extra empty line", () => {
    expect(countLines("a\n")).toEqual(["a", ""]);
    expect(countLines("a\nb\n")).toEqual(["a", "b", ""]);
  });
});

describe("countChars", () => {
  it("returns 0 for empty string", () => {
    expect(countChars("")).toBe(0);
  });

  it("returns the string length for ASCII", () => {
    expect(countChars("abc")).toBe(3);
  });

  it("uses JS string length (UTF-16 code units, not codepoints)", () => {
    // "中" is 1 code unit in BMP, but 😀 is 2 (surrogate pair).
    expect(countChars("中")).toBe(1);
    expect(countChars("😀")).toBe(2);
  });

  it("counts whitespace and newlines", () => {
    expect(countChars("a b\nc")).toBe(5);
  });
});