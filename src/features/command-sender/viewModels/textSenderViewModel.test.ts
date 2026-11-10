import { describe, expect, it } from "vitest";
import {
  getSenderIntervalMs,
  normalizeSenderRate,
  splitTextForSender,
} from "./textSenderViewModel";

describe("textSenderViewModel", () => {
  it("terminates line-mode chunks with a terminal Enter carriage return", () => {
    expect(splitTextForSender("first\nsecond\n", "line")).toEqual(["first\r", "second\r"]);
    expect(splitTextForSender("first\n\nsecond", "line")).toEqual(["first\r", "\r", "second\r"]);
    expect(splitTextForSender("first\r\nsecond", "line")).toEqual(["first\r", "second\r"]);
  });

  it("splits character mode by Unicode code point and converts newlines to Enter", () => {
    expect(splitTextForSender("a😀\r\n", "character")).toEqual(["a", "😀", "\r"]);
  });

  it("normalizes sender rates and derives the interval", () => {
    expect(normalizeSenderRate(0)).toBe(1);
    expect(normalizeSenderRate(2000)).toBe(1000);
    expect(getSenderIntervalMs(50)).toBe(20);
  });
});
