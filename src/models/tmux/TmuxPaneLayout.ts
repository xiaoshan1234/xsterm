import { type TmuxPaneId } from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";

export type TmuxPaneDirection = "horizontal" | "vertical";

export interface TmuxPaneLeaf {
  readonly kind: "leaf";
  readonly paneId: TmuxPaneId;
}

export interface TmuxPaneSplit {
  readonly kind: "split";
  readonly direction: TmuxPaneDirection;
  /** The first child's proportion, from 0.1 to 0.9. */
  readonly ratio: number;
  readonly children: readonly [TmuxPaneNode, TmuxPaneNode];
}

export type TmuxPaneNode = TmuxPaneLeaf | TmuxPaneSplit;

export function createTmuxPaneLeaf(paneId: TmuxPaneId): TmuxPaneLeaf {
  return {
    kind: "leaf",
    paneId,
  };
}

export function createTmuxPaneSplit(
  direction: TmuxPaneDirection,
  ratio: number,
  first: TmuxPaneNode,
  second: TmuxPaneNode,
): ModelResult<TmuxPaneSplit> {
  if (!Number.isFinite(ratio) || ratio < 0.1 || ratio > 0.9) {
    return modelFailure("invalid-layout", "tmux split ratio must be between 0.1 and 0.9");
  }

  const paneIds = [...collectTmuxPaneIds(first), ...collectTmuxPaneIds(second)];
  if (new Set(paneIds).size !== paneIds.length) {
    return modelFailure("duplicate-id", "tmux pane appears more than once in a layout");
  }

  return modelSuccess({
    kind: "split",
    direction,
    ratio,
    children: [first, second],
  });
}

export function collectTmuxPaneIds(node: TmuxPaneNode): TmuxPaneId[] {
  if (node.kind === "leaf") {
    return [node.paneId];
  }

  return [...collectTmuxPaneIds(node.children[0]), ...collectTmuxPaneIds(node.children[1])];
}

export function findTmuxPaneLeaf(node: TmuxPaneNode, paneId: TmuxPaneId): TmuxPaneLeaf | null {
  if (node.kind === "leaf") {
    return node.paneId === paneId ? node : null;
  }

  return findTmuxPaneLeaf(node.children[0], paneId) ?? findTmuxPaneLeaf(node.children[1], paneId);
}

export function replaceTmuxPaneLayout(
  node: TmuxPaneNode,
  paneId: TmuxPaneId,
  replacement: TmuxPaneNode,
): TmuxPaneNode {
  if (node.kind === "leaf") {
    return node.paneId === paneId ? replacement : node;
  }

  return {
    ...node,
    children: [
      replaceTmuxPaneLayout(node.children[0], paneId, replacement),
      replaceTmuxPaneLayout(node.children[1], paneId, replacement),
    ],
  };
}

export function removeTmuxPaneFromLayout(
  node: TmuxPaneNode,
  paneId: TmuxPaneId,
): TmuxPaneNode | null {
  if (node.kind === "leaf") {
    return node.paneId === paneId ? null : node;
  }

  const first = removeTmuxPaneFromLayout(node.children[0], paneId);
  const second = removeTmuxPaneFromLayout(node.children[1], paneId);

  if (first === null) return second;
  if (second === null) return first;
  return { ...node, children: [first, second] };
}
