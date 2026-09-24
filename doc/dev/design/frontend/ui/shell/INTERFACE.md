# Module · Shell — 对外接口

> **位置**：`src/ui/modules/shell/api.ts`
> **唯一进口**：`main.tsx` + 其他 module 通过 `import { ... } from "@/ui/modules/shell/api"`

## 1. 对外暴露什么

shell module 对外暴露 **4 类东西**：

1. **`<App>` 顶层入口** — `main.tsx` 唯一渲染的东西
2. **跨 module UI 原子** — `<Icon>` `<Button>` `<Tooltip>` `<Dialog>` `<FormField>` `<ContextMenu>`
3. **跨 module Hook** — `useAppShell()` 拿 shell 状态
4. **类型** — `AppShellState` 等

## 2. 顶层组件

### `<App>`

xsterm 的最顶层。`main.tsx` 只渲染这一个组件。

```typescript
interface AppProps {
  /** 可选：是否自动加载上次会话（默认 true） */
  autoLoadLastWorkspace?: boolean;
}

function App(props: AppProps): JSX.Element;
```

`<App>` 内部：

- 调 `init.ts` 启动序列
- 渲染 `<TitleBar>` + `<Layout>` + `<StatusBar>`
- `<Layout>` 内部嵌入 `<WorkspaceApp>` + 抽屉里的 `<SettingsDrawer>`

### `<Icon>`

跨 module 共用图标组件。

```typescript
interface IconProps {
  name: string;                    // 图标名（如 "settings", "plus", "trash"）
  size?: number;
  color?: string;
  onClick?: () => void;
}
```

### `<Button>`

```typescript
interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "small" | "medium" | "large";
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  onClick?: () => void;
  children: React.ReactNode;
}
```

### `<Dialog>`

```typescript
interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  width?: number;
  children: React.ReactNode;
}
```

> **注意**：`<Dialog>` 是壳组件（背景遮罩、ESC、focus trap），业务 dialog 由 feature module 自己实现。

### `<FormField>`

```typescript
interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  description?: string;
  children: React.ReactNode;        // 真正的 input
}
```

### `<Tooltip>` / `<ContextMenu>`

```typescript
interface TooltipProps {
  content: React.ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
  children: React.ReactElement;
}

interface ContextMenuProps {
  items: ReadonlyArray<{ id: string; label: string; onSelect: () => void; disabled?: boolean }>;
  children: React.ReactElement;    // 触发元素
}
```

## 3. 公开 Hook

### `useAppShell()`

跨 module 访问 shell 状态（其他 module 想"打开设置抽屉" / "显示 dialog" 时用）。

```typescript
interface UseAppShellReturn {
  // 视图路由
  currentView: "workspace" | "settings";
  openSettings: () => void;
  closeSettings: () => void;

  // 全局 dialog 编排（feature module 想弹 dialog 时通过这个）
  activeDialog: DialogDescriptor | null;
  openDialog: (descriptor: DialogDescriptor) => void;
  closeDialog: () => void;

  // shell 自身状态
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  isMaximized: boolean;
  toggleMaximize: () => void;
}

type DialogDescriptor =
  | { kind: "createSession"; payload?: { workspaceId?: string } }
  | { kind: "editSession"; payload: { sessionId: number } }
  | { kind: "selectSaved"; payload: { workspaceId?: string; paneId?: string } }
  | { kind: "saveWorkspace"; payload: { workspaceId: string } }
  | { kind: "confirm"; payload: { title: string; message: string; onConfirm: () => void } };
```

**关键设计**：feature module **不**直接控制 dialog 渲染，而是通过 `useAppShell().openDialog({ kind: "createSession" })` 触发，由 shell 决定渲染哪个 dialog 组件。这避免了"dialog 在谁手里"的混乱。

## 4. 不对外暴露

- `view/` 内部组件（TitleBar / WindowControls / Layout / StatusBar）——shell 内部装配
- `store.ts` 的 setter——只能通过 `useAppShell()` 暴露的接口
- `init.ts` 的具体步骤——只能由 `<App>` 调用

## 5. 接缝契约

```
// src/main.tsx
import { App } from "@/ui/modules/shell/api";
import "@/ui/modules/shell/styles/global.css";   // 设计系统 CSS

const root = createRoot(document.getElementById("root")!);
root.render(<App autoLoadLastWorkspace={true} />);
```

**接缝约束**：

- main.tsx **只** import `shell/api.ts`，不 import 任何 feature module
- feature module **不** import `main.tsx`
- feature module 想用 UI 原子 → `import { Button } from "@/ui/modules/shell/api"`
- feature module 想打开 dialog → `const shell = useAppShell(); shell.openDialog({ kind: "..." })`
