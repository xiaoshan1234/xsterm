# 01 逻辑视图 (Logical View)

> **关心什么**：xsterm 是什么、它拆成哪几个**职责清晰**的概念、它们怎么协作、数据结构怎么流转。
> 不关心：运行时 task / 线程、文件路径、Tauri capability 配置。

## 1. 一句话总结

xsterm = Tauri 2 桌面终端模拟器。
- **后端**（Rust）管 PTY / SSH / tmux 三类 backend 连接，集中在 `SessionManager` 注册表。
- **前端**（React）把每个 backend 连接渲染成一个 xterm.js pane，UI 按 workspace → window → pane tree 三级组织。
- **桥**（Tauri IPC + 事件）双向流动数据，前端只通过 `invoke` + `listen` 与后端通讯。

## 2. UI 树层级（前端）

```
WorkspaceContainer              ← 顶层（多 workspace 时切换；当前 MVP 通常 1 个）
└── Window[]                    ← UI 二级；承载一棵 PaneTree，对应 tmux window（1:1）
    └── PaneTree                ← 二叉树，叶子是 pane
        ├── Split { dir, ratio, children: [PaneTree; 2] }
        └── Leaf { sessionId }  ← UI 三级；绑定 1 个 Session，渲染 1 个 xterm.js 实例
```

| 概念 | 是什么 | 谁拥有 | 关键约束 |
|---|---|---|---|
| **workspace** | UI 顶层容器 | React `workspaces[]`（Context） | MVP 单 workspace，多 ws 是 roadmap |
| **xsterm Window** | UI 二级；承载一棵 PaneTree | `workspace.windows[]` | 与 tmux window 1:1（启用 tmux 时） |
| **pane leaf** | PaneTree 叶子节点 | `window.rootPane` 树 | 通过 `sessionId` 引用一个 Session；渲染一个 xterm.js |
| **Session** | **backend 连接**（不是 UI 节点！） | Rust `SessionManager.sessions` + React `sessions[]` | 独立于 UI 树，可被多个 leaf 绑定（理论上，**当前实现 1:1**） |

### 关键约束

- **Leaf 必须有 sessionId**，否则渲染失败（`useTauriTerminalOutput` 收不到 output）
- **关闭 Session** 不关闭 Window —— Window 由 `tmux-window-closed` 事件触发；UI 自己控制 window 生命
- **PaneTree 是 immutable 的**：split / collapse 都生成新树，React 用 key 触发 reconcile
- **Resize** 是双向的：xterm 容器尺寸变化 → 前端发 `resize_session` → tmux 走 `resize-pane` → tmux 回 `%window-pane-changed` → 前端更新 layout 字段

## 3. tmux 概念层级（"session" 容易混的源头）

xsterm 的 **session** 跟 tmux 的 **session** 不是一回事。下表是**当前实现**的实际语义，命名禁忌见 AGENTS.md。

| 概念 | 是什么 | 拥有方 | 1:1 关系 |
|---|---|---|---|
| **xsterm session** | backend 连接（local=PTY、ssh=russh channel、tmux-cc=tmux pane 的逻辑代理） | Rust: `SessionManager.sessions: DashMap<u32, ActiveSession>`<br>React: `useSessionState.sessions[]` | **不**对应 tmux session；对应 **tmux pane** |
| **workspace** | UI 顶层容器 | `workspaces[]` | 不对应 tmux 概念 |
| **xsterm Window** | UI 二级容器，承载 PaneTree | `workspace.windows[]` | **对应 tmux window**（1:1） |
| **pane leaf** | PaneTree 叶子，渲染 xterm.js | `window.rootPane` 树 | **对应 tmux pane**（1:1 渲染） |
| **TmuxController** | 1 个 `tmux -CC` 子进程 / SSH exec channel 的客户端 | Rust: `SessionManager.tmux_controllers: DashMap<u32, Arc<TmuxController>>` | ≈ 1 个 tmux session（对用户不可见） |

