import { type PaneId, type TerminalId, createPaneId } from "../ids";
import { modelFailure, modelSuccess, type ModelResult } from "../result";

/**
 * Layout tree for a raw workspace window. Leaf content references a
 * standalone `Terminal`; local and SSH terminals may coexist in this tree.
 */
export type RawPaneDirection = "horizontal" | "vertical";

export type RawPaneContent =
  | { readonly kind: "empty" }
  | {
      readonly kind: "terminal";
      readonly terminalId: TerminalId;
    };

export interface RawPaneLeaf {
  readonly kind: "leaf";
  readonly id: PaneId;
  readonly content: RawPaneContent;
}

export interface RawPaneSplit {
  readonly kind: "split";
  readonly id: PaneId;
  readonly direction: RawPaneDirection;
  /** The first child's proportion, from 0.1 to 0.9. */
  readonly ratio: number;
  readonly children: readonly [RawPaneNode, RawPaneNode];
}

export type RawPaneNode = RawPaneLeaf | RawPaneSplit;

export function createEmptyRawPane(id: string): ModelResult<RawPaneLeaf> {
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

export function createTerminalPane(id: string, terminalId: TerminalId): ModelResult<RawPaneLeaf> {
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

export function createRawPaneSplit(
  id: string,
  direction: RawPaneDirection,
  ratio: number,
  first: RawPaneNode,
  second: RawPaneNode,
): ModelResult<RawPaneSplit> {
  if (!Number.isFinite(ratio) || ratio < 0.1 || ratio > 0.9) {
    return modelFailure("invalid-layout", "Raw split ratio must be between 0.1 and 0.9");
  }

  const paneIds = [...collectRawPaneIds(first), ...collectRawPaneIds(second)];
  if (new Set(paneIds).size !== paneIds.length) {
    return modelFailure("duplicate-id", "Raw pane appears more than once in a layout");
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

export function collectRawPaneIds(node: RawPaneNode): PaneId[] {
  if (node.kind === "leaf") {
    return [node.id];
  }

  return [...collectRawPaneIds(node.children[0]), ...collectRawPaneIds(node.children[1])];
}

export function collectTerminalIdsFromRawPaneTree(node: RawPaneNode): TerminalId[] {
  if (node.kind === "leaf") {
    return node.content.kind === "terminal" ? [node.content.terminalId] : [];
  }

  return [
    ...collectTerminalIdsFromRawPaneTree(node.children[0]),
    ...collectTerminalIdsFromRawPaneTree(node.children[1]),
  ];
}

export function findRawPane(node: RawPaneNode, paneId: PaneId): RawPaneNode | null {
  if (node.id === paneId) {
    return node;
  }
  if (node.kind === "leaf") {
    return null;
  }

  return findRawPane(node.children[0], paneId) ?? findRawPane(node.children[1], paneId);
}

export function replaceRawPane(
  node: RawPaneNode,
  paneId: PaneId,
  replacement: RawPaneNode,
): RawPaneNode {
  if (node.id === paneId) {
    return replacement;
  }
  if (node.kind === "leaf") {
    return node;
  }

  return {
    ...node,
    children: [
      replaceRawPane(node.children[0], paneId, replacement),
      replaceRawPane(node.children[1], paneId, replacement),
    ],
  };
}

export function setRawPaneContent(
  node: RawPaneNode,
  paneId: PaneId,
  content: RawPaneContent,
): RawPaneNode {
  if (node.kind === "leaf") {
    return node.id === paneId ? { ...node, content } : node;
  }

  return {
    ...node,
    children: [
      setRawPaneContent(node.children[0], paneId, content),
      setRawPaneContent(node.children[1], paneId, content),
    ],
  };
}

export function removeRawPane(node: RawPaneNode, paneId: PaneId): RawPaneNode | null {
  if (node.kind === "leaf") {
    return node.id === paneId ? null : node;
  }

  const first = removeRawPane(node.children[0], paneId);
  const second = removeRawPane(node.children[1], paneId);

  if (first === null) return second;
  if (second === null) return first;
  return { ...node, children: [first, second] };
}

export function splitRawPane(
  node: RawPaneNode,
  targetPaneId: PaneId,
  splitPaneId: string,
  newPane: RawPaneNode,
  direction: RawPaneDirection,
  ratio = 0.5,
): ModelResult<RawPaneNode> {
  // Keep pane ids globally unique inside one layout so updates remain
  // deterministic and a terminal cannot be attached twice by accident.
  const currentPane = findRawPane(node, targetPaneId);
  if (!currentPane) {
    return modelFailure("not-found", "Pane to split does not exist");
  }

  const existingPaneIds = collectRawPaneIds(node);
  const newPaneIds = collectRawPaneIds(newPane);
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

  const splitResult = createRawPaneSplit(splitPaneId, direction, ratio, currentPane, newPane);
  if (!splitResult.ok) {
    return splitResult;
  }

  return modelSuccess(replaceRawPane(node, targetPaneId, splitResult.value));
}
