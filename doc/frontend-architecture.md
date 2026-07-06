# xsterm 前端架构文档

> 文档描述 xsterm 前端（`src/` 目录）的整体架构、模块职责、数据流与关键设计决策。后端（Tauri + Rust）仅在与前端交互的边界处提及。

---

## 1. 技术栈与项目结构

### 1.1 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | React 19 + TypeScript | 函数组件 + Hooks |
| 构建工具 | Vite 7 | 开发服务器与生产打包 |
| 跨端壳 | Tauri 2 | 前端通过 `@tauri-apps/api` 调用 Rust 命令 |
| 终端渲染 | xterm.js 6 | `Terminal.tsx` 封装 xterm 实例 |
| 状态管理 | React Context + `useState`/`useReducer` | 无 Redux/Zustand，状态集中在 `SessionContext` |
| 样式 | 全局 CSS | `src/styles/*.css`，无 CSS-in-JS 框架 |

### 1.2 目录结构

```
src/
├── App.tsx                 # 根组件，挂载 Context Provider
├── main.tsx                # React 应用入口
├── components/             # React 组件
│   ├── AppLayout.tsx       # 主布局：NavBar + Sidebar + 主内容区
│   ├── TabBar.tsx          # 顶部 workspace 标签栏
│   ├── WorkspaceContainer.tsx  # 单个 workspace 的容器
│   ├── PaneTree.tsx        # workspace 内 pane 树的递归渲染
│   ├── Pane.tsx            # 单个 pane：渲染 Terminal 或 TmuxSessionView
│   ├── Terminal.tsx        # xterm.js 终端封装
│   ├── TmuxSessionView.tsx # tmux 会话视图（窗口标签 + pane）
│   ├── TmuxWindowTabs.tsx  # tmux 窗口标签栏
│   ├── CommandSendPanel.tsx# 底部命令发送面板
│   ├── NavBar.tsx          # 顶部导航栏
│   ├── sidebar/            # 左侧边栏相关
│   │   ├── Sidebar.tsx
│   │   ├── SessionManager.tsx   # saved session 列表
│   │   ├── WorkspaceManager.tsx # saved workspace 列表
│   │   └── ...
│   ├── dialogs/            # 弹窗组件
│   ├── ui/                 # 通用 UI 组件（Dialog、ContextMenu 等）
│   └── settings/           # 设置面板
├── contexts/               # React Context
│   ├── SessionContext.tsx       # 核心：会话、workspace、tmux 状态
│   ├── session/
│   │   ├── useSessionState.ts       # state 定义与 refs
│   │   ├── useSessionActions.ts     # 业务 action 函数
│   │   ├── useSessionPersistence.ts # 本地持久化
│   │   ├── useTauriListeners.ts     # Tauri 事件监听
│   │   ├── paneUtils.ts             # pane 树工具函数
│   │   └── types.ts                 # context 类型定义
│   ├── tmuxStateReducer.ts      # tmux 状态 reducer
│   ├── ThemeContext.tsx         # 主题管理
│   └── LoggerContext.tsx        # 日志（console + Rust）
├── services/               # 调用 Tauri 命令的服务层
│   ├── sessionService.ts   # local / SSH 会话命令
│   ├── tmuxService.ts      # tmux 控制命令
│   └── sessionStorage.ts   # Tauri store 持久化
├── hooks/                  # 自定义 Hooks
│   ├── useXterm.ts
│   ├── useTauriTerminalOutput.ts
│   ├── useTerminalResize.ts
│   ├── useAppShortcuts.ts
│   └── useDragResize.ts
├── types/                  # TypeScript 类型
│   ├── session.ts          # Session、Workspace、PaneNode 等
│   ├── tmux.ts             # TmuxState、TmuxControlEvent 等
│   ├── theme.ts
│   └── log.ts
├── utils/                  # 通用工具
│   ├── paneTree.ts
│   └── clipboard.ts
└── styles/                 # 全局样式
```

---

## 2. 核心数据模型

### 2.1 Session（运行时会话）

```ts
interface Session {
  id: number;            // 后端分配，全局唯一（u32）
  configId: string;      // 关联的 SavedSessionConfig.id
  name: string;          // 显示名称
  type: "local" | "ssh" | "tmux" | "ssh_tmux";
  is_connected: boolean;
  session_type: SessionType;
}
```

- `Session.id` 由 Rust 后端 `SessionManager.allocate_session_id()` 顺序分配。
- `configId` 用于把运行时会话关联回保存的配置；同一个 `SavedSessionConfig` 可以被多次打开，每次都会产生不同的 `Session.id`。

### 2.2 SavedSessionConfig（保存的会话配置）

