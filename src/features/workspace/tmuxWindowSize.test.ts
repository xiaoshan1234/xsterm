import { describe, expect, it } from "vitest";
import { type PaneNode } from "../../models/legacy/terminal";
import { computeTmuxWindowSize, type TerminalSize } from "./tmuxWindowSize";

function leaf(id: string, terminalId: number): PaneNode {
  return { id, type: "leaf", size: 100, terminalId };
}

function split(
  id: string,
  direction: "horizontal" | "vertical",
  first: PaneNode,
  second: PaneNode,
): PaneNode {
  return { id, type: "split", direction, size: 100, children: [first, second] };
}

describe("computeTmuxWindowSize", () => {
  it("uses the leaf xterm dimensions", () => {
    const sizes = new Map<number, TerminalSize>([[1, { cols: 80, rows: 24 }]]);
    expect(computeTmuxWindowSize(leaf("a", 1), sizes)).toEqual({ cols: 80, rows: 24 });
  });

  it("sums columns for a horizontal split and takes the max rows", () => {
    const sizes = new Map<number, TerminalSize>([
      [1, { cols: 80, rows: 24 }],
      [2, { cols: 79, rows: 23 }],
    ]);
    const root = split("root", "horizontal", leaf("a", 1), leaf("b", 2));
    expect(computeTmuxWindowSize(root, sizes)).toEqual({ cols: 160, rows: 24 });
  });

  it("sums rows for a vertical split and takes the max columns", () => {
    const sizes = new Map<number, TerminalSize>([
      [1, { cols: 80, rows: 12 }],
      [2, { cols: 79, rows: 11 }],
    ]);
    const root = split("root", "vertical", leaf("a", 1), leaf("b", 2));
    expect(computeTmuxWindowSize(root, sizes)).toEqual({ cols: 80, rows: 24 });
  });

  it("handles nested splits", () => {
    const sizes = new Map<number, TerminalSize>([
      [1, { cols: 80, rows: 12 }],
      [2, { cols: 80, rows: 11 }],
      [3, { cols: 79, rows: 23 }],
    ]);
    const left = split("left", "vertical", leaf("a", 1), leaf("b", 2));
    const root = split("root", "horizontal", left, leaf("c", 3));
    expect(computeTmuxWindowSize(root, sizes)).toEqual({ cols: 160, rows: 24 });
  });

  it("returns null when a leaf has no reported size", () => {
    const sizes = new Map<number, TerminalSize>([[1, { cols: 80, rows: 24 }]]);
    const root = split("root", "horizontal", leaf("a", 1), leaf("b", 2));
    expect(computeTmuxWindowSize(root, sizes)).toBeNull();
  });
});