### 3.1 创建/关闭时的装配规则

`useSessionLifecycle::createAndActivateSession` 按 session `type` 自动装配 UI：

| type | 触发动作 | UI 装配 |
|---|---|---|
| `local` / `ssh` / `tmux-cc (create)` | 默认调 `createWindowFromSession` | 1 new xsterm Window + 1 new pane leaf 绑该 session |
| `tmux-cc (attach)` | 通过 `tmux-pane-added` 事件注册已有 pane bindings；listener 决定是否新建 ws/window | 由 listener 决定（通常按 `attached_tmux.json` 的快照批量建） |
| `tmux split` (`create_tmux_pane`) | 不创建 ws/window | 在已存在的 PaneTree 里 split 出新 leaf 绑新 session |
| `tmux new-window` (`create_tmux_window`) | 创建新 xsterm Window | 1 new xsterm Window + 第 1 个 pane leaf 绑新 session |

关闭时对称：`closeSession` → 关 backend → 删 session → 在所有 workspace 调 `removeSessionAndCollapse` 移除绑它的 leaf。

### 3.2 tmux control window（设计草稿，**未落地**）

> **来源**：`dev/adr/0009-tmux-control-window.md`（P8 brainstorm，**未实现**，仅作设计意图存档）
>
> 假设一个 tmux server 有 N 个 windows，xsterm 打开该 server 时会创建 N+1 个 xsterm Window：
>
> - **1 个 tmux-control window**：在 window bar 显示 session name，提供"session 断开/重连/远程删除"按钮 + 所有 window 列表（支持重命名/断开/删除/新建）。**注意**：控制 window 也要带 xstermWindowId（早期草稿说"不带"是错的，已订正）。
> - **N 个普通 tmux-window**：实际承载 pane。
>
> | 行为 | 含义 |
> |---|---|
> | window bar 点 × 或双击普通 window | **仅断链**（detachClient），不在 tmux server 上删除 window |
> | 在 control window 操作 | **删除/增加** window（真在 server 上做） |
> | 关闭 control window | 关闭整个 session 关联的所有 window（**关闭+断链**，不是删除） |
>
> **当前状态**：与 `closeSession` 后端行为已经一致（双击/× = 仅断链），不需要改后端；剩下是 UI 层"control window 怎么画"的取舍，详见 ADR 0009-tmux-control-window.md。

### 3.3 Tauri 命令命名的视图

Tauri 命令后缀 `_tmux_pane` / `_tmux_window` 反映**该命令的 tmux 视角效果**（如 `kill-pane` / `split-window`），但**参数是 xsterm 视角**：
- `xsterm_session_id: u32` = `Session.id`（xsterm 侧 ID）
- `xsterm_window_id: u32` = xsterm 内部 Window id

**没有命令接收 tmux 内部 pane id 作为参数** —— tmux id 在 backend 内部消化（用 `pane_bindings` 反查）。

## 4. 数据契约（后端 ↔ 前端）

### 4.1 IPC 通道

```
前端 ──── invoke(cmd, args) ────→ 后端
       ←── return value       ────

前端 ←── listen(event, payload) ─── 后端（推）
```

### 4.2 通用事件（与 backend 类型无关）

| 事件 | Payload | 方向 | 触发 |
|---|---|---|---|
| `session-output` | `[sessionId: number, data: number[]]` (binary) | 后端 → 前端 | PTY/SSH/tmux 任何 backend 收到数据 |
| `session-closed` | `sessionId: number` | 后端 → 前端 | Session 关闭（任何原因） |

### 4.3 tmux 专用事件

完整列表见 `03-development-view.md` §4 `TmuxBridge` 表。前端每个事件都有 `listen<...>` handler，分布在 `src/contexts/session/useTauriListeners.ts`。

### 4.4 持久化数据

