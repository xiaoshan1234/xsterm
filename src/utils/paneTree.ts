import { PaneNode } from "../types/session";

export function findPaneNode<T extends { id: string; children?: T[] }>(
  node: T,
  paneId: string
): T | null {
  if (node.id === paneId) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findPaneNode(child, paneId);
      if (found) return found;
    }
  }
  return null;
}

export function getLeafPaneIds(node: PaneNode): string[] {
  const ids: string[] = [];
  function collect(n: PaneNode): void {
    if (n.type === "leaf") {
      ids.push(n.id);
      return;
    }
    if (n.children) {
      for (const child of n.children) {
        collect(child);
      }
    }
  }
  collect(node);
  return ids;
}

export function replacePaneNode<T extends { id: string; children?: T[] }>(
  node: T,
  paneId: string,
  newNode: T
): T {
  if (node.id === paneId) return newNode;
  if (!node.children) return node;
  return {
    ...node,
    children: node.children.map((child) => replacePaneNode(child, paneId, newNode)),
  };
}

export function mapPaneTree<T extends { id: string; children?: T[] }>(
  node: T,
  mapper: (node: T) => T
): T {
  const mapped = mapper(node);
  if (mapped.children) {
    return { ...mapped, children: mapped.children.map((child) => mapPaneTree(child, mapper)) };
  }
  return mapped;
}