```ts
interface SavedSessionConfig {
  id: string;            // 前端 UUID
  name: string;
  type: "local" | "ssh" | "tmux" | "ssh_tmux";
  localConfig?: LocalSessionConfig;
  sshConfig?: SSHSessionConfig;
  tmuxConfig?: TmuxSessionConfig;
  sshTmuxConfig?: SshTmuxSessionConfig;
}
```

- 持久化在 `sessions.json`（Tauri store）的 `"savedConfigs"` 字段。
- 是“连接模板”，可以被双击打开或加载到 workspace 中。

### 2.3 Workspace 与 PaneNode

```ts
interface Workspace {
  id: string;            // 前端 UUID
  name: string;
  rootPane: PaneNode;    // pane 树根节点
  activePaneId: string | null;
}

interface PaneNode {
  id: string;            // 前端 UUID
  type: "leaf" | "split";
  direction?: "horizontal" | "vertical";
  size: number;          // 百分比
  children?: PaneNode[];
  sessionId?: number;    // 关联的运行时 Session.id
  configId?: string;     // 关联的 SavedSessionConfig.id
}
```

- 一个 workspace 对应顶部 TabBar 的一个 tab。
- `PaneNode` 构成可嵌套的分割树，叶子节点承载一个 session。
- `Workspace.id` 和 `PaneNode.id` 均使用 `crypto.randomUUID()` 生成。

### 2.4 TmuxState（tmux 控制模式状态）

```ts
interface TmuxState {
  sessions: Map<string, TmuxSessionState>;
  windows: Map<string, TmuxWindow>;
  panes: Map<string, TmuxPane>;
}
```

- 使用 Map 以 tmux 原生 ID（`$N`、`@N`、`%N`）为 key，增量更新。
- `sessionId` 参数为前端 `Session.id` 的字符串形式，用于把 tmux 状态绑定到具体会话。

---

## 3. 状态管理层

### 3.1 SessionContext 三层结构

`SessionContext.tsx` 把状态拆成三部分组合：

```ts
const state = useSessionState();        // 原始 state + refs
const persistence = useSessionPersistence(state); // 持久化操作
const actions = useSessionActions({ ...state, ...persistence }); // 业务 action
```

| 模块 | 职责 |
|------|------|
| `useSessionState` | 定义所有 `useState`（sessions、workspaces、tmuxState 等）和 `useRef`（`sessionsRef`、`workspacesRef` 等）。refs 用于在 callback 中读取最新状态。 |
| `useSessionPersistence` | 封装 `savedConfigs`、`groups`、`savedWorkspaces` 的读写，写入 Tauri store。 |
| `useSessionActions` | 所有业务 action：`createLocalSession`、`openFromConfig`、`splitPane`、`closeWorkspace` 等。 |
| `useTauriListeners` | 监听 Tauri 后端事件：`session-closed`、`tmux-control-event`、`tmux-request-sync` 等。 |
| `tmuxStateReducer` | 纯函数 reducer，处理 tmux 事件并返回新的 `TmuxState`。 |

### 3.2 关键 refs 时序说明

- `sessionsRef` / `workspacesRef` 通过 `useEffect` 在每次 render 后同步 state。
- 在异步 action 中，**`setSessions` 之后不能立刻通过 ref 读到最新 state**。
- 因此 `createWorkspaceFromSession` 改为直接接收 `Session` 对象，避免依赖 `sessionsRef`。

### 3.3 持久化范围

| 数据 | 持久化位置 | 说明 |
|------|-----------|------|
| `savedConfigs` | `sessions.json / savedConfigs` | 保存的会话配置 |
| `groups` | `sessions.json / groups` + `nextGroupId` | 配置分组 |
| `savedWorkspaces` | `sessions.json / savedWorkspaces` | 保存的 workspace 结构 |
| `globalLocalEcho` | `settings.json / globalLocalEcho` | 全局本地回显开关 |
| `sessions`、`workspaces` | 不持久化 | 运行时会话与 workspace |

---

## 4. 组件层架构

### 4.1 顶层布局

```
App
└── SessionProvider / ThemeProvider / LoggerProvider
    └── AppLayout
        ├── NavBar
        ├── Sidebar
        │   ├── SidebarToolbar
        │   ├── SessionManager
        │   └── WorkspaceManager
        └── main-area
            ├── TabBar
            ├── WorkspaceContainer (activeWorkspace)
            │   └── PaneTree
            │       └── Pane
            │           ├── Terminal
            │           └── TmuxSessionView
            ├── panel-resize-handle
            └── CommandSendPanel
```

