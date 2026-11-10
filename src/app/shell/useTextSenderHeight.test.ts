import { describe, expect, it } from "vitest";
import {
  clampTextSenderHeight,
  DEFAULT_TEXT_SENDER_HEIGHT,
  MAX_TEXT_SENDER_HEIGHT,
  MIN_TEXT_SENDER_HEIGHT,
} from "./useTextSenderHeight";

describe("clampTextSenderHeight", () => {
  it("keeps heights inside the Sender panel bounds", () => {
    expect(clampTextSenderHeight(100)).toBe(MIN_TEXT_SENDER_HEIGHT);
    expect(clampTextSenderHeight(360)).toBe(360);
    expect(clampTextSenderHeight(900)).toBe(MAX_TEXT_SENDER_HEIGHT);
  });

  it("falls back to the default for invalid values", () => {
    expect(clampTextSenderHeight(Number.NaN)).toBe(DEFAULT_TEXT_SENDER_HEIGHT);
  });
});
