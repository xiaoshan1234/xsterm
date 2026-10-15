// L3 — PaneTree 纯数据结构。
// D1:PaneTree 全部在 L3;L0/L1 不感知 split / tab。
// D2:Tab + Split(h/v);M2 加 init 节点 + leaf.status 字段(Q2/Q3)。

import type { SessionId } from "./session";
import { DEFAULT_SHELL, type ShellKind } from "./shell";

export type TabId = number;

export type PanePath = ReadonlyArray<0 | 1>;

export type PaneNode =
  | { kind: "leaf"; sessionId: SessionId; shell: ShellKind; status: "alive" | "dead" }
  | { kind: "init"; shell: ShellKind }
  | { kind: "hsplit"; left: PaneNode; right: PaneNode; ratio: number }
  | { kind: "vsplit"; top: PaneNode; bottom: PaneNode; ratio: number };

export interface PaneTree {
  root: PaneNode;
  focusedPath: PanePath;
}

export interface Tab {
  id: TabId;
  title: string;
  shell: ShellKind;
}

const DEFAULT_RATIO = 0.5;

function isLeaf(
  node: PaneNode,
): node is { kind: "leaf"; sessionId: SessionId; shell: ShellKind; status: "alive" | "dead" } {
  return node.kind === "leaf";
}

function isInit(node: PaneNode): node is { kind: "init"; shell: ShellKind } {
  return node.kind === "init";
}

function replaceAt(node: PaneNode, path: PanePath, replacer: (n: PaneNode) => PaneNode): PaneNode {
  if (path.length === 0) return replacer(node);
  const [head, ...rest] = path;
  if (node.kind === "hsplit") {
    return {
      ...node,
      [head === 0 ? "left" : "right"]: replaceAt(
        head === 0 ? node.left : node.right,
        rest,
        replacer,
      ),
    };
  }
  if (node.kind === "vsplit") {
    return {
      ...node,
      [head === 0 ? "top" : "bottom"]: replaceAt(
        head === 0 ? node.top : node.bottom,
        rest,
        replacer,
      ),
    };
  }
  return node;
}

function findPathIn(node: PaneNode, sessionId: SessionId, acc: PanePath = []): PanePath | null {
  if (isLeaf(node) && node.sessionId === sessionId) return acc;
  if (node.kind === "hsplit") {
    return (
      findPathIn(node.left, sessionId, [...acc, 0]) ??
      findPathIn(node.right, sessionId, [...acc, 1])
    );
  }
  if (node.kind === "vsplit") {
    return (
      findPathIn(node.top, sessionId, [...acc, 0]) ??
      findPathIn(node.bottom, sessionId, [...acc, 1])
    );
  }
  return null;
}

export function findPath(tree: PaneTree, sessionId: SessionId): PanePath | null {
  return findPathIn(tree.root, sessionId);
}

export function findFocusedLeaf(tree: PaneTree): PaneNode {
  let node = tree.root;
  for (const step of tree.focusedPath) {
    if (node.kind === "hsplit") node = step === 0 ? node.left : node.right;
    else if (node.kind === "vsplit") node = step === 0 ? node.top : node.bottom;
  }
  return node;
}

export function createStartTree(shell: ShellKind = DEFAULT_SHELL): PaneTree {
  return { root: { kind: "init", shell }, focusedPath: [] };
}

export function initToLeaf(tree: PaneTree, sessionId: SessionId): PaneTree {
  if (tree.root.kind !== "init") return tree;
  const shell = tree.root.shell;
  return {
    root: { kind: "leaf", sessionId, shell, status: "alive" },
    focusedPath: [],
  };
}