| 数据 | 存储 | 路径（Tauri app data 目录） |
|---|---|---|
| Session config / Groups / 日志设置 | `tauri-plugin-store` JSON | 由 plugin 管理（**目标 M3 W10-12 迁到 toml**） |
| 已 attach 的 tmux server 列表 | 同上 JSON | `attached_tmux.json` |
| 日志（rolling file） | `tracing` rolling writer | `logs/`（**Logging 故意 leak guard 保活**） |
| SSH known_hosts | 系统默认路径 | 由 russh 管理（**当前验证 disabled — AGENTS.md 已知 gap**） |

## 5. 后端模块职责（高层）

```
src-tauri/src/
├── main.rs                    入口
├── lib.rs                     Tauri builder 注册 + plugin + SessionManager state
├── logging_setup.rs           tracing + rolling file writer (leak guard)
├── commands/                  Tauri command handlers（薄层）
│   └── session.rs             create/attach/split/kill/resize/capture 等
├── services/
│   ├── session_manager.rs     中枢：所有 session 注册表 + trait-based 可测试
│   ├── local_session/         本地 PTY session
│   ├── ssh_session/           SSH session
│   ├── tmux/                  tmux -CC 集成（详见 03-development-view §3）
│   │   ├── controller/        状态机层（mod/id_map/handshake/subscriber）
│   │   ├── bridge/            ProtocolEvent → Tauri 事件翻译
│   │   ├── protocol/          纯协议层（wire/codec/parser/events/version/command）
│   │   ├── dispatch.rs        事件分发
│   │   └── parser.rs          line → ProtocolEvent（**已迁到 protocol/parser.rs，此处 re-export**）
│   ├── session_log.rs         per-session 日志
│   └── config/                toml 配置（M3 W10-12，**未启用**）
├── infrastructure/            外部资源抽象（trait）
│   ├── pty.rs                 portable-pty 实现
│   ├── ssh.rs                 russh 实现 + known_hosts
│   └── tmux/backend.rs        TmuxBackend trait + Local/Ssh 实现
└── models/                    数据模型
```

## 6. 前端模块职责（高层）

```
src/
├── main.tsx → App.tsx → AppLayout.tsx     入口链
├── components/                            按职责分子目录
│   ├── AppLayout.tsx                      workspace 容器
│   ├── NavBar.tsx                         自定义 title bar（getCurrentWindow()）
│   ├── sidebar/                           左侧 session/window 列表
│   ├── dialogs/                           CreateSession 等
│   ├── settings/                          设置面板
│   ├── ui/                                通用 UI 原子（button/input/dialog）
│   └── icons/                             SVG icons
├── contexts/                              三个 Provider
│   ├── SessionContext.tsx                 sessions/workspaces/panes/groups
│   ├── ThemeContext.tsx                   主题状态
│   ├── LoggerContext.tsx                  前端日志桥接后端
│   └── session/                           Session context 内部（11 文件按职责拆）
├── hooks/                                 7 个自定义 hook
├── services/
│   ├── sessionService.ts                  invoke 包装层（**invoke 类型不安全**）
│   └── sessionStorage.ts                  tauri-plugin-store 包装
├── types/                                 类型定义
├── utils/                                 paneTree / clipboard / buffer
└── styles/global.css                      design-system tokens（:root）
```

### 6.1 Session Context 内部（11 文件）

> 按职责拆分是为了让 "session 注册表" 这个核心状态的所有读写路径可独立测试，避免单文件超 1000 行。

具体文件名见 `src/contexts/session/`。每个文件 = 一个职责（如 useSessionState / useSessionLifecycle / useTmuxListeners / useSessionOutput 等）。

## 7. 跨视图引用

- 想看这些模块怎么**运行时跑起来** → `02-process-view.md`
- 想看代码**怎么组织**、怎么构建 → `03-development-view.md`
- 想看部署到哪、**安全边界在哪** → `04-physical-view.md`
- 想看几个**关键场景**把它们串起来 → `05-scenarios.md`
