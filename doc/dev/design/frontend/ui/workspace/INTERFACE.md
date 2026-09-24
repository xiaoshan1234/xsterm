# Module · Workspace — 对外接口

> **位置**：`src/ui/modules/workspace/api.ts`
> **唯一进口**：`shell` 嵌入 + 其他 module 通过 `import { ... } from "@/ui/modules/workspace/api"`

## 1. 对外暴露什么

1. **`<App>` 主入口** — shell 嵌入
2. **工作区 CRUD Hook** — 业务编排
3. **类型** — `Workspace` `Window` `PaneNode`

## 2. 顶层组件

### `<App>`

workspace module 的"自包含入口"——shell 把它装在主槽位。

```typescript
interface AppProps {
  /** 启动时是否恢复上次的 workspace（shell 注入） */
  autoRestore?: boolean;
  /** 当前主题（shell 注入） */
  theme: TerminalTheme;
  /** terminal 偏好（settings 注入，透传给 terminal） */
  terminalFontSize: number;
  terminalFontFamily: string;
}

function App(props: AppProps): JSX.Element;
```

`<App>` 内部组装：

- `<Sidebar>` 三栏
- `<TabBar>` window tab
- `<TabContent>` 当前 tab 的内容（嵌入 `<TerminalApp>`）
- `<StatusBar>`

## 3. 公开 Hook

### `useWorkspaceApi()`

跨 module 访问 workspace 业务能力。

```typescript
interface WorkspaceApi {
  // 工作区 CRUD
  createWorkspace: (name?: string) => Promise<string>;     // 返回 workspaceId
  switchWorkspace: (workspaceId: string) => void;
  renameWorkspace: (workspaceId: string, name: string) => void;
  deleteWorkspace: (workspaceId: string) => void;
  saveWorkspace: (workspaceId: string, name?: string) => Promise<void>;
  loadWorkspace: (workspaceId: string) => Promise<void>;

  // Window CRUD
  createWindow: (workspaceId: string, sessionId?: number) => Promise<string>;  // 返回 windowId
  closeWindow: (workspaceId: string, windowId: string) => void;
  renameWindow: (workspaceId: string, windowId: string, name: string) => void;
  setActiveWindow: (workspaceId: string, windowId: string) => void;
  reorderWindows: (workspaceId: string, fromIndex: number, toIndex: number) => void;

  // Pane CRUD（workspace 维度）
  splitPane: (windowId: string, paneId: string, direction: SplitDirection, newSessionId: number) => void;
  closePane: (windowId: string, paneId: string) => void;
  resizePane: (windowId: string, paneId: string, ratio: number) => void;
  setActivePane: (windowId: string, paneId: string) => void;

  // Group
  createGroup: (name: string) => Promise<string>;
  deleteGroup: (groupId: string) => void;
  moveSessionToGroup: (sessionId: number, groupId: string) => void;

  // Session 入口（由 session module 提供实现，workspace 编排）
  openSession: (sessionId: number, configId: string) => Promise<void>;

  // 状态订阅
  workspaces: ReadonlyArray<Workspace>;
  activeWorkspaceId: string | null;
  activeWindowId: string | null;
  activePaneId: string | null;
  groups: ReadonlyArray<Group>;
}

function useWorkspaceApi(): WorkspaceApi;
```

### `useWindowTabBar(workspaceId)`

`<TabBar>` 想"列出这个 workspace 所有 window"时用。

```typescript
interface UseWindowTabBarReturn {
  windows: ReadonlyArray<Window>;
  activeWindowId: string | null;
  setActiveWindow: (windowId: string) => void;
  closeWindow: (windowId: string) => void;
  renameWindow: (windowId: string, name: string) => void;
  reorder: (fromIndex: number, toIndex: number) => void;
}

function useWindowTabBar(workspaceId: string): UseWindowTabBarReturn;
```

### `useSidebar(workspaceId)`

```typescript
interface UseSidebarReturn {
  sessions: ReadonlyArray<Session>;
  windows: ReadonlyArray<Window>;
  workspaces: ReadonlyArray<Workspace>;
  groups: ReadonlyArray<Group>;

  onSelectSession: (sessionId: number, configId: string) => void;
  onRenameSession: (sessionId: number, name: string) => void;
  onDeleteSession: (sessionId: number) => void;
  onMoveToGroup: (sessionId: number, groupId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  // ...其他回调
}

function useSidebar(workspaceId: string): UseSidebarReturn;
```

## 4. 类型

```typescript
interface Workspace {
  id: string;
  name: string;
  windows: Window[];
  activeWindowId: string | null;
  groups: Group[];
  paneTrees: Record<string, PaneNode>;   // windowId → pane tree
}

interface Window {
  id: string;
  name: string;
  workspaceId: string;
  rootPaneId: string | null;             // null 表示 init 占位
  activePaneId: string | null;
}

interface Group {
  id: string;
  name: string;
  parentGroupId: string | null;
  sessionIds: number[];
}

interface PaneNode {
  kind: "leaf" | "split";
  id: string;
  direction?: "horizontal" | "vertical";
  ratio?: number;
  sessionId?: number;
  children?: [PaneNode, PaneNode];
}
```

## 5. 不对外暴露

- `view/` 内部组件（TabBar / Sidebar / TabContent / PaneContainer / StatusBar）——只能通过 `<App>` 暴露
- `store.ts` 的直接 mutation——只能通过 hook
- pane 树的 DFS 算法 / split ratio 计算——在 `model.ts` 内部

## 6. 接缝契约

```
// shell/view/Layout.tsx
import { App as WorkspaceApp } from "@/ui/modules/workspace/api";
import type { TerminalTheme } from "@/ui/modules/terminal/api";

function Layout() {
  const settings = useSettingsApi();
  return (
    <main>
      <Sidebar />    {/* shell 自带 */}
      <WorkspaceApp
        theme={settings.terminalTheme}
        terminalFontSize={settings.terminalFontSize}
        terminalFontFamily={settings.terminalFontFamily}
      />
    </main>
  );
}
```

**接缝约束**：

- workspace **不** import `shell` 的内部 view 组件
- workspace **不** import `session` 的 dialog 组件（通过 `useAppShell().openDialog({ kind: "createSession" })` 间接触发）
- workspace 通过 `useWorkspaceApi()` 暴露完整的业务能力——其他 module 想"创建 workspace"也是调这个 hook
