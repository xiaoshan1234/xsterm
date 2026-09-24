# Module · Hooks — 对外接口

> **位置（目标态）**：`src/ui/hooks/`
> **消费方**：layout / terminal / sidebar

## 1. 已实现 hook

### `useCommandExecutor`

```typescript
interface UseCommandExecutorReturn {
  execute: (commandId: string, args?: Record<string, any>) => Promise<void>;
  /** 当前可用的命令列表（自动从 useCommandTargets 汇总） */
  availableCommands: CommandDescriptor[];
}

interface CommandDescriptor {
  id: string;
  label: string;
  shortcut?: string;        // 如 "Cmd+N"
  category: string;         // "session" / "window" / "workspace"
}

function useCommandExecutor(): UseCommandExecutorReturn;
```

### `useCommandTargets`

```typescript
interface CommandTarget {
  id: string;
  match: (input: string) => boolean;        // 命令面板的输入匹配
  run: (args?: any) => void | Promise<void>;
}

function useCommandTargets(targets: CommandTarget[]): void;
```

### `useSessionDragDrop`

```typescript
interface UseSessionDragDropReturn {
  /** 给列表项用的 drag 属性 */
  draggableProps: {
    draggable: true;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: (e: React.DragEvent) => void;
  };
  /** 给 drop target 用的属性 */
  dropTargetProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  isDragging: boolean;
  isDragOver: boolean;
}

interface UseSessionDragDropProps<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (fromId: string, toId: string) => void;
}

function useSessionDragDrop<T>(props: UseSessionDragDropProps<T>): UseSessionDragDropReturn;
```

## 2. 待实现 hook（改造 PR）

### `useTerminalResize`

```typescript
interface UseTerminalResizeReturn {
  isDragging: boolean;
  onResizeStart: (e: React.PointerEvent) => void;
  onResizeMove: (deltaPx: number) => void;
  onResizeEnd: () => void;
}

function useTerminalResize(paneId: string): UseTerminalResizeReturn;
```

### `useSidebarResize`

```typescript
interface UseSidebarResizeReturn {
  width: number;
  isDragging: boolean;
  onResizeStart: (e: React.PointerEvent) => void;
  onResizeMove: (deltaPx: number) => void;
  onResizeEnd: () => void;
}

function useSidebarResize(initialWidth: number, min?: number, max?: number): UseSidebarResizeReturn;
```

## 3. 不对外暴露

- hook 内部 state 实现细节
- 命令匹配的内部算法（在 useCommandTargets / useCommandExecutor 内部，调用方只调 hook）
- 拖拽事件的内部坐标计算

## 4. 跟调用方接缝的契约

```
// layout/AppLayout.tsx
import { useCommandExecutor, useCommandTargets } from "ui/hooks";

function AppLayout() {
  const targets: CommandTarget[] = [
    { id: "newSession", match: (i) => i === "new", run: () => openCreateSessionDialog() },
    { id: "newWorkspace", match: (i) => i === "workspace", run: () => createWorkspace() },
    // ...
  ];
  useCommandTargets(targets);
  const { execute, availableCommands } = useCommandExecutor();
  // ...
}
```

**接缝约束**：

- hook 调用方**必须**是 React 函数组件（或自定义 hook）——hook 内部用 useState/useEffect
- hook 不直跳 infra——hook 调 useCase，useCase 调 service
- hook 不持有跨 module 全局状态——状态由调用方 component 持有
