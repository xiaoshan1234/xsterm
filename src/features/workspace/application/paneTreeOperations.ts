import {
  createPaneId,
  createWindowId,
  createWorkspaceId,
  type PaneId,
  type TerminalId,
  type WindowId,
  type WorkspaceId,
} from "../../../models";
import type { Terminal } from "../../../features/terminal";
import type { EditablePaneNode, PaneSplitDirection } from "../contracts";
import { createEditableLeafPane, createEditableSplitNode } from "../contracts";
import type { Workspace } from "../contracts";

/** Pure PaneTree operations owned by the workspace feature. */
import { findPaneNode, getLeafPaneIds, mapPaneTree, replacePaneNode } from "./paneTreeAccess";

export { findPaneNode, getLeafPaneIds, mapPaneTree, replacePaneNode };

export function generatePaneId(): PaneId {
  return createPaneId(crypto.randomUUID());
}

export function generateWindowId(): WindowId {
  return createWindowId(crypto.randomUUID());
}

export function generateWorkspaceId(): WorkspaceId {
  return createWorkspaceId(crypto.randomUUID());
}

export function createLeafPane(
  size: number,
  terminalId?: TerminalId,
  configId?: string,
): EditablePaneNode {
  return createEditableLeafPane(generatePaneId(), size, terminalId, configId);
}

export function createSplitNode(
  direction: PaneSplitDirection,
  first: EditablePaneNode,
  second: EditablePaneNode,
): EditablePaneNode {
  return createEditableSplitNode(generatePaneId(), direction, first, second);
}

export function forEachPane(
  root: EditablePaneNode,
  callback: (node: EditablePaneNode) => void,
): void {
  callback(root);
  if (root.children) {
    root.children.forEach((child) => forEachPane(child, callback));
  }
}

export function removeSessionFromPaneTree(
  root: EditablePaneNode,
  terminalId: TerminalId,
): EditablePaneNode {
  return mapPaneTree(root, (node) => {
    if (node.type === "leaf" && node.terminalId === terminalId) {
      return { ...node, terminalId: undefined };
    }
    return node;
  });
}

export function replaceSessionIdInPaneTree(
  root: EditablePaneNode,
  oldSessionId: TerminalId,
  newSessionId: TerminalId,
): EditablePaneNode {
  return mapPaneTree(root, (node) => {
    if (node.type === "leaf" && node.terminalId === oldSessionId) {
      return { ...node, terminalId: newSessionId };
    }
    return node;
  });
}

export function collapseEmptySplits(root: EditablePaneNode): EditablePaneNode {
  if (root.type === "leaf") return root;
  const collapsedChildren = root.children?.map(collapseEmptySplits) ?? [];
  if (collapsedChildren.every((child) => child.type === "leaf" && child.terminalId === undefined)) {
    return createLeafPane(root.size);
  }
  return { ...root, children: collapsedChildren };
}

export function removeSessionAndCollapse(
  root: EditablePaneNode,
  terminalId: TerminalId,
): EditablePaneNode {
  return collapseEmptySplits(removeSessionFromPaneTree(root, terminalId));
}

/**
 * Returns the first leaf node (depth-first) that has a defined `terminalId`.
 * Used to derive a default window name from the first terminal attached to the window.
 */
export function findFirstLeafWithSession(root: EditablePaneNode): EditablePaneNode | null {
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
  rootPane: EditablePaneNode,
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
export function isSessionInPaneTree(root: EditablePaneNode, terminalId: TerminalId): boolean {
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
  terminalId: TerminalId,
): { workspaceId: WorkspaceId; windowId: WindowId } | null {
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
  currentWorkspaceId: WorkspaceId | null,
  currentWindowId: WindowId | null,
  terminalId: TerminalId,
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

export function collectSessionIdsFromPaneTree(root: EditablePaneNode): TerminalId[] {
  const ids = new Set<TerminalId>();
  forEachPane(root, (node) => {
    if (node.type === "leaf" && node.terminalId !== undefined) {
      ids.add(node.terminalId);
    }
  });
  return Array.from(ids);
}

export function collectSessionIdsFromWorkspace(workspace: Workspace): TerminalId[] {
  const ids = new Set<TerminalId>();
  workspace.windows.forEach((window) => {
    collectSessionIdsFromPaneTree(window.rootPane).forEach((id) => ids.add(id));
  });
  return Array.from(ids);
}

export function getPaneNumberMap(root: EditablePaneNode): Map<PaneId, number> {
  const map = new Map<PaneId, number>();
  let number = 1;
  forEachPane(root, (node) => {
    if (node.type === "leaf") {
      map.set(node.id, number++);
    }
  });
  return map;
}

export function getPaneNumber(root: EditablePaneNode, paneId: PaneId): number | null {
  return getPaneNumberMap(root).get(paneId) ?? null;
}

export function withRecomputedSessionIds(workspace: Workspace): Workspace {
  return {
    ...workspace,
    terminalIds: collectSessionIdsFromWorkspace(workspace),
  };
}

export function stripSessionIdFromPaneTree(root: EditablePaneNode): EditablePaneNode {
  return mapPaneTree(root, (node) =>
    node.type === "leaf" ? { ...node, terminalId: undefined } : node,
  );
}

function removePaneRecursive(root: EditablePaneNode, paneId: PaneId): EditablePaneNode | null {
  if (root.id === paneId) {
    return null;
  }
  if (root.type === "leaf") {
    return root;
  }
  const children =
    root.children
      ?.map((child) => removePaneRecursive(child, paneId))
      .filter((child): child is EditablePaneNode => child !== null) ?? [];
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return { ...children[0], size: root.size };
  }
  return { ...root, children };
}

export function removePaneFromTree(root: EditablePaneNode, paneId: PaneId): EditablePaneNode {
  return removePaneRecursive(root, paneId) ?? createLeafPane(root.size);
}
