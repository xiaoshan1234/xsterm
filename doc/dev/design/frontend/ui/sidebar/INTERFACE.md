# Module · Sidebar — 对外接口

> **位置（目标态 / 现状一致）**：`src/ui/sidebar/`
> **消费方**：`layout/AppLayout.tsx`（唯一进口）
>
> 本文档描述 Sidebar module **对外暴露**的 React 组件 prop 接口。

## 1. 顶层入口组件

### `Sidebar`

三栏容器。

```typescript
interface SidebarProps {
  /** 当前激活的 workspace ID */
  activeWorkspaceId: string;
  /** 所有 workspace 列表 */
  workspaces: Workspace[];
  /** 所有 group 列表 */
  groups: Group[];
  /** 当前激活 session ID（高亮用） */
  activeSessionId?: number;
  /** 当前激活 window ID（高亮用） */
  activeWindowId?: string;
  /** 侧栏宽度（px） */
  width: number;
  /** 拖拽 resize 完成回调 */
  onResize: (newWidth: number) => void;
  /** 点击 session 回调 */
  onSelectSession?: (sessionId: number, configId: string) => void;
  /** 点击 window 回调 */
  onSelectWindow?: (windowId: string) => void;
  /** 点击 workspace 回调 */
  onSelectWorkspace?: (workspaceId: string) => void;
}
```

### `SidebarToolbar`

顶部按钮 + 菜单。

```typescript
interface SidebarToolbarProps {
  onNewSession: () => void;          // 触发 layout 打开 CreateSessionDialog
  onNewWorkspace: () => void;        // 调 app/modules/workspace/create
  onOpenSettings: () => void;        // layout 切换到 settings view
  onNewGroup: () => void;            // 打开 NewGroupDialog
}
```

### `SessionManager`

```typescript
interface SessionManagerProps {
  sessions: Session[];
  activeSessionId?: number;
  groups: Group[];
  onSelect: (sessionId: number, configId: string) => void;
  onRename: (sessionId: number, name: string) => void;       // 走 app/modules/session/lifecycle
  onDelete: (sessionId: number) => void;                    // 走 app/modules/session/lifecycle.closeSession
  onMoveToGroup: (sessionId: number, groupId: string) => void; // 走 app/modules/workspace/group/lifecycle
  onReorder?: (fromIndex: number, toIndex: number) => void;
}
```

### `WindowManager`

```typescript
interface WindowManagerProps {
  windows: TerminalWindow[];
  activeWindowId?: string;
  onSelect: (windowId: string) => void;
  onClose: (windowId: string) => void;       // 走 app/modules/window/lifecycle.closeWindow
  onRename: (windowId: string, name: string) => void;
}
```

### `WorkspaceManager`

```typescript
interface WorkspaceManagerProps {
  workspaces: Workspace[];
  groups: Group[];
  activeWorkspaceId: string;
  onSelect: (workspaceId: string) => void;
  onCreate: () => void;
  onRename: (workspaceId: string, name: string) => void;
  onDelete: (workspaceId: string) => void;
  onCreateGroup: () => void;        // 打开 NewGroupDialog
  onEditGroup: (groupId: string) => void;   // 打开 EditGroupDialog
  onDeleteGroup: (groupId: string) => void;
  onSaveWorkspace: (workspaceId: string) => void;   // 走 app/modules/workspace/persistence
}
```

## 2. 公开 hook

### `useSidebarResize(initialWidth: number)`

封装"用户拖拽侧栏右边界"逻辑，返回 `{ width, onResizeStart, onResizeMove, onResizeEnd }`。

### `useSessionDragDrop(sessions, onReorder)`

封装 session 拖拽排序逻辑，调用方提供 onReorder 回调（最终走 `app/modules/session/lifecycle` 或 `app/modules/workspace/group/lifecycle`）。

## 3. 不对外暴露

- 内部排序算法（应在 `app/rules/sessionRules.ts` 或 `app/rules/workspaceRules.ts`）
- 内部 group 折叠状态（用 layout 持有，不下沉到 model）
- 内部右键菜单的菜单项定义（应在 `dialogs/paneContextMenu.ts` 或类似 helper）

## 4. 跟 layout 接缝的契约

```
layout/AppLayout.tsx
    │ 读 workspace / session / group store
    │ 把 useCase 包成回调
    ▼
<Sidebar
  activeWorkspaceId={ws.id}
  workspaces={wsStore.workspaces}
  groups={persistence.groups}
  width={layoutState.sidebarWidth}
  onResize={layout.setSidebarWidth}
  onSelectSession={(sid, cid) => app/modules/session/...openSession(sid, cid)}
  onSelectWindow={(wid) => app/modules/window/lifecycle.setActiveWindow(wid)}
  onSelectWorkspace={(wid) => app/modules/workspace/...switch(wid)}
  ...
/>
```

**接缝约束**：

- 所有 `onXxx` 回调必须由 layout 注入，sidebar **不**直接 import `app/modules/*`
- store 数据通过 props 注入，sidebar **不**直接调 `useWorkspaceStore.getState()`（这是当前架构债，详见 DOWNSTREAM）
