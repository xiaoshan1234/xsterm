import { describe, expect, it } from "vitest";
import {
  applyPasteTransforms,
  countTabs,
  DEFAULT_PASTE_OPTIONS,
  DEFAULT_TAB_WIDTH,
  patchPasteOptions,
  type PasteConfirmOptions,
} from "./pasteConfirm";
import { convertTabs, convertLineEndings } from "../../utils/textTransform";

describe("DEFAULT_PASTE_OPTIONS", () => {
  it("enables both conversions by default", () => {
    expect(DEFAULT_PASTE_OPTIONS.convertTabs).toBe(true);
    expect(DEFAULT_PASTE_OPTIONS.convertLineEndings).toBe(true);
  });

  it("uses a sensible default tab width", () => {
    expect(DEFAULT_PASTE_OPTIONS.spacesPerTab).toBe(DEFAULT_TAB_WIDTH);
    expect(DEFAULT_TAB_WIDTH).toBe(4);
  });
});

describe("countTabs", () => {
  it("returns 0 for empty string", () => {
    expect(countTabs("")).toBe(0);
  });

  it("counts tabs anywhere in the string", () => {
    expect(countTabs("a\tb\t\tc")).toBe(3);
  });

  it("returns 0 when there are no tabs", () => {
    expect(countTabs("hello world")).toBe(0);
  });

  it("ignores other whitespace", () => {
    expect(countTabs("a  \tb\n\rc")).toBe(1);
  });
});

describe("applyPasteTransforms", () => {
  const sample = "a\tb\nc\rd";

  it("applies both when both flags are on", () => {
    const out = applyPasteTransforms(sample, {
      convertTabs: true,
      spacesPerTab: 4,
      convertLineEndings: true,
    });
    // Tabs expanded to 4 spaces, newlines all collapsed to \r.
    expect(out).toBe(convertLineEndings(convertTabs(sample, 4)));
  });

  it("returns text unchanged when both flags are off", () => {
    const out = applyPasteTransforms(sample, {
      convertTabs: false,
      spacesPerTab: 4,
      convertLineEndings: false,
    });
    expect(out).toBe(sample);
  });

  it("skips tab expansion when checkbox is off but spacesPerTab > 0", () => {
    const out = applyPasteTransforms("a\tb", {
      convertTabs: false,
      spacesPerTab: 4,
      convertLineEndings: false,
    });
    expect(out).toBe("a\tb");
  });

  it("applies tabs first, then line endings (ordering matters)", () => {
    // A line that begins with a tab: "\tfoo\n" — if we ran line endings
    // first, the trailing \n is collapsed to \r; if we ran tabs first, the
    // \t becomes spaces (no \n to collapse). Order must be tabs → LE.
    const out = applyPasteTransforms("\tfoo\n", {
      convertTabs: true,
      spacesPerTab: 2,
      convertLineEndings: true,
    });
    expect(out).toBe("  foo\r");
  });

  it("skips tab expansion when spacesPerTab is 0 even if checkbox is on", () => {
    // convertTabs guards against <= 0 internally.
    const out = applyPasteTransforms("a\tb", {
      convertTabs: true,
      spacesPerTab: 0,
      convertLineEndings: false,
    });
    expect(out).toBe("a\tb");
  });
});

describe("patchPasteOptions", () => {
  it("merges a single-field patch", () => {
    const next = patchPasteOptions(DEFAULT_PASTE_OPTIONS, { convertTabs: false });
    expect(next).toEqual({ ...DEFAULT_PASTE_OPTIONS, convertTabs: false });
  });

  it("does not mutate the previous state", () => {
    const prev: PasteConfirmOptions = { ...DEFAULT_PASTE_OPTIONS };
    patchPasteOptions(prev, { spacesPerTab: 8 });
    expect(prev.spacesPerTab).toBe(DEFAULT_TAB_WIDTH);
  });

  it("supports multi-field patches", () => {
    const next = patchPasteOptions(DEFAULT_PASTE_OPTIONS, {
      convertTabs: false,
      convertLineEndings: false,
      spacesPerTab: 8,
    });
    expect(next).toEqual({
      convertTabs: false,
      convertLineEndings: false,
      spacesPerTab: 8,
    });
  });

  it("returns a new object identity (so React state updates fire)", () => {
    const next = patchPasteOptions(DEFAULT_PASTE_OPTIONS, {});
    expect(next).not.toBe(DEFAULT_PASTE_OPTIONS);
    expect(next).toEqual(DEFAULT_PASTE_OPTIONS);
  });
});