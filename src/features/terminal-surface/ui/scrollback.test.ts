import { describe, expect, it } from "vitest";
import { normalizeCapturedScrollback } from "./scrollback";

describe("normalizeCapturedScrollback", () => {
  it("converts bare line feeds to CRLF", () => {
    expect(normalizeCapturedScrollback("one\ntwo\nthree")).toBe("one\r\ntwo\r\nthree");
  });

  it("keeps existing CRLF intact", () => {
    expect(normalizeCapturedScrollback("one\r\ntwo")).toBe("one\r\ntwo");
  });

  it("preserves ANSI escape sequences and trailing blanks", () => {
    expect(normalizeCapturedScrollback("\u001b[32m$ echo hi\u001b[39m\nhi\n\n")).toBe(
      "\u001b[32m$ echo hi\u001b[39m\r\nhi\r\n\r\n",
    );
  });
});
