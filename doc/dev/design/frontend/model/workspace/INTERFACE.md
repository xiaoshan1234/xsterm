# Model · Workspace — 对外接口

> **位置**：`src/model/workspace/`
> **使用方式**：`import { ... } from "@/model/workspace/types"` 等

## 1. 对外暴露什么

types / repository / events / accessor / rules（同 session domain）
+ `rules/paneTree.ts`（workspace 最重要的算法集合）

## 2. types.ts

```typescript
// Workspace
export interface Workspace {
  id: string;
  name: string;
  windows: Window[];
  activeWindowId: string | null;
  groups: Group[];
  paneTrees: Record<string, PaneNode>;   // windowId → pane tree
}

// Window
export interface Window {
  id: string;
  name: string;
  workspaceId: string;
  rootPaneId: string | null;             // null 表示 init 占位
  activePaneId: string | null;
}

// Group
export interface Group {
  id: string;
  name: string;
  parentGroupId: string | null;
  sessionIds: number[];
}

// Pane（核心——discriminated union）
export type PaneNode =
  | { kind: "leaf"; id: string; size: number; binding?: PaneBinding }
  | {
      kind: "split";
      id: string;
      size: number;
      layout: { direction: SplitDirection; children: [PaneNode, PaneNode] };
    };

export interface PaneBinding {
  sessionId: number;
  configId: string;
}

export type SplitDirection = "horizontal" | "vertical";

// 持久化
export interface PersistedWorkspace {
  id: string;
  name: string;
  windows: PersistedWindow[];
}

export interface PersistedWindow {
  id: string;
  name: string;
  paneTree: PaneNode;
}
```

## 3. repository.ts

```typescript
export interface WorkspaceRepository {
  create(name?: string): Promise<Workspace>;
  delete(id: string): Promise<void>;
  save(workspace: PersistedWorkspace): Promise<void>;
  load(id: string): Promise<PersistedWorkspace>;
  list(): ReadonlyArray<Workspace>;
  get(id: string): Workspace | undefined;
  getActive(): Workspace | undefined;
}
```

## 4. events.ts

```typescript
export interface WorkspaceSwitchedEvent {
  fromId: string | null;
  toId: string;
}

export interface WindowClosedEvent {
  workspaceId: string;
  windowId: string;
}

export interface PaneSplitEvent {
  windowId: string;
  paneId: string;
  newPaneId: string;
  direction: SplitDirection;
}

export interface PaneClosedEvent {
  windowId: string;
  paneId: string;
}

export interface PaneResizedEvent {
  windowId: string;
  paneId: string;
  ratio: number;
}

export const WorkspaceEvents = {
  Switched: "workspace-switched",
  WindowClosed: "window-closed",
  PaneSplit: "pane-split",
  PaneClosed: "pane-closed",
  PaneResized: "pane-resized",
} as const;
```

## 5. accessor.ts

```typescript
export function getActiveWorkspace(workspaces: ReadonlyArray<Workspace>): Workspace | undefined {
  // 返回最近激活的 workspace
  return workspaces[workspaces.length - 1];   // 简化：实际可能按 lastActiveAt
}

export function getWindowsByWorkspace(
  workspaces: ReadonlyArray<Workspace>,
  workspaceId: string
): ReadonlyArray<Window> {
  const ws = workspaces.find(w => w.id === workspaceId);
  return ws?.windows ?? [];
}

export function getGroupsByWorkspace(
  workspaces: ReadonlyArray<Workspace>,
  workspaceId: string
): ReadonlyArray<Group> {
  const ws = workspaces.find(w => w.id === workspaceId);
  return ws?.groups ?? [];
}

export function getUniqueWindowName(
  baseName: string,
  existing: ReadonlyArray<Window>
): string {
  // 类似 getUniqueSessionName
}

export function findPaneNode(tree: PaneNode, paneId: string): PaneNode | undefined {
  if (tree.id === paneId) return tree;
  if (tree.kind === "split") {
    return findPaneNode(tree.layout.children[0], paneId)
      ?? findPaneNode(tree.layout.children[1], paneId);
  }
  return undefined;
}

export function getLeafPanes(tree: PaneNode): PaneNode[] {
  if (tree.kind === "leaf") return [tree];
  return [...getLeafPanes(tree.layout.children[0]), ...getLeafPanes(tree.layout.children[1])];
}

export function getActivePane(tree: PaneNode, activePaneId: string | null): PaneNode | undefined {
  if (!activePaneId) return undefined;
  return findPaneNode(tree, activePaneId);
}
```

## 6. rules/

### rules/workspace.ts

```typescript
export function addWindow(workspace: Workspace, window: Window): Workspace {
  return { ...workspace, windows: [...workspace.windows, window] };
}

export function removeWindow(workspace: Workspace, windowId: string): Workspace {
  return {
    ...workspace,
    windows: workspace.windows.filter(w => w.id !== windowId),
    activeWindowId: workspace.activeWindowId === windowId ? null : workspace.activeWindowId,
  };
}

export function renameWindow(workspace: Workspace, windowId: string, name: string): Workspace {
  return {
    ...workspace,
    windows: workspace.windows.map(w => w.id === windowId ? { ...w, name } : w),
  };
}

export function reorderWindows(
  workspace: Workspace,
  fromIndex: number,
  toIndex: number
): Workspace {
  const windows = [...workspace.windows];
  const [moved] = windows.splice(fromIndex, 1);
  windows.splice(toIndex, 0, moved);
  return { ...workspace, windows };
}
```

