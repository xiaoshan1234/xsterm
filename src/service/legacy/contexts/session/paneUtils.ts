import {
  type PaneBinding,
  type PaneLeafNode,
  type PaneNode,
  type PaneSplitNode,
  type Session,
  type SplitDirection,
  type Workspace,
} from "../../../../model";

export type { PaneLeafNode, PaneSplitNode, PaneNode };

export function generateId(): string {
  return crypto.randomUUID();
}

export function createLeafPane(size: number, sessionId?: number, configId?: string): PaneLeafNode {
  const binding: PaneBinding | undefined =
    sessionId !== undefined ? { sessionId, configId: configId ?? "" } : undefined;
  return {
    id: generateId(),
    kind: "leaf",
    size,
    binding,
  };
}

export function createSplitNode(
  direction: SplitDirection,
  first: PaneNode,
  second: PaneNode,
): PaneSplitNode {
  return {
    id: generateId(),
    kind: "split",
    size: first.size + second.size,
    layout: { direction, children: [first, second] },
  };
}

function getChildren(node: PaneNode): PaneSplitNode["layout"]["children"] | undefined {
  return node.kind === "split" ? node.layout.children : undefined;
}

function asSplit(node: PaneNode): PaneSplitNode {
  if (node.kind !== "split") {
    throw new Error(`expected split node, got ${node.kind} (id=${node.id})`);
  }
  return node;
}

export function findPaneNode(root: PaneNode, id: string): PaneNode | null {
  if (root.id === id) return root;
  const children = getChildren(root);
  if (children) {
    for (const child of children) {
      const found = findPaneNode(child, id);
      if (found) return found;
    }
  }
  return null;
}

export function mapPaneTree(root: PaneNode, mapper: (node: PaneNode) => PaneNode): PaneNode {
  const mapped = mapper(root);
  const children = getChildren(mapped);
  if (children) {
    const split = asSplit(mapped);
    return {
      ...split,
      layout: { ...split.layout, children: children.map((child) => mapPaneTree(child, mapper)) },
    };
  }
  return mapped;
}

export function forEachPane(root: PaneNode, callback: (node: PaneNode) => void): void {
  callback(root);
  const children = getChildren(root);
  if (children) {
    children.forEach((child) => forEachPane(child, callback));
  }
}

export function getLeafPaneIds(root: PaneNode): string[] {
  const ids: string[] = [];
  forEachPane(root, (node) => {
    if (node.kind === "leaf") {
      ids.push(node.id);
    }
  });
  return ids;
}

export function removeSessionFromPaneTree(root: PaneNode, sessionId: number): PaneNode {
  return mapPaneTree(root, (node) => {
    if (node.kind === "leaf" && node.binding?.sessionId === sessionId) {
      return { ...node, binding: undefined };
    }
    return node;
  });
}

export function replaceSessionIdInPaneTree(
  root: PaneNode,
  oldSessionId: number,
  newSessionId: number,
): PaneNode {
  return mapPaneTree(root, (node) => {
    if (node.kind === "leaf" && node.binding?.sessionId === oldSessionId) {
      return { ...node, binding: { ...node.binding, sessionId: newSessionId } };
    }
    return node;
  });
}

export function collapseEmptySplits(root: PaneNode): PaneNode {
  if (root.kind === "leaf") return root;
  const children = getChildren(root) ?? [];
  const collapsedChildren = children.map(collapseEmptySplits);
  if (collapsedChildren.every((child) => child.kind === "leaf" && child.binding === undefined)) {
    return createLeafPane(root.size);
  }
  const split = asSplit(root);
  return { ...split, layout: { ...split.layout, children: collapsedChildren } };
}

export function removeSessionAndCollapse(root: PaneNode, sessionId: number): PaneNode {
  return collapseEmptySplits(removeSessionFromPaneTree(root, sessionId));
}

export function replacePaneNode(root: PaneNode, targetId: string, replacement: PaneNode): PaneNode {
  if (root.id === targetId) return replacement;
  const children = getChildren(root);
  if (!children) return root;
  const split = asSplit(root);
  return {
    ...split,
    layout: {
      ...split.layout,
      children: children.map((child) => replacePaneNode(child, targetId, replacement)),
    },
  };
}

/**
 * Returns the first leaf node (depth-first) that has a defined `sessionId`.
 * Used to derive a default window name from the first session attached to the window.
 */
export function findFirstLeafWithSession(root: PaneNode): PaneLeafNode | null {
  if (root.kind === "leaf") {
    return root.binding?.sessionId !== undefined ? root : null;
  }
  const children = getChildren(root);
  if (!children) return null;
  for (const child of children) {
    const found = findFirstLeafWithSession(child);
    if (found) return found;
  }
  return null;
}

