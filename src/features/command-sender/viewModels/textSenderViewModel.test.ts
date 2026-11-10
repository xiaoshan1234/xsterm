import { describe, expect, it } from "vitest";
import {
  getSenderIntervalMs,
  normalizeSenderRate,
  splitTextForSender,
} from "./textSenderViewModel";

describe("textSenderViewModel", () => {
  it("splits line mode into newline-terminated chunks", () => {
    expect(splitTextForSender("first\nsecond\n", "line")).toEqual(["first\n", "second\n"]);
    expect(splitTextForSender("first\n\nsecond", "line")).toEqual(["first\n", "\n", "second\n"]);
  });

  it("splits character mode by Unicode code point", () => {
    expect(splitTextForSender("a😀\n", "character")).toEqual(["a", "😀", "\n"]);
  });

  it("normalizes sender rates and derives the interval", () => {
    expect(normalizeSenderRate(0)).toBe(1);
    expect(normalizeSenderRate(2000)).toBe(1000);
    expect(getSenderIntervalMs(50)).toBe(20);
  });
});
