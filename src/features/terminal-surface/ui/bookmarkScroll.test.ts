import { describe, expect, it } from "vitest";
import { findLineIndexByText, scrollToBookmarkLine } from "./bookmarkScroll";

function makeLine(text: string) {
  return { translateToString: () => text };
}

function makeTerm(lines: string[], baseY = 0) {
  const scrolled: number[] = [];
  const term = {
    buffer: {
      active: {
        baseY,
        length: lines.length,
        getLine: (y: number) => {
          const index = y - baseY;
          return lines[index] === undefined ? undefined : makeLine(lines[index]);
        },
      },
    },
    scrollToLine: (y: number) => {
      scrolled.push(y);
    },
  };
  return { term, scrolled };
}

describe("bookmarkScroll", () => {
  it("finds a line by its text", () => {
    const { term } = makeTerm(["$ ls", "result", "$ pwd"]);
    expect(findLineIndexByText(term as never, "result")).toBe(1);
  });

  it("scrolls to the bookmarked line when it still exists", () => {
    const { term, scrolled } = makeTerm(["a", "b", "c"]);
    expect(scrollToBookmarkLine(term as never, { line: 2, text: "c" })).toBe(true);
    expect(scrolled).toEqual([2]);
  });

  it("falls back to a content search when the line was trimmed", () => {
    // baseY = 5 simulates five lines already trimmed from the top.
    const { term, scrolled } = makeTerm(["x", "y", "needle"], 5);
    expect(scrollToBookmarkLine(term as never, { line: 4, text: "needle" })).toBe(true);
    expect(scrolled).toEqual([7]);
  });
});