/**
 * Derives the default window name from the first session attached to the root pane.
 * Falls back to `fallback` when no session is attached or the session can't be found.
 */
export function getDefaultWindowName(
  rootPane: PaneNode,
  sessions: Session[],
  fallback: string,
): string {
  const firstLeaf = findFirstLeafWithSession(rootPane);
  if (!firstLeaf || firstLeaf.binding?.sessionId === undefined) return fallback;
  const session = sessions.find((s) => s.id === firstLeaf.binding?.sessionId);
  return session?.name ?? fallback;
}

/**
 * Returns true when the given `sessionId` is attached to any leaf pane
 * anywhere in the given pane tree (depth-first search).
 */
export function isSessionInPaneTree(root: PaneNode, sessionId: number): boolean {
  if (root.kind === "leaf") {
    return root.binding?.sessionId === sessionId;
  }
  const children = getChildren(root);
  if (!children) return false;
  for (const child of children) {
    if (isSessionInPaneTree(child, sessionId)) return true;
  }
  return false;
}

/**
 * Scans every workspace and window's pane tree (depth-first) and returns
 * the first location where the given session is attached. Returns null
 * when the session is not used in any window.
 */
export function findSessionWindow(
  workspaces: Workspace[],
  sessionId: number,
): { workspaceId: string; windowId: string } | null {
  for (const workspace of workspaces) {
    for (const window of workspace.windows) {
      if (window.kind !== "terminal") continue;
      if (isSessionInPaneTree(window.rootPane, sessionId)) {
        return { workspaceId: workspace.id, windowId: window.id };
      }
    }
  }
  return null;
}

/**
 * Returns true when the given session is attached to a pane in any
 * window other than the currently active one. A null `currentWorkspaceId`
 * or `currentWindowId` means "no current window" — in that case the
 * session is considered "used elsewhere" as soon as it is found anywhere.
 */
export function isSessionUsedInOtherWindow(
  workspaces: Workspace[],
  currentWorkspaceId: string | null,
  currentWindowId: string | null,
  sessionId: number,
): boolean {
  for (const workspace of workspaces) {
    for (const window of workspace.windows) {
      if (window.kind !== "terminal") continue;
      if (!isSessionInPaneTree(window.rootPane, sessionId)) continue;
      if (currentWorkspaceId === null || currentWindowId === null) return true;
      if (workspace.id !== currentWorkspaceId || window.id !== currentWindowId) return true;
    }
  }
  return false;
}

export function collectSessionIdsFromPaneTree(root: PaneNode): number[] {
  const ids = new Set<number>();
  forEachPane(root, (node) => {
    if (node.kind === "leaf" && node.binding?.sessionId !== undefined) {
      ids.add(node.binding.sessionId);
    }
  });
  return Array.from(ids);
}

export function collectSessionIdsFromWorkspace(workspace: Workspace): number[] {
  const ids = new Set<number>();
  workspace.windows.forEach((window) => {
    if (window.kind !== "terminal") return;
    collectSessionIdsFromPaneTree(window.rootPane).forEach((id) => ids.add(id));
  });
  return Array.from(ids);
}

export function getPaneNumberMap(root: PaneNode): Map<string, number> {
  const map = new Map<string, number>();
  let number = 1;
  forEachPane(root, (node) => {
    if (node.kind === "leaf") {
      map.set(node.id, number++);
    }
  });
  return map;
}

export function getPaneNumber(root: PaneNode, paneId: string): number | null {
  return getPaneNumberMap(root).get(paneId) ?? null;
}

export function withRecomputedSessionIds(
  workspace: Workspace,
): Workspace & { sessionIds: number[] } {
  return {
    ...workspace,
    sessionIds: collectSessionIdsFromWorkspace(workspace),
  };
}

export function stripSessionIdFromPaneTree(root: PaneNode): PaneNode {
  return mapPaneTree(root, (node) =>
    node.kind === "leaf" ? { ...node, binding: undefined } : node,
  );
}

function removePaneRecursive(root: PaneNode, paneId: string): PaneNode | null {
  if (root.id === paneId) {
    return null;
  }
  if (root.kind === "leaf") {
    return root;
  }
  const children =
    getChildren(root)
      ?.map((child) => removePaneRecursive(child, paneId))
      .filter((child): child is PaneNode => child !== null) ?? [];
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return { ...children[0], size: root.size };
  }
  const split = asSplit(root);
  return { ...split, layout: { ...split.layout, children } };
}

export function removePaneFromTree(root: PaneNode, paneId: string): PaneNode {
  return removePaneRecursive(root, paneId) ?? createLeafPane(root.size);
}
