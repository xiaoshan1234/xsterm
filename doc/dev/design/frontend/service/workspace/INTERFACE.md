# Service · Workspace — 对外接口

> **位置**：`src/service/workspace/api.ts`
> **唯一进口**：`import { useWorkspaceService, type WorkspaceService } from "@/service/workspace/api"`

## 1. 接口

```typescript
import type { Workspace, Window, Group, PaneNode, SplitDirection } from "@/model/workspace/types";

export interface WorkspaceService {
  // ============ Workspace CRUD ============
  list(): ReadonlyArray<Workspace>;
  get(id: string): Workspace | undefined;
  useWorkspaces(): ReadonlyArray<Workspace>;
  useActiveWorkspaceId(): string | null;

  create(name?: string): string;          // 返回 workspaceId
  rename(id: string, name: string): void;
  delete(id: string): void;
  setActive(id: string): void;

  // ============ Window CRUD ============
  listWindows(workspaceId: string): ReadonlyArray<Window>;
  getWindow(windowId: string): Window | undefined;
  useWindow(windowId: string): Window | undefined;
  useWindowsByWorkspace(workspaceId: string): ReadonlyArray<Window>;

  createWindow(workspaceId: string, sessionId?: number): string;  // 返回 windowId
  createInitWindow(workspaceId: string): string;
  closeWindow(windowId: string): void;
  renameWindow(windowId: string, name: string): void;
  reorderWindows(workspaceId: string, from: number, to: number): void;
  setActiveWindow(windowId: string): void;

  // ============ Pane 操作 ============
  getPaneTree(windowId: string): PaneNode | undefined;
  usePaneTree(windowId: string): PaneNode | undefined;
  useActivePaneId(windowId: string): string | null;

  applySplitMutation(windowId: string, paneId: string, newTree: PaneNode): void;
  applyClosePaneMutation(windowId: string, paneId: string): void;
  applyResizeMutation(windowId: string, paneId: string, ratio: number): void;
  setActivePane(windowId: string, paneId: string): void;

  // ============ Group CRUD ============
  listGroups(workspaceId: string): ReadonlyArray<Group>;
  useGroupsByWorkspace(workspaceId: string): ReadonlyArray<Group>;
  createGroup(workspaceId: string, name: string): string;
  deleteGroup(groupId: string): void;
  moveSessionToGroup(sessionId: number, groupId: string): void;
}

export function useWorkspaceService(): WorkspaceService;
```

## 2. 关键设计

**Pane mutation 用 `applyXxxMutation` 命名**：

- `applySplitMutation` / `applyClosePaneMutation` / `applyResizeMutation`
- 这些**只是改 store**，**不调 IPC**——业务决定 IPC 由 app 编排
- 命名上"Mutation"提醒调用方"这是改 store 的方法"

**为什么 pane mutation 拆细**：

- 一个 split pane 操作可能涉及 5 步（关旧 pane + 开两个新 pane + 装 session + 改 active）
- app/usecases 用这些原子 mutation 组合业务编排
- 不需要 service 自己编排

## 3. 不对外暴露

- `store.ts` 的 zustand store raw
- 派生索引的实现细节（`getByWorkspace` 等）

## 4. 接缝契约

```
// app/workspace/usecases/splitPane.ts
import { useWorkspaceService } from "@/service/workspace/api";
import { createSplitNode } from "@/model/workspace/rules";

const svc = useWorkspaceService();
const oldTree = svc.getPaneTree(windowId);
const newTree = createSplitNode(oldTree, paneId, direction, newSessionId, newSessionId);
svc.applySplitMutation(windowId, paneId, newTree);
```

```
// ui/workspace/view/Sidebar/WorkspaceList.tsx
const workspaces = useWorkspaceService().useWorkspaces();  // 响应式
```

## 5. api.ts 变更流程

1. **新增 mutation** → 加 store action + api.ts 方法
2. **修改 mutation 签名** → 同步更新 §1
3. **删除 mutation** → 三处一起删除