export function splitLeaf(
  tree: PaneTree,
  sessionId: SessionId,
  axis: "h" | "v",
  newSessionId: SessionId,
  newShell: ShellKind,
): PaneTree {
  const path = findPath(tree, sessionId);
  if (!path || !isLeaf(tree.root) || tree.root.sessionId !== sessionId) {
    // path 必须落在 leaf 上;非 leaf 调用是 caller bug。
    return tree;
  }
  void path;
  // 简单实现:只在 root 是 leaf 时才允许 split(根级分裂)。
  // 嵌套 split 留 M3 — M2 一次只切一个 pane,先满足 V2-V4。
  const existing: PaneNode = tree.root;
  if (axis === "h") {
    return {
      root: {
        kind: "hsplit",
        left: existing,
        right: { kind: "leaf", sessionId: newSessionId, shell: newShell, status: "alive" },
        ratio: DEFAULT_RATIO,
      },
      focusedPath: [1],
    };
  }
  return {
    root: {
      kind: "vsplit",
      top: existing,
      bottom: { kind: "leaf", sessionId: newSessionId, shell: newShell, status: "alive" },
      ratio: DEFAULT_RATIO,
    },
    focusedPath: [1],
  };
}

export function closeLeaf(tree: PaneTree, sessionId: SessionId): PaneTree {
  const path = findPath(tree, sessionId);
  if (!path) return tree;
  // 根级 leaf 关闭 → 退化为 init 节点
  if (path.length === 0 && isLeaf(tree.root) && tree.root.sessionId === sessionId) {
    return { root: { kind: "init", shell: tree.root.shell }, focusedPath: [] };
  }
  // 嵌套 leaf 关闭 → 父 split 坍缩为兄弟(M2 仅根级分裂,先写一般化版本)
  if (path.length > 0) {
    const parentPath = path.slice(0, -1);
    const childStep = path[path.length - 1];
    const newRoot = collapseBranch(tree.root, parentPath, childStep);
    if (newRoot) {
      // 焦点回退到父 path
      const focusedPath = parentPath.length > 0 ? parentPath : [];
      return { root: newRoot, focusedPath };
    }
  }
  return tree;
}

function collapseBranch(node: PaneNode, parentPath: PanePath, childStep: 0 | 1): PaneNode | null {
  if (parentPath.length === 0) {
    if (node.kind === "hsplit") {
      return childStep === 0 ? node.right : node.left;
    }
    if (node.kind === "vsplit") {
      return childStep === 0 ? node.bottom : node.top;
    }
    return null;
  }
  const [head, ...rest] = parentPath;
  if (node.kind === "hsplit") {
    const child = head === 0 ? node.left : node.right;
    const collapsed = collapseBranch(child, rest, childStep);
    if (collapsed === null) return null;
    return head === 0 ? { ...node, left: collapsed } : { ...node, right: collapsed };
  }
  if (node.kind === "vsplit") {
    const child = head === 0 ? node.top : node.bottom;
    const collapsed = collapseBranch(child, rest, childStep);
    if (collapsed === null) return null;
    return head === 0 ? { ...node, top: collapsed } : { ...node, bottom: collapsed };
  }
  return null;
}

export function focusLeaf(tree: PaneTree, sessionId: SessionId): PaneTree {
  const path = findPath(tree, sessionId);
  if (!path) return tree;
  return { ...tree, focusedPath: path };
}

export function markLeafDead(tree: PaneTree, sessionId: SessionId): PaneTree {
  const path = findPath(tree, sessionId);
  if (!path) return tree;
  return {
    ...tree,
    root: replaceAt(tree.root, path, (n) =>
      isLeaf(n) && n.sessionId === sessionId ? { ...n, status: "dead" } : n,
    ),
  };
}

export function replaceLeafSession(
  tree: PaneTree,
  oldSessionId: SessionId,
  newSessionId: SessionId,
): PaneTree {
  const path = findPath(tree, oldSessionId);
  if (!path) return tree;
  return {
    ...tree,
    root: replaceAt(tree.root, path, (n) =>
      isLeaf(n) && n.sessionId === oldSessionId
        ? { ...n, sessionId: newSessionId, status: "alive" }
        : n,
    ),
  };
}

export function collectSessions(node: PaneNode): SessionId[] {
  if (isLeaf(node)) return [node.sessionId];
  if (isInit(node)) return [];
  if (node.kind === "hsplit")
    return [...collectSessions(node.left), ...collectSessions(node.right)];
  return [...collectSessions(node.top), ...collectSessions(node.bottom)];
}
