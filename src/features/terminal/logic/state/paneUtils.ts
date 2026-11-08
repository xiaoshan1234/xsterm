import {
  type PaneNode,
  type Terminal,
  type SplitDirection,
  type Workspace,
} from "../../../../types/terminal";
import {
  findPaneNode,
  getLeafPaneIds,
  mapPaneTree,
  replacePaneNode,
} from "../../../../shared/utils/paneTreeUtils";

export { findPaneNode, getLeafPaneIds, mapPaneTree, replacePaneNode };

export function generateId(): string {
  return crypto.randomUUID();
}

export function createLeafPane(size: number, terminalId?: number, configId?: string): PaneNode {
  return {
    id: generateId(),
    type: "leaf",
    size,
    terminalId,
    configId,
  };
}

export function createSplitNode(
  direction: SplitDirection,
  first: PaneNode,
  second: PaneNode,
): PaneNode {
  return {
    id: generateId(),
    type: "split",
    direction,
    size: first.size + second.size,
    children: [first, second],
  };
}

export function forEachPane(root: PaneNode, callback: (node: PaneNode) => void): void {
  callback(root);
  if (root.children) {
    root.children.forEach((child) => forEachPane(child, callback));
  }
}

export function removeSessionFromPaneTree(root: PaneNode, terminalId: number): PaneNode {
  return mapPaneTree(root, (node) => {
    if (node.type === "leaf" && node.terminalId === terminalId) {
      return { ...node, terminalId: undefined };
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
    if (node.type === "leaf" && node.terminalId === oldSessionId) {
      return { ...node, terminalId: newSessionId };
    }
    return node;
  });
}

export function collapseEmptySplits(root: PaneNode): PaneNode {
  if (root.type === "leaf") return root;
  const collapsedChildren = root.children?.map(collapseEmptySplits) ?? [];
  if (collapsedChildren.every((child) => child.type === "leaf" && child.terminalId === undefined)) {
    return createLeafPane(root.size);
  }
  return { ...root, children: collapsedChildren };
}

export function removeSessionAndCollapse(root: PaneNode, terminalId: number): PaneNode {
  return collapseEmptySplits(removeSessionFromPaneTree(root, terminalId));
}

/**
 * Returns the first leaf node (depth-first) that has a defined `terminalId`.
 * Used to derive a default window name from the first terminal attached to the window.
 */
export function findFirstLeafWithSession(root: PaneNode): PaneNode | null {
  if (root.type === "leaf") {
    return root.terminalId !== undefined ? root : null;
  }
  if (!root.children) return null;
  for (const child of root.children) {
    const found = findFirstLeafWithSession(child);
    if (found) return found;
  }
  return null;
}

/**
 * Derives the default window name from the first terminal attached to the root pane.
 * Falls back to `fallback` when no terminal is attached or the terminal can't be found.
 */
export function getDefaultWindowName(
  rootPane: PaneNode,
  terminals: Terminal[],
  fallback: string,
): string {
  const firstLeaf = findFirstLeafWithSession(rootPane);
  if (!firstLeaf || firstLeaf.terminalId === undefined) return fallback;
  const terminal = terminals.find((s) => s.id === firstLeaf.terminalId);
  return terminal?.name ?? fallback;
}

/**
 * Returns true when the given `terminalId` is attached to any leaf pane
 * anywhere in the given pane tree (depth-first search).
 */
export function isSessionInPaneTree(root: PaneNode, terminalId: number): boolean {
  if (root.type === "leaf") {
    return root.terminalId === terminalId;
  }
  if (!root.children) return false;
  for (const child of root.children) {
    if (isSessionInPaneTree(child, terminalId)) return true;
  }
  return false;
}

/**
 * Scans every workspace and window's pane tree (depth-first) and returns
 * the first location where the given terminal is attached. Returns null
 * when the terminal is not used in any window.
 */
export function findSessionWindow(
  workspaces: Workspace[],
  terminalId: number,
): { workspaceId: string; windowId: string } | null {
  for (const workspace of workspaces) {
    for (const window of workspace.windows) {
      if (isSessionInPaneTree(window.rootPane, terminalId)) {
        return { workspaceId: workspace.id, windowId: window.id };
      }
    }
  }
  return null;
}

/**
 * Returns true when the given terminal is attached to a pane in any
 * window other than the currently active one. A null `currentWorkspaceId`
 * or `currentWindowId` means "no current window" — in that case the
 * terminal is considered "used elsewhere" as soon as it is found anywhere.
 */
export function isSessionUsedInOtherWindow(
  workspaces: Workspace[],
  currentWorkspaceId: string | null,
  currentWindowId: string | null,
  terminalId: number,
): boolean {
  for (const workspace of workspaces) {
    for (const window of workspace.windows) {
      if (!isSessionInPaneTree(window.rootPane, terminalId)) continue;
      if (currentWorkspaceId === null || currentWindowId === null) return true;
      if (workspace.id !== currentWorkspaceId || window.id !== currentWindowId) return true;
    }
  }
  return false;
}

export function collectSessionIdsFromPaneTree(root: PaneNode): number[] {
  const ids = new Set<number>();
  forEachPane(root, (node) => {
    if (node.type === "leaf" && node.terminalId !== undefined) {
      ids.add(node.terminalId);
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

export function getPaneNumberMap(root: PaneNode): Map<string, number> {
  const map = new Map<string, number>();
  let number = 1;
  forEachPane(root, (node) => {
    if (node.type === "leaf") {
      map.set(node.id, number++);
    }
  });
  return map;
}

export function getPaneNumber(root: PaneNode, paneId: string): number | null {
  return getPaneNumberMap(root).get(paneId) ?? null;
}

export function withRecomputedSessionIds(workspace: Workspace): Workspace {
  return {
    ...workspace,
    terminalIds: collectSessionIdsFromWorkspace(workspace),
  };
}

export function stripSessionIdFromPaneTree(root: PaneNode): PaneNode {
  return mapPaneTree(root, (node) =>
    node.type === "leaf" ? { ...node, terminalId: undefined } : node,
  );
}

function removePaneRecursive(root: PaneNode, paneId: string): PaneNode | null {
  if (root.id === paneId) {
    return null;
  }
  if (root.type === "leaf") {
    return root;
  }
  const children =
    root.children
      ?.map((child) => removePaneRecursive(child, paneId))
      .filter((child): child is PaneNode => child !== null) ?? [];
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
