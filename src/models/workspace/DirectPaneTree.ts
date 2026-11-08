import { type PaneId, type TerminalId, createPaneId } from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";

export type DirectPaneDirection = "horizontal" | "vertical";

export type DirectPaneContent =
  | { readonly kind: "empty" }
  | {
      readonly kind: "terminal";
      readonly terminalId: TerminalId;
    };

export interface DirectPaneLeaf {
  readonly kind: "leaf";
  readonly id: PaneId;
  readonly content: DirectPaneContent;
}

export interface DirectPaneSplit {
  readonly kind: "split";
  readonly id: PaneId;
  readonly direction: DirectPaneDirection;
  /** The first child's proportion, from 0.1 to 0.9. */
  readonly ratio: number;
  readonly children: readonly [DirectPaneNode, DirectPaneNode];
}

export type DirectPaneNode = DirectPaneLeaf | DirectPaneSplit;

export function createEmptyDirectPane(id: string): ModelResult<DirectPaneLeaf> {
  try {
    return modelSuccess({
      kind: "leaf",
      id: createPaneId(id),
      content: { kind: "empty" },
    });
  } catch (error) {
    return modelFailure("invalid-id", error instanceof Error ? error.message : "Invalid pane id");
  }
}

export function createTerminalDirectPane(
  id: string,
  terminalId: TerminalId,
): ModelResult<DirectPaneLeaf> {
  try {
    return modelSuccess({
      kind: "leaf",
      id: createPaneId(id),
      content: {
        kind: "terminal",
        terminalId,
      },
    });
  } catch (error) {
    return modelFailure("invalid-id", error instanceof Error ? error.message : "Invalid pane id");
  }
}

export function createDirectPaneSplit(
  id: string,
  direction: DirectPaneDirection,
  ratio: number,
  first: DirectPaneNode,
  second: DirectPaneNode,
): ModelResult<DirectPaneSplit> {
  if (!Number.isFinite(ratio) || ratio < 0.1 || ratio > 0.9) {
    return modelFailure("invalid-layout", "Direct split ratio must be between 0.1 and 0.9");
  }

  const paneIds = [...collectDirectPaneIds(first), ...collectDirectPaneIds(second)];
  if (new Set(paneIds).size !== paneIds.length) {
    return modelFailure("duplicate-id", "Direct pane appears more than once in a layout");
  }

  try {
    const splitId = createPaneId(id);
    if (paneIds.includes(splitId)) {
      return modelFailure("duplicate-id", "Split pane id already exists in the layout");
    }

    return modelSuccess({
      kind: "split",
      id: splitId,
      direction,
      ratio,
      children: [first, second],
    });
  } catch (error) {
    return modelFailure("invalid-id", error instanceof Error ? error.message : "Invalid pane id");
  }
}

export function collectDirectPaneIds(node: DirectPaneNode): PaneId[] {
  if (node.kind === "leaf") {
    return [node.id];
  }

  return [...collectDirectPaneIds(node.children[0]), ...collectDirectPaneIds(node.children[1])];
}

export function collectDirectPaneTerminalIds(node: DirectPaneNode): TerminalId[] {
  if (node.kind === "leaf") {
    return node.content.kind === "terminal" ? [node.content.terminalId] : [];
  }

  return [
    ...collectDirectPaneTerminalIds(node.children[0]),
    ...collectDirectPaneTerminalIds(node.children[1]),
  ];
}

export function findDirectPane(node: DirectPaneNode, paneId: PaneId): DirectPaneNode | null {
  if (node.id === paneId) {
    return node;
  }
  if (node.kind === "leaf") {
    return null;
  }

  return findDirectPane(node.children[0], paneId) ?? findDirectPane(node.children[1], paneId);
}

export function replaceDirectPane(
  node: DirectPaneNode,
  paneId: PaneId,
  replacement: DirectPaneNode,
): DirectPaneNode {
  if (node.id === paneId) {
    return replacement;
  }
  if (node.kind === "leaf") {
    return node;
  }

  return {
    ...node,
    children: [
      replaceDirectPane(node.children[0], paneId, replacement),
      replaceDirectPane(node.children[1], paneId, replacement),
    ],
  };
}

export function setDirectPaneContent(
  node: DirectPaneNode,
  paneId: PaneId,
  content: DirectPaneContent,
): DirectPaneNode {
  if (node.kind === "leaf") {
    return node.id === paneId ? { ...node, content } : node;
  }

  return {
    ...node,
    children: [
      setDirectPaneContent(node.children[0], paneId, content),
      setDirectPaneContent(node.children[1], paneId, content),
    ],
  };
}

export function removeDirectPane(node: DirectPaneNode, paneId: PaneId): DirectPaneNode | null {
  if (node.kind === "leaf") {
    return node.id === paneId ? null : node;
  }

  const first = removeDirectPane(node.children[0], paneId);
  const second = removeDirectPane(node.children[1], paneId);

  if (first === null) return second;
  if (second === null) return first;
  return { ...node, children: [first, second] };
}

export function splitDirectPane(
  node: DirectPaneNode,
  targetPaneId: PaneId,
  splitPaneId: string,
  newPane: DirectPaneNode,
  direction: DirectPaneDirection,
  ratio = 0.5,
): ModelResult<DirectPaneNode> {
  const currentPane = findDirectPane(node, targetPaneId);
  if (!currentPane) {
    return modelFailure("not-found", "Pane to split does not exist");
  }

  const existingPaneIds = collectDirectPaneIds(node);
  const newPaneIds = collectDirectPaneIds(newPane);
  if (existingPaneIds.some((id) => newPaneIds.includes(id))) {
    return modelFailure("duplicate-id", "New pane id already exists in the layout");
  }

  let splitId: PaneId;
  try {
    splitId = createPaneId(splitPaneId);
  } catch (error) {
    return modelFailure(
      "invalid-id",
      error instanceof Error ? error.message : "Invalid split pane id",
    );
  }
  if (existingPaneIds.includes(splitId)) {
    return modelFailure("duplicate-id", "Split pane id already exists in the layout");
  }

  const splitResult = createDirectPaneSplit(splitPaneId, direction, ratio, currentPane, newPane);
  if (!splitResult.ok) {
    return splitResult;
  }

  return modelSuccess(replaceDirectPane(node, targetPaneId, splitResult.value));
}
