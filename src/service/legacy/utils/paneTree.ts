import type { PaneNode, PaneSplitNode } from "../../../model/pane";

function asSplit(node: PaneNode): PaneSplitNode {
  if (node.kind !== "split") {
    throw new Error(`expected split node, got ${node.kind} (id=${node.id})`);
  }
  return node;
}

function getChildren(node: PaneNode): PaneNode[] | undefined {
  return node.kind === "split" ? node.layout.children : undefined;
}

export function findPaneNode(node: PaneNode, paneId: string): PaneNode | null {
  if (node.id === paneId) return node;
  const children = getChildren(node);
  if (children) {
    for (const child of children) {
      const found = findPaneNode(child, paneId);
      if (found) return found;
    }
  }
  return null;
}

export function getLeafPaneIds(node: PaneNode): string[] {
  const ids: string[] = [];
  function collect(n: PaneNode): void {
    if (n.kind === "leaf") {
      ids.push(n.id);
      return;
    }
    const children = getChildren(n);
    if (children) {
      for (const child of children) {
        collect(child);
      }
    }
  }
  collect(node);
  return ids;
}

export function replacePaneNode(node: PaneNode, paneId: string, newNode: PaneNode): PaneNode {
  if (node.id === paneId) return newNode;
  const children = getChildren(node);
  if (!children) return node;
  const split = asSplit(node);
  return {
    ...split,
    layout: {
      ...split.layout,
      children: children.map((child) => replacePaneNode(child, paneId, newNode)),
    },
  };
}

export function mapPaneTree(node: PaneNode, mapper: (node: PaneNode) => PaneNode): PaneNode {
  const mapped = mapper(node);
  const children = getChildren(mapped);
  if (children) {
    const split = asSplit(mapped);
    return {
      ...split,
      layout: {
        ...split.layout,
        children: children.map((child) => mapPaneTree(child, mapper)),
      },
    };
  }
  return mapped;
}
