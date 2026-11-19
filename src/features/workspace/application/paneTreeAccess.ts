import type { PaneId } from "../../../models";
import { type EditablePaneNode } from "../contracts";

export function findPaneNode<T extends { id: PaneId; children?: T[] }>(
  node: T,
  paneId: PaneId | null | undefined,
): T | null {
  if (paneId === null || paneId === undefined) return null;
  if (node.id === paneId) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findPaneNode(child, paneId);
      if (found) return found;
    }
  }
  return null;
}

export function getLeafPaneIds(node: EditablePaneNode): PaneId[] {
  const ids: PaneId[] = [];
  function collect(candidate: EditablePaneNode): void {
    if (candidate.type === "leaf") {
      ids.push(candidate.id);
      return;
    }
    if (candidate.children) {
      for (const child of candidate.children) {
        collect(child);
      }
    }
  }
  collect(node);
  return ids;
}

export function replacePaneNode<T extends { id: PaneId; children?: T[] }>(
  node: T,
  paneId: PaneId,
  newNode: T,
): T {
  if (node.id === paneId) return newNode;
  if (!node.children) return node;
  return {
    ...node,
    children: node.children.map((child) => replacePaneNode(child, paneId, newNode)),
  };
}

export function mapPaneTree<T extends { id: PaneId; children?: T[] }>(
  node: T,
  mapper: (node: T) => T,
): T {
  const mapped = mapper(node);
  if (mapped.children) {
    return { ...mapped, children: mapped.children.map((child) => mapPaneTree(child, mapper)) };
  }
  return mapped;
}