- `AppLayout` 通过 `activeWorkspaceId` 从 `workspaces` 中选出当前 workspace，只渲染一个 `WorkspaceContainer`。
- `TabBar` 显示所有 workspace，点击切换 `activeWorkspaceId`。

### 4.2 Pane 渲染逻辑

`Pane.tsx` 根据 `pane.sessionId` 查找 `Session`：

- 无 session：显示空 pane，右键可 split / attach。
- `local` / `ssh`：渲染 `Terminal`（xterm.js）。
- `tmux` / `ssh_tmux`：渲染 `TmuxSessionView`，内部再按 tmux window/pane 渲染 `Terminal`。

### 4.3 Terminal 组件

`Terminal.tsx` 是一个通用终端渲染器：

- 通过 `useXterm` 创建 xterm 实例。
- 通过 `useTauriTerminalOutput` 监听后端输出事件。
- 通过 `useTerminalResize` 监听容器尺寸变化并通知后端。
- 输入数据：非 tmux 直接调用 `writeSession`；tmux pane 调用 `sendKeysToTmuxPane`。

---

## 5. 数据流示例：双击打开 saved session

```
SessionManager.handleConfigDoubleClick(config)
  └─▶ useSessionActions.openFromConfig(configId)
        ├─▶ openFromConfigInternal(configId)
        │     ├─▶ 查找 SavedSessionConfig
        │     ├─▶ sessionService.createLocal / createSsh / tmuxService.createTmux / createSshTmuxSession
        │     │     └─▶ Tauri invoke → Rust SessionManager.create_*()
        │     ├─▶ buildFrontendSession(info, configId, type) → Session
        │     └─▶ setSessions(prev => [...prev, session])
        └─▶ createWorkspaceFromSession(session, session.name)
              ├─▶ generateId() → workspace.id
              ├─▶ createLeafPane(100, session.id, session.configId)
              ├─▶ setWorkspaces(prev => [...prev, workspace])
              └─▶ setActiveWorkspaceId(workspace.id)
```

---

## 6. 关键设计决策

### 6.1 为什么不用 Redux/Zustand？

项目规模中等，状态高度集中在会话与 workspace 两个领域。Context + `useState` 已足够，避免了额外依赖和样板代码。

### 6.2 为什么 Session.id 和 Workspace/Pane.id 分离？

- `Session.id` 是后端分配的运行时标识，生命周期由 Rust 管理。
- `Workspace.id` / `PaneNode.id` 是前端分配的 UI 结构标识，支持一个 session 被多个 workspace 或 pane 引用。

### 6.3 为什么 tmux 状态用 Map？

tmux 事件流是增量、乱序的（window/pane 可能先于 session 到达）。Map 允许按原生 ID 直接覆盖更新，避免数组查找和不可变更新带来的复杂度。

### 6.4 refs 的用途与陷阱

refs 用于在 stale closure 中读取最新 state（如事件监听、异步回调）。但 `setState` 后立刻读 ref 不会得到最新值，这是之前“打开同一会话多次”bug 的根源之一。

---

## 7. 扩展与修改建议

| 场景 | 推荐阅读文件 |
|------|-------------|
| 新增会话类型 | `useSessionActions.ts`、`types/session.ts`、`sessionService.ts` / `tmuxService.ts` |
| 修改 workspace/tab 行为 | `useSessionActions.ts`、`AppLayout.tsx`、`TabBar.tsx` |
| 修改 pane 布局/分割 | `PaneTree.tsx`、`Pane.tsx`、`paneUtils.ts` |
| 修改 tmux 状态同步 | `tmuxStateReducer.ts`、`useTauriListeners.ts`、`types/tmux.ts` |
| 修改持久化 | `sessionStorage.ts`、`useSessionPersistence.ts` |
| 修改主题 | `ThemeContext.tsx`、`types/theme.ts` |
| 新增快捷键 | `useAppShortcuts.ts` |

---

## 8. 前后端交互边界

前端通过 `invoke` 调用 Rust commands，通过 `listen` 监听后端事件。

| 方向 | 示例 | 说明 |
|------|------|------|
| 前端 → 后端 | `invoke("create_local_session", { config })` | 创建会话 |
| 前端 → 后端 | `invoke("write_session", { sessionId, data })` | 写入数据 |
| 前端 → 后端 | `invoke("write_tmux_command", { sessionId, command })` | 发送 tmux 命令 |
| 后端 → 前端 | `emit("session-closed", sessionId)` | 会话关闭通知 |
| 后端 → 前端 | `emit("tmux-control-event", [sessionId, event])` | tmux 控制模式事件 |
| 后端 → 前端 | `emit("tmux-pane-output", [sessionId, { paneId, data }])` | tmux pane 输出字节 |

---

*文档生成时间：2026-07-02*
