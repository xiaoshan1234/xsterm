# Module · Terminal — 对外接口

> **位置**：`src/ui/modules/terminal/api.ts`
> **唯一进口**：其他 module 只能 `import { ... } from "@/ui/modules/terminal/api"`

## 1. 对外暴露什么

terminal module 对外只暴露 **3 类东西**：

1. **React 组件**——给 `workspace` / `shell` 嵌入用
2. **Hook**——给其他 module 订阅 terminal 状态用
3. **类型**——跨 module 通信用的契约

**禁止**对外暴露：

- xterm 实例的 ref 句柄（用回调传出，不暴露 ref）
- pane 树内部算法（应是 module 内部实现）
- 内部 store 的 mutation 方法（只能通过 hook 暴露）

## 2. 顶层组件

### `<App>`

terminal module 的"自包含入口"——`shell` 把 `<App>` 装在 workspace tab 区域内。

```typescript
interface AppProps {
  /** 当前激活 session id（workspace 注入） */
  sessionId: number;
  /** 当前 pane 树（workspace 注入；如果 session 刚创建传空） */
  paneTree?: PaneNode;
  /** 用户 split pane 的回调（terminal 不知道 workspace 怎么响应，由 workspace 提供） */
  onSplitPane: (paneId: string, direction: SplitDirection, sessionId: number) => void;
  /** 用户 close pane 的回调 */
  onClosePane: (paneId: string) => void;
  /** terminal 偏好（settings 注入） */
  fontSize: number;
  fontFamily: string;
  theme: TerminalTheme;
  /** tmux 时挂载的 control window（shell 注入） */
  renderTmuxControl?: (sessionId: number) => React.ReactNode;
}
```

`<App>` 内部自动决定：session 是 tmux 类型时挂载 `<TmuxControl>`，否则只渲染 `<Terminal>`。

### `<TerminalPane>`

`workspace` 想"嵌入一个 pane"时用（不是入口，是单个 pane）。

```typescript
interface TerminalPaneProps {
  pane: PaneNode;
  sessionId: number;
  isActive: boolean;
  onActivate: () => void;
  fontSize: number;
  theme: TerminalTheme;
}
```

## 3. 公开 Hook

### `useTerminal(sessionId)`

其他 module 想"订阅这个 session 的 xterm 状态"时用（例如 session module 想显示"session X 正在打字中"）。

```typescript
interface UseTerminalReturn {
  isReady: boolean;            // xterm 初始化完成
  cols: number;
  rows: number;
  /** 给 sessionId 写入字节（其他 module 不用，列出仅为完整性） */
  write: (data: Uint8Array) => void;
}

function useTerminal(sessionId: number): UseTerminalReturn;
```

### `usePaneTree(sessionId)`

```typescript
interface UsePaneTreeReturn {
  tree: PaneNode;
  split: (paneId: string, direction: SplitDirection, newSessionId: number) => void;
  close: (paneId: string) => void;
  resize: (paneId: string, ratio: number) => void;
}

function usePaneTree(sessionId: number): UsePaneTreeReturn;
```

## 4. 类型

```typescript
// 模型核心
type PaneNode =
  | { kind: "leaf"; id: string; sessionId: number }
  | { kind: "split"; id: string; direction: "horizontal" | "vertical"; ratio: number; children: [PaneNode, PaneNode] };

type SplitDirection = "horizontal" | "vertical";

interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  black: string; red: string; green: string; yellow: string;
  blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string;
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
}
```

## 5. 不对外暴露

- `view/` 目录下的所有内部组件——`Pane.tsx` / `PaneTree.tsx` / `ResizeHandle.tsx` / `SplitPane.tsx` / `TmuxControl.tsx` / `TmuxWindowsList.tsx` 都是 terminal 内部
- `store.ts` 的 xterm 实例 Map——只能通过 `useTerminal()` 访问
- pane 树的 DFS 算法 / split 算法——纯函数在 `model.ts`，但仅限 module 内部用

## 6. 接缝契约

```
// workspace/TabContent.tsx
import { App as TerminalApp } from "@/ui/modules/terminal/api";
import type { TerminalTheme } from "@/ui/modules/terminal/api";

function TabContent({ sessionId, theme }: { sessionId: number; theme: TerminalTheme }) {
  return (
    <TerminalApp
      sessionId={sessionId}
      fontSize={theme.fontSize}
      fontFamily={theme.fontFamily}
      theme={theme.terminal}
      onSplitPane={(paneId, dir, newSessionId) => workspaceApi.splitPane(activeWindowId, paneId, dir, newSessionId)}
      onClosePane={(paneId) => workspaceApi.closePane(activeWindowId, paneId)}
    />
  );
}
```

**接缝约束**：

- 调用方必须提供所有 `onXxx` 回调——terminal **不**知道 workspace 怎么响应 split/close
- terminal **不**自己读 session store——`sessionId` 通过 props 传入
- terminal **不**直接调 `useSettingsStore`——所有 settings 通过 props 注入
