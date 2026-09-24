# Module · Terminal — 职责

> **UI 共有 5 个 module**：layout / terminal / sidebar / ui-kit / hooks（每个都有自己的 3 份文档）。
> 本文档是 terminal module 的职责文档；UI 顶层划分见 [`../../README.md`](../../README.md) §5。
>
> **位置（目标态）**：`src/ui/terminal/`
> **位置（现状）**：散落在 `src/ui/` 顶层—— 改造 PR-1 收编到 `terminal/` 子目录
> **L 层**：L2 业务视图
> **主语**：一个 pane 的渲染
> **唯一进口**：`layout/WorkspaceContainer.tsx`

## 1. 这个 module 负责什么

把"一个 pane 的渲染 + 一个 window 的 tab bar"做成一个**自包含**的视图块。外部喂入 pane 树 + 当前 session，terminal module 负责：

1. **xterm.js 终端渲染**：每个 pane 对应一个 xterm 实例，绑定到对应 backend session 的输出流
2. **pane 树布局**：根据 pane tree 的 split 关系（horizontal/vertical）用 CSS 嵌套 + ResizeHandle 渲染
3. **tab 切换**：WindowTabBar 列出当前 window 的所有 tab，setActiveWindow 由 layout 通过 props 传入
4. **init 占位**：当 pane 是 init 类型（kind: "init"），渲染 PaneInitCard 引导用户创建第一个 session
5. **command 发送**：CommandSendPanel 给 tmux control mode 提供命令行面板（send-keys / new-window 等）
6. **resize**：用户拖拽 pane 边界时调用 `app/modules/pane/lifecycle` 的 resize useCase

## 2. 这个 module **不**负责什么

- **不创建 session**——会话创建由 `app/modules/session/create` 接管，Terminal 通过 props 接收已创建的 session
- **不管理 window tab**——tab 列表来自 `service/workspace/store` 的当前 window，Terminal 只 render
- **不持久化**——所有写持久化的逻辑在 `app/modules/workspace/persistence`
- **不直接调 backend IPC**——所有 `invoke` 走 service 层（详见 [`DOWNSTREAM.md`](./DOWNSTREAM.md) §3）
- **不渲染侧栏或设置**——那些归 sidebar / settings module

## 3. 跟其他 L2 业务视图 module 的关系

| 邻居 | 关系 | 接缝位置 |
|---|---|---|
| `sidebar/` | 无直接依赖，sidebar 只显示「这个 session 存在」，不感知 pane 树 | props 边界（layout 同时持有两者） |
| `settings/` | 无直接依赖，settings 改全局偏好通过 store 重渲染 Terminal | service/workspace/store + service/theme/store |
| `dialogs/` | 当 Terminal 需要让用户选个 session 装进 init pane 时，调 `dialogs/SelectSessionDialog`（通过 props 注入回调） | props callback |

跟 `dialogs/` 的接缝是**当前架构债**——Terminal 直引 dialogs 违反了 L2 → L3 的单向依赖。改造 PR 应在 layout 处统一注入 dialog opener。

## 4. 跟 tmux 子目录的关系

`ui/tmux/` 是 terminal module 的**扩展**，不是独立 module：

- `terminal/Terminal.tsx` 检测当前 session 是 tmux 类型时，挂载 `tmux/TmuxControlWindowView.tsx`
- 二者通过 props / context 协作，不互相 import 内部文件
- 详见 [`../README.md` §5.1](../../README.md)

## 5. 子目录组织（目标态）

```
ui/terminal/
├── Terminal.tsx             单 pane 渲染入口（xterm + 子 pane 递归）
├── Pane.tsx                 单个 pane 节点（init / terminal 两种 kind）
├── PaneTree.tsx             pane 树遍历与 ResizeHandle 嵌套
├── PaneInitCard.tsx         init pane 的引导卡片
├── TabBar.tsx               window 内 tab 切换条
├── WindowTabBar.tsx         workspace 级别的 window 切换条
└── CommandSendPanel.tsx     tmux command 发送面板
```

每个文件配 `.test.tsx` 位于同目录。
