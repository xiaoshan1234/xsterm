# Module · Layout — 对外接口

> **位置（目标态）**：`src/ui/layout/`
> **消费方**：`src/main.tsx` → `src/App.tsx`（唯一进口）

## 1. 顶层入口组件

### `AppLayout`

app 的最顶层组件，`main.tsx → App.tsx → <AppLayout />`。

```typescript
interface AppLayoutProps {
  /** 可选：注入 IPC bridge（默认用 service/infra 默认实现） */
  ipcBridge?: IpcBridge;
  /** 可选：启动时是否自动加载上次会话（默认 true） */
  autoLoadLastWorkspace?: boolean;
}
```

AppLayout 内部组装：

```
<AppLayout>
  ├── <NavBar />
  ├── <div className="app-body">          ← 横向 flex
  │     ├── <Sidebar />                   ← 左侧
  │     └── <WorkspaceContainer />        ← 右侧
  │           ├── <WindowTabBar />        ← 顶部 tab
  │           ├── <Terminal />            ← 主区
  │           └── <WorkspaceBottomBar />  ← 底部
  └── <SettingsDrawer />                  ← 按需挂载
```

### `NavBar`

自定义标题栏（窗口控制按钮 + 应用标题 + 设置入口）。

```typescript
interface NavBarProps {
  title?: string;                          // 应用标题，默认 "xsterm"
  onOpenSettings: () => void;              // 触发 layout 切换到 settings
  onOpenCommandPalette?: () => void;       // 可选：命令面板入口
}
```

**窗口控制**：`NavBar` 内部用 `getCurrentWindow().minimize()/maximize()/close()`，由 `@tauri-apps/api` 提供，**不**对外暴露。

### `WorkspaceContainer`

工作区主容器。

```typescript
interface WorkspaceContainerProps {
  workspaceId: string;
  activeWindowId: string;
  onSelectWindow: (windowId: string) => void;
  onCloseWindow: (windowId: string) => void;
  onRenameWindow: (windowId: string, name: string) => void;
  onReorderWindows: (fromIndex: number, toIndex: number) => void;
  /** tmux control view 渲染函数（layout 注入，避免 terminal 直引 ui/tmux） */
  renderTmuxControl: (sessionId: number) => React.ReactNode;
  /** init pane 用户操作回调 */
  onRequestCreateSession: (paneId: string) => void;
  onRequestPickSaved: (paneId: string) => void;
}
```

### `WorkspaceBottomBar`

底部状态栏。

```typescript
interface WorkspaceBottomBarProps {
  activeSessionId?: number;
  activeSessionName?: string;
  tmuxStatus?: "attached" | "detached" | "n/a";
  bytesWritten?: number;
}
```

### `InitWindowView`

启动占位视图（首次启动时显示"点击新建 session"）。

```typescript
interface InitWindowViewProps {
  onCreate: () => void;        // 触发 layout 打开 CreateSessionDialog
  onOpenSaved: () => void;     // 触发 layout 打开 SelectSessionDialog
}
```

## 2. 公开 hook

### `useAppShell()`

封装整个 app shell 的状态——settings drawer 是否打开、当前 dialog 状态、active workspace 等。**这是 layout 提供的唯一 React context hook**，其他 module 通过这个 hook 跟 layout 通信。

```typescript
interface UseAppShellReturn {
  // view 路由
  currentView: "workspace" | "settings";
  openSettings: () => void;
  closeSettings: () => void;

  // dialog 编排（替代每个 manager 各自 useState）
  dialog: DialogState;
  openDialog: (dialog: DialogKind, props?: any) => void;
  closeDialog: () => void;

  // 窗口状态（用于 NavBar 显示最大化按钮）
  isMaximized: boolean;
  toggleMaximize: () => void;
}

type DialogKind =
  | "createSession"
  | "editSession"
  | "selectSession"
  | "newGroup"
  | "editGroup"
  | "saveWorkspace"
  | "pasteConfirm";
```

## 3. 不对外暴露

- 内部 store hydration 逻辑（应在 `service/persistence` 的 boot 序列）
- 内部 view 路由状态（应通过 `useAppShell` 访问，不直接 useState）
- 内部 window control 实现细节

## 4. 跟调用方接缝的契约

```
// src/App.tsx
import { AppLayout } from "ui/layout/AppLayout";

export function App() {
  return <AppLayout autoLoadLastWorkspace={true} />;
}
```

**接缝约束**：

- App.tsx 只 `<AppLayout />` 一行，不传 props 也行（默认值可用）
- App.tsx 不持有任何业务状态——所有状态在 layout 内部或 store
- main.tsx 不直接 import 其他 ui module——只能通过 App.tsx → AppLayout
