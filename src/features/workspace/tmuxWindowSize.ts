import { type PaneNode } from "../../models/legacy/terminal";

export interface TerminalSize {
  rows: number;
  cols: number;
}

export interface WindowSize {
  cols: number;
  rows: number;
}

/**
 * Compute the tmux window bounding box from the frontend pane tree.
 * Horizontal splits add columns; vertical splits add rows.
 */
export function computeTmuxWindowSize(
  node: PaneNode,
  sizes: ReadonlyMap<number, TerminalSize>,
): WindowSize | null {
  if (node.type === "leaf") {
    if (node.terminalId === undefined) return null;
    return sizes.get(node.terminalId) ?? null;
  }

  const children = node.children ?? [];
  if (children.length < 2) return null;
  const first = computeTmuxWindowSize(children[0], sizes);
  const second = computeTmuxWindowSize(children[1], sizes);
  if (!first || !second) return null;

  if (node.direction === "horizontal") {
    return {
      // tmux draws a one-cell border between split panes.
      cols: first.cols + second.cols + 1,
      rows: Math.max(first.rows, second.rows),
    };
  }
  return {
    cols: Math.max(first.cols, second.cols),
    rows: first.rows + second.rows + 1,
  };
}
