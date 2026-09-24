# Module · Terminal — 对外接口

> **位置（目标态）**：`src/ui/terminal/`
> **消费方**：`layout/WorkspaceContainer.tsx`（唯一进口）、`layout/AppLayout.tsx`（间接持有状态）
>
> 本文档描述 Terminal module **对外暴露**的 React 组件 prop 接口。模块内部状态与子组件**不**算对外接口。

## 1. 顶层入口组件

### `Terminal`

主入口，渲染一个 pane 节点（递归处理 split 子树）。

```typescript
interface TerminalProps {
  /** 当前 pane 节点（递归渲染 split 子树） */
  pane: PaneNode;
  /** 当前 workspace ID（写回 model 时需要） */
  workspaceId: string;
  /** 当前 window ID */
  windowId: string;
  /** 用户点击 tab 的回调（layout 负责 setActiveWindow） */
  onSelectWindow?: (windowId: string) => void;
  /** 当 init pane 用户选择"新建"时回调，layout 打开 dialog */
  onRequestCreateSession?: (paneId: string) => void;
  /** tmux 会话附挂的 control window view（通过 props 注入，避免直引 ui/tmux） */
  renderTmuxControl?: (sessionId: number) => React.ReactNode;
}
```

**约束**：Terminal 不持有 xterm 实例的生命周期——xterm 实例的生命周期由 Terminal 内部 useEffect 管理，但 xterm 输出流绑定的是 `service/output/sessionOutputChannel`（订阅 backend session-output 事件），而非 Terminal 自己持有 socket。

### `WindowTabBar`

Workspace 级别的 tab 条，列出当前 workspace 所有 window 的 tab。

```typescript
interface WindowTabBarProps {
  windows: TerminalWindow[];
  activeWindowId: string;
  onSelectWindow: (windowId: string) => void;
  onCloseWindow: (windowId: string) => void;
  onRenameWindow: (windowId: string, name: string) => void;
  onReorderWindows: (fromIndex: number, toIndex: number) => void;
}
```

**约束**：4 个回调全部走 props 注入，不在内部调 `app/modules/window/*`。layout 把 `app/modules/window/lifecycle` 的 useCase 包成回调传进来。

### `PaneInitCard`

Init 占位 pane 的引导卡片（"点击新建"或"从已保存配置选"）。

```typescript
interface PaneInitCardProps {
  onCreateNew: () => void;
  onPickSaved: () => void;
}
```

### `CommandSendPanel`

tmux command 发送面板（send-keys / new-window 等）。

```typescript
interface CommandSendPanelProps {
  sessionId: number;        // tmux session
  /** 命令历史（由父组件从 store 拿，避免面板自己订阅） */
  recentCommands?: string[];
}
```

## 2. 公开 hook（仅供 layout / 其他 module 复用）

### `useTerminalResize(paneId: string)`

封装"用户拖拽 pane 边界"→ 调 `app/modules/pane/lifecycle.resizePane` 的副作用。**注意**：当前代码 `Terminal.tsx` 内联了这段逻辑，没有独立 hook。改造 PR 应抽出。

返回：

```typescript
{
  isDragging: boolean;
  onResizeStart: (e: React.PointerEvent) => void;
  onResizeMove: (deltaPx: number) => void;
  onResizeEnd: () => void;
}
```

## 3. 不对外暴露

以下内容是 terminal module **内部**使用，**禁止**被 sidebar / settings / dialogs 直接 import：

- 内部 pane 树遍历辅助函数（应在 `app/rules/paneTree.ts`，terminal 只调用，不实现）
- xterm 实例的 useRef 句柄（必须用 onOutput / onData 回调传出）
- ResizeHandle 子组件（仅 Pane / PaneTree 内部使用）

## 4. 跟 layout 接缝的契约

```
layout/WorkspaceContainer.tsx
    │ 读 workspace store → 拿到当前 activeWindow
    ▼
<WindowTabBar windows={...} activeWindowId={...} onSelectWindow={...} />
    │
    ▼
<Terminal pane={activeWindow.rootPane} workspaceId={...} windowId={...}
          onSelectWindow={layout.handleSelectWindow}
          onRequestCreateSession={layout.openSelectSessionDialog}
          renderTmuxControl={(sid) => <TmuxControlWindowView sessionId={sid} />} />
```

**接缝约束**：

- layout 必须提供 `renderTmuxControl`（即使是返回 null），避免 Terminal 自己 `import { TmuxControlWindowView } from "../tmux/..."`
- layout 必须提供所有 `onXxx` 回调，Terminal 不内联 useCase 调用
