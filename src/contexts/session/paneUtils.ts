import { PaneNode, Session, SplitDirection } from "../../types/session";

export function generateId(): string {
  return crypto.randomUUID();
}

export function createLeafPane(size: number, sessionId?: number, configId?: string): PaneNode {
  return {
    id: generateId(),
    type: "leaf",
    size,
    sessionId,
    configId,
  };
}

export function createSplitNode(direction: SplitDirection, first: PaneNode, second: PaneNode): PaneNode {
  return {
    id: generateId(),
    type: "split",
    direction,
    size: first.size + second.size,
    children: [first, second],
  };
}

export function findPaneNode(root: PaneNode, id: string): PaneNode | null {
  if (root.id === id) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findPaneNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

export function mapPaneTree(root: PaneNode, mapper: (node: PaneNode) => PaneNode): PaneNode {
  const mapped = mapper(root);
  if (mapped.children) {
    return { ...mapped, children: mapped.children.map((child) => mapPaneTree(child, mapper)) };
  }
  return mapped;
}

export function forEachPane(root: PaneNode, callback: (node: PaneNode) => void): void {
  callback(root);
  if (root.children) {
    root.children.forEach((child) => forEachPane(child, callback));
  }
}

export function getLeafPaneIds(root: PaneNode): string[] {
  const ids: string[] = [];
  forEachPane(root, (node) => {
    if (node.type === "leaf") {
      ids.push(node.id);
    }
  });
  return ids;
}

export function removeSessionFromPaneTree(root: PaneNode, sessionId: number): PaneNode {
  return mapPaneTree(root, (node) => {
    if (node.type === "leaf" && node.sessionId === sessionId) {
      return { ...node, sessionId: undefined };
    }
    return node;
  });
}

export function collapseEmptySplits(root: PaneNode): PaneNode {
  if (root.type === "leaf") return root;
  const collapsedChildren = root.children?.map(collapseEmptySplits) ?? [];
  if (collapsedChildren.every((child) => child.type === "leaf" && child.sessionId === undefined)) {
    return createLeafPane(root.size);
  }
  return { ...root, children: collapsedChildren };
}

export function removeSessionAndCollapse(root: PaneNode, sessionId: number): PaneNode {
  return collapseEmptySplits(removeSessionFromPaneTree(root, sessionId));
}

export function replacePaneNode(root: PaneNode, targetId: string, replacement: PaneNode): PaneNode {
  if (root.id === targetId) return replacement;
  if (!root.children) return root;
  return {
    ...root,
    children: root.children.map((child) => replacePaneNode(child, targetId, replacement)),
  };
}

/**
 * Returns the first leaf node (depth-first) that has a defined `sessionId`.
 * Used to derive a default window name from the first session attached to the window.
 */
export function findFirstLeafWithSession(root: PaneNode): PaneNode | null {
  if (root.type === "leaf") {
    return root.sessionId !== undefined ? root : null;
  }
  if (!root.children) return null;
  for (const child of root.children) {
    const found = findFirstLeafWithSession(child);
    if (found) return found;
  }
  return null;
}

/**
 * Derives the default window name from the first session attached to the root pane.
 * Falls back to `fallback` when no session is attached or the session can't be found.
 */
export function getDefaultWindowName(rootPane: PaneNode, sessions: Session[], fallback: string): string {
  const firstLeaf = findFirstLeafWithSession(rootPane);
  if (!firstLeaf || firstLeaf.sessionId === undefined) return fallback;
  const session = sessions.find((s) => s.id === firstLeaf.sessionId);
  return session?.name ?? fallback;
}
