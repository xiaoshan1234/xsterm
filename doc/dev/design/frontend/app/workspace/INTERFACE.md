# Module · App Workspace — 对外接口

> **位置**：`src/app/modules/workspace/api.ts`
> **唯一进口**：`import { ... } from "@/app/modules/workspace/api"`

## 1. 对外暴露什么

1. **`WorkspaceApi` 接口** — 完整 workspace + window + pane + group 业务编排
2. **`openSession()`** — 把 session 装到 pane（被 session module 调用）

## 2. 核心接口

```typescript
import type {
  Workspace,
  Window,
  Group,
  PaneNode,
  SplitDirection,
  PersistedWorkspace,
} from "@/model";

export interface WorkspaceApi {
  // ============ Workspace CRUD ============
  createWorkspace(name?: string): Promise<string>;        // 返回 workspaceId
  closeWorkspace(workspaceId: string): Promise<void>;
  renameWorkspace(workspaceId: string, name: string): Promise<void>;
  saveWorkspace(workspaceId: string, name?: string): Promise<void>;
  loadWorkspace(workspaceId: string): Promise<void>;
  loadLastWorkspace(): Promise<void>;                     // shell.initialize() 调
  deleteSavedWorkspace(workspaceId: string): Promise<void>;

  // ============ Window CRUD ============
  createWindow(workspaceId: string, sessionId?: number): Promise<string>;
  createInitWindow(workspaceId: string): Promise<string>;          // 占位 window
  createTmuxWindow(workspaceId: string, sessionName: string): Promise<{ windowId: string; paneId: string }>;
  replaceInitWindow(workspaceId: string, windowId: string, sessionId: number, configId: string, name?: string): Promise<void>;
  closeWindow(workspaceId: string, windowId: string): Promise<void>;
  renameWindow(workspaceId: string, windowId: string, name: string): Promise<void>;
  reorderWindows(workspaceId: string, fromIndex: number, toIndex: number): Promise<void>;
  setActiveWindow(workspaceId: string, windowId: string): void;

  // ============ Pane 业务 ============
  splitPane(windowId: string, paneId: string, direction: SplitDirection, newSessionId: number): Promise<void>;
  closePane(windowId: string, paneId: string): Promise<void>;
  resizePane(windowId: string, paneId: string, ratio: number): Promise<void>;
  setActivePane(windowId: string, paneId: string): void;

  // ============ Group CRUD ============
  createGroup(name: string): Promise<string>;
  deleteGroup(groupId: string): Promise<void>;
  moveConfigToGroup(sessionId: number, groupId: string): Promise<void>;

  // ============ Saved window ============
  saveWindow(workspaceId: string, windowId: string, name?: string): Promise<string>;
  loadWindow(workspaceId: string, configId: string): Promise<void>;
  deleteSavedWindow(configId: string): Promise<void>;

  // ============ 跨 module 协调 ============
  /** 把 session 装到 workspace 的 pane（被 app/session 调用） */
  openSession(sessionId: number, configId: string, workspaceId: string, paneId?: string): Promise<void>;
  // ↑ 内部可能调 app/terminal/api.ts（如果 session 是 tmux 类型）
}

export function useWorkspaceApi(): WorkspaceApi;
```

## 3. 跨 module 调用的具体实现

```typescript
// modules/workspace/usecases/openSession.ts
import { useTerminalApi } from "@/app/modules/terminal/api";   // ✅ 跨 module 调 api.ts
import { useSessionStore } from "@/service/session/store";

export async function openSession(
  sessionId: number,
  configId: string,
  workspaceId: string,
  paneId?: string
): Promise<void> {
  const session = useSessionStore.getState().sessions.find(s => s.id === sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  // 普通 PTY / SSH session：直接装到 pane
  if (session.kind === "local" || session.kind === "ssh") {
    // ...装到 pane 的 store
    return;
  }

  // tmux session：调 terminal module 创建 tmux pane
  if (session.kind === "tmux") {
    const terminal = useTerminalApi();
    await terminal.attachTmuxSession(sessionId);
    // ...装到 pane
    return;
  }
}
```

**关键**：workspace 通过 `useTerminalApi()` 间接调 tmux 业务，**不**直接 import `app/terminal/usecases/*`。

## 4. 接缝契约

```
// ui/workspace/view/Sidebar/SessionListItem.tsx
import { useWorkspaceApi } from "@/app/modules/workspace/api";

function SessionListItem({ sessionId, configId, workspaceId }) {
  const workspace = useWorkspaceApi();

  return (
    <div onClick={() => workspace.openSession(sessionId, configId, workspaceId)}>
      {name}
    </div>
  );
}
```

## 5. 不对外暴露

- `usecases/*` 内部文件——只能通过 api.ts
- workspace tree store 的 setter——只能通过 hook

## 6. api.ts 变更流程

1. **新增 useCase** → 加 usecases/ + 加 api.ts 方法
2. **修改 useCase 签名** → 同步更新 api.ts + INTERFACE.md §2
3. **删除 useCase** → 从 usecases/ 和 api.ts 一起删除
4. **跨 module 协调变更** → 同步更新 §3 跨 module 调用实现