### rules/window.ts

```typescript
export function createWindow(name: string, workspaceId: string): Window {
  return {
    id: generateId(),
    name,
    workspaceId,
    rootPaneId: null,
    activePaneId: null,
  };
}

export function createInitWindow(name: string = "New Session", workspaceId: string): Window {
  return { ...createWindow(name, workspaceId), rootPaneId: null };   // init window 是无 pane 的 window
}
```

### rules/group.ts

```typescript
export function addGroup(workspace: Workspace, name: string): { workspace: Workspace; group: Group } {
  const group: Group = {
    id: generateId(),
    name,
    parentGroupId: null,
    sessionIds: [],
  };
  return {
    workspace: { ...workspace, groups: [...workspace.groups, group] },
    group,
  };
}

export function removeGroup(workspace: Workspace, groupId: string): Workspace {
  return {
    ...workspace,
    groups: workspace.groups.filter(g => g.id !== groupId),
  };
}

export function moveSessionToGroup(
  groups: ReadonlyArray<Group>,
  sessionId: number,
  groupId: string
): ReadonlyArray<Group> {
  return groups.map(g => {
    if (g.sessionIds.includes(sessionId)) {
      return { ...g, sessionIds: g.sessionIds.filter(id => id !== sessionId) };
    }
    if (g.id === groupId) {
      return { ...g, sessionIds: [...g.sessionIds, sessionId] };
    }
    return g;
  });
}
```

### rules/paneTree.ts（**核心算法**）

```typescript
export function createLeafPane(size: number, sessionId?: number, configId?: string): PaneNode {
  const binding = sessionId !== undefined ? { sessionId, configId: configId ?? "" } : undefined;
  return { kind: "leaf", id: generateId(), size, binding };
}

export function createSplitNode(
  direction: SplitDirection,
  first: PaneNode,
  second: PaneNode
): PaneNode {
  return {
    kind: "split",
    id: generateId(),
    size: first.size + second.size,
    layout: { direction, children: [first, second] },
  };
}

/**
 * 把 paneId 指向的 pane 拆成两个——原 pane 留作 first，新 pane 作 second
 */
export function splitPane(
  tree: PaneNode,
  paneId: string,
  direction: SplitDirection,
  newSessionId: number,
  newConfigId: string
): PaneNode {
  const target = findPaneNode(tree, paneId);
  if (!target || target.kind !== "leaf") return tree;
  
  // 把 target pane 一分为二
  const firstHalf: PaneNode = { ...target, size: target.size / 2 };
  const secondHalf: PaneNode = createLeafPane(target.size / 2, newSessionId, newConfigId);
  const newSplit = createSplitNode(direction, firstHalf, secondHalf);
  
  return replacePaneNode(tree, paneId, newSplit);
}

/**
 * 移除指定 pane——把它的兄弟提升到父位置
 */
export function closePane(tree: PaneNode, paneId: string): PaneNode {
  const parent = findParent(tree, paneId);
  if (!parent) return tree;   // 没找到
  
  if (parent.kind === "split" && parent.layout.children[0].id === paneId) {
    return replacePaneNode(tree, parent.id, parent.layout.children[1]);
  }
  if (parent.kind === "split" && parent.layout.children[1].id === paneId) {
    return replacePaneNode(tree, parent.id, parent.layout.children[0]);
  }
  return tree;   // 顶层 pane，关闭整个 tree？
}

export function resizePane(tree: PaneNode, paneId: string, ratio: number): PaneNode {
  // 调整 paneId 父 split 的 ratio
  const parent = findParent(tree, paneId);
  if (!parent || parent.kind !== "split") return tree;
  
  return replacePaneNode(tree, parent.id, {
    ...parent,
    layout: {
      ...parent.layout,
      children: ratioAdjust(parent.layout.children, paneId, ratio),
    },
  });
}

export function replacePaneNode(tree: PaneNode, paneId: string, replacement: PaneNode): PaneNode {
  if (tree.id === paneId) return replacement;
  if (tree.kind === "split") {
    return {
      ...tree,
      layout: {
        ...tree.layout,
        children: [
          replacePaneNode(tree.layout.children[0], paneId, replacement),
          replacePaneNode(tree.layout.children[1], paneId, replacement),
        ],
      },
    };
  }
  return tree;
}

function findParent(tree: PaneNode, paneId: string): PaneNode | undefined {
  if (tree.kind !== "split") return undefined;
  if (tree.layout.children[0].id === paneId || tree.layout.children[1].id === paneId) return tree;
  return findParent(tree.layout.children[0], paneId) ?? findParent(tree.layout.children[1], paneId);
}

function ratioAdjust(children: [PaneNode, PaneNode], paneId: string, ratio: number): [PaneNode, PaneNode] {
  // 调整 paneId 的相对大小
  const total = children[0].size + children[1].size;
  if (children[0].id === paneId) {
    return [{ ...children[0], size: total * ratio }, { ...children[1], size: total * (1 - ratio) }];
  }
  return [{ ...children[0], size: total * (1 - ratio) }, { ...children[1], size: total * ratio }];
}
```

## 7. 不对外暴露

`findParent` / `ratioAdjust` 等内部辅助函数（在 paneTree rules 内部）。

## 8. api.ts 变更流程

1. **新增算法** → 加到 rules/ 对应子目录
2. **修改算法签名** → 同步更新 §6
3. **删除算法** → 直接删除
