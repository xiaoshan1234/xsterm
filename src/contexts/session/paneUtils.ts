import { PaneNode, Session, SplitDirection, Workspace } from "../../types/session";

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

/**
 * Returns true when the given `sessionId` is attached to any leaf pane
 * anywhere in the given pane tree (depth-first search).
 */
export function isSessionInPaneTree(root: PaneNode, sessionId: number): boolean {
  if (root.type === "leaf") {
    return root.sessionId === sessionId;
  }
  if (!root.children) return false;
  for (const child of root.children) {
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
  sessionId: number
): { workspaceId: string; windowId: string } | null {
  for (const workspace of workspaces) {
    for (const window of workspace.windows) {
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
  sessionId: number
): boolean {
  for (const workspace of workspaces) {
    for (const window of workspace.windows) {
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
    if (node.type === "leaf" && node.sessionId !== undefined) {
      ids.add(node.sessionId);
    }
  });
  return Array.from(ids);
}

export function collectSessionIdsFromWorkspace(workspace: Workspace): number[] {
  const ids = new Set<number>();
  workspace.windows.forEach((window) => {
    collectSessionIdsFromPaneTree(window.rootPane).forEach((id) => ids.add(id));
  });
  return Array.from(ids);
}

export function withRecomputedSessionIds(workspace: Workspace): Workspace {
  return {
    ...workspace,
    sessionIds: collectSessionIdsFromWorkspace(workspace),
  };
}

export function stripSessionIdFromPaneTree(root: PaneNode): PaneNode {
  return mapPaneTree(root, (node) => (node.type === "leaf" ? { ...node, sessionId: undefined } : node));
}

function removePaneRecursive(root: PaneNode, paneId: string): PaneNode | null {
  if (root.id === paneId) {
    return null;
  }
  if (root.type === "leaf") {
    return root;
  }
  const children = root.children?.map((child) => removePaneRecursive(child, paneId)).filter((child): child is PaneNode => child !== null) ?? [];
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return { ...children[0], size: root.size };
  }
  return { ...root, children };
}

export function removePaneFromTree(root: PaneNode, paneId: string): PaneNode {
  return removePaneRecursive(root, paneId) ?? createLeafPane(root.size);
}
