# Backend · App 层（按产品功能切分）

> **位置**：`src-tauri/src/app/`（语义名）；目录落地 = `src-tauri/src/commands/`
> **关注点**：把 service 暴露给 Tauri runtime ——5 个 module 按**产品功能**切分（与前端 `app/` 一一对应）
> **平级于**：service / model / infra（4 个顶层目录之一）

## 0. 为什么重写这一层

v0 把 `commands/` 当作"翻译器层"，按**资源类型**（session / persistence / logging）切分。问题：

- `commands/session.rs` 一个文件 24 个 `#[tauri::command]`——local / ssh / tmux / resize / write / close 全混在一起
- 改一个产品功能（比如"tmux pane split"）要翻 5 个文件：commands/session、session_manager、tmux_session/controller/commands、commands/persistence 还要触发 attached_tmux.json 重写
- 跟前端 `app/` 5 module 没有 1:1 对应——前端改了 `app/terminal` 加新接口，后端不知道该往哪个 `commands/` 子目录加

v1（本文档）把 `commands/` 拆成 **5 个 module 按产品功能切分**，每个 module 强制 `api.rs` 唯一对外入口，与前端 `app/<module>/api.ts` 镜像。

## 1. 5 个 module

```
src-tauri/src/app/                                  (语义名)
├── modules/
│   ├── shell/         启动序列 + 关闭序列的 IPC 编排
│   ├── workspace/     主视图 IPC 编排（暂未涉及，预留位）
│   ├── terminal/      tmux -CC + terminal preferences IPC 编排
│   ├── session/       session 全生命周期 IPC 编排
│   └── settings/      设置持久化 + log 路径 IPC 编排
│
├── mod.rs            app 层的 pub re-export 集合
└── lib.rs  (lib.rs 内 use crate::app::all_handlers)

实际目录：src-tauri/src/commands/
├── mod.rs            all_handlers() — generate_handler! 注册表
├── shell.rs          启动钩子编排（initialize / shutdown）
├── terminal.rs       tmux -CC + terminal preferences IPC
├── session.rs        session 全生命周期 IPC
├── workspace.rs      (预留，MVP 无 IPC)
├── settings.rs       settings/log/persistence IPC
└── persistence.rs    (废弃迁出 — 见 §6)
```

> **目录命名**：本 README 的「app」是语义名；落地目录沿用 Rust 习惯 `commands/`，避免全量重写 import。重写路径是后续 PR 的事，本文档先描述目标结构。

## 2. 5 个 module 索引

每个 module 有 3 份文档：**职责 / 对外接口 / 对下依赖**

| module | 职责 | 对外接口 | 对下依赖 | IPC 范围 |
|---|---|---|---|---|
| **shell** | [RESPONSIBILITY](./shell/RESPONSIBILITY.md) | [INTERFACE](./shell/INTERFACE.md) | [DOWNSTREAM](./shell/DOWNSTREAM.md) | 启动钩子（setup hook 内编排，不直接是 `#[tauri::command]`） |
| **workspace** | [RESPONSIBILITY](./workspace/RESPONSIBILITY.md) | [INTERFACE](./workspace/INTERFACE.md) | [DOWNSTREAM](./workspace/DOWNSTREAM.md) | MVP 无 IPC（workspace 状态在 frontend store） |
| **terminal** | [RESPONSIBILITY](./terminal/RESPONSIBILITY.md) | [INTERFACE](./terminal/INTERFACE.md) | [DOWNSTREAM](./terminal/DOWNSTREAM.md) | tmux -CC IPC（11 个）+ preferences（0 个） |
| **session** | [RESPONSIBILITY](./session/RESPONSIBILITY.md) | [INTERFACE](./session/INTERFACE.md) | [DOWNSTREAM](./session/DOWNSTREAM.md) | session CRUD IPC（8 个） |
| **settings** | [RESPONSIBILITY](./settings/RESPONSIBILITY.md) | [INTERFACE](./settings/INTERFACE.md) | [DOWNSTREAM](./settings/DOWNSTREAM.md) | persistence + log IPC（8 个） |

## 3. 5 个 module ↔ 5 个 frontend app module 对应表

| backend app module | frontend app module | 对应关系 |
|---|---|---|
| `app/shell` | `app/shell` | 启动 / 关闭序列编排，frontend shell.initialize() 通过 `listen("ready", ...)` 等待 |
| `app/workspace` | `app/workspace` | MVP 无 IPC；未来 split-window / pane 树变更若搬到 backend 时填充 |
| `app/terminal` | `app/terminal` | frontend 调 `invoke('create_tmux_pane', ...)` → backend `app/terminal/api.rs::create_tmux_pane` |
| `app/session` | `app/session` | frontend 调 `invoke('create_local_session', ...)` → backend `app/session/api.rs::create_local_session` |
| `app/settings` | `app/settings` | frontend 调 `invoke('save_sessions', ...)` → backend `app/settings/api.rs::save_sessions` |

**改一个产品功能 = 改 1 个 backend app module + 1 个 frontend app module**。

## 4. 每个 module 的内部约定

```
modules/<name>/
├── api.rs            ⭐ 唯一对外入口（其他 module 只能 import 这个）
├── commands/         #[tauri::command] 集合（每个 IPC 一个文件 + .test.rs）
│   ├── <domain>/     按子域分子目录（local / ssh / tmux / pane / window / ...）
│   └── composition/  跨 module 协调的 command 集合
├── model.rs          module 专属类型（如果有）
├── mod.rs            barrel：只 re-export api.rs
└── *.test.rs
```

**强制规则**（与前端 `app/<module>/api.ts` 同构）：

- `mod.rs` 只 `pub use api::*`
- 其他 module `use crate::app::modules::<name>::api`
- **禁止** import `commands/*` 内部文件、`SessionManager` / `TmuxController` 内部字段
- 这条规则让 module 内部重构不影响其他 module

> **实现说明**：Rust 的 `#[tauri::command]` 不需要运行时注册表之外的「api 层」——`api.rs` 在 Rust 这边是 **module 入口符号 + 函数签名集合**，对外只暴露**抽象函数**（内部委托给 `commands/` 子模块或直接 `state.method()`）。
>
> 与前端的区别：前端 `api.ts` 暴露的是 React hook `useSessionApi()`；后端 `api.rs` 暴露的是**纯 Rust 函数**（如 `pub fn create_local(app, state, config) -> Result<...>`），`#[tauri::command]` wrapper 在 `commands/` 子模块内部组装 `State<AppHandle>` 后调用 api.rs。

## 5. 依赖方向

```                     ┌─────────────────────────┐
                     │  app/                    │
                     │  ──► service/*           │
                     │  ──► model/*             │
                     │  ──► infra/*  (经过 service) │
                     └─────────────────────────┘
                            │  ▲
   ┌────────────────────────┘  │
   │                           │
   ▼                           │
service/* ──► infra/* ──► model/*
```

**关键规则**：

- **app → service**：正常依赖
- **app → model**：自由（参数 / 返回类型）
- **app → infra**：**禁止**（必须经过 service）
- **app 模块之间**：只通过 `modules/<other>/api.rs` 互相调用

## 6. IPC 命令迁移对照表

v0 → v1 的 25 + 6 + 4 = 35 个 command 的去向：

| v0 命令（src-tauri/src/commands/*.rs） | v1 落点 |
|---|---|
| `create_local_session` | `app/session/commands/local/create.rs` |
| `create_ssh_session` | `app/session/commands/ssh/create.rs` |
| `create_session` (generic) | `app/session/commands/dispatch.rs` |
| `write_session` | `app/session/commands/write.rs` |
| `close_session` | `app/session/commands/close.rs` |
| `list_sessions` | `app/session/commands/list.rs` |
| `resize_pty_session` | `app/session/commands/local/resize.rs` |
| `resize_ssh_session` | `app/session/commands/ssh/resize.rs` |
| `upload_image_to_ssh_session` | `app/session/commands/ssh/upload.rs` |
| `create_tmux_session` | `app/terminal/commands/tmux/create.rs` |
| `attach_tmux_session` | `app/terminal/commands/tmux/attach.rs` |
| `probe_tmux_session_exists` | `app/terminal/commands/tmux/probe.rs` |
| `auto_attach_tmux_servers` | `app/terminal/commands/tmux/auto_attach.rs` |
| `create_tmux_pane` | `app/terminal/commands/tmux/pane.rs` |
| `kill_tmux_pane` | `app/terminal/commands/tmux/pane.rs` |
| `resize_tmux_pane` | `app/terminal/commands/tmux/pane.rs` |
| `capture_tmux_pane` | `app/terminal/commands/tmux/pane.rs` |
| `create_tmux_window` | `app/terminal/commands/tmux/window.rs` |
| `kill_tmux_window` | `app/terminal/commands/tmux/window.rs` |
| `rename_tmux_window` | `app/terminal/commands/tmux/window.rs` |
| `get_attached_tmux_servers` | `app/terminal/commands/tmux/server.rs` |
| `detach_tmux_controller` | `app/terminal/commands/tmux/server.rs` |
| `kill_server_via_controller` | `app/terminal/commands/tmux/server.rs` |
| `unmark_attached_tmux` | `app/terminal/commands/tmux/server.rs` |
| `get_session_output_channel` | `app/session/commands/output.rs`（binary frame 起点归 session） |
| `save_sessions` | `app/settings/commands/persistence/sessions.rs` |
| `load_sessions` | `app/settings/commands/persistence/sessions.rs` |
| `save_groups` | `app/settings/commands/persistence/groups.rs` |
| `load_groups` | `app/settings/commands/persistence/groups.rs` |
| `save_attached_tmux_servers` | `app/settings/commands/persistence/attached_tmux.rs` |
| `load_attached_tmux_servers` | `app/settings/commands/persistence/attached_tmux.rs` |
| `log_message` | `app/settings/commands/logging/message.rs` |
| `get_log_config` | `app/settings/commands/logging/config.rs` |
| `set_log_config` | `app/settings/commands/logging/config.rs` |
| `get_log_dir` | `app/settings/commands/logging/config.rs` |

**实际总数**：10 (session) + 15 (terminal) + 10 (settings) = 35——与 v0 命令数 1:1 对齐。

**关键**：

- v0 的 `commands/persistence.rs` 整体迁入 `app/settings/commands/persistence/`（**不是**保留独立 persistence module —— 它本质是 settings 的子目录）
- v0 的 `commands/logging.rs` 整体迁入 `app/settings/commands/logging/`（同上理由）
- `app/shell/` 不暴露 `#[tauri::command]`——它是 `.setup()` 钩子内的编排代码（启动日志、binary output channel 注册等）

## 7. 跟 v0 的核心差异

| 维度 | v0 | v1（本文档） |
|---|---|---|
| 划分依据 | 资源类型（session / persistence / logging） | 5 module 按产品功能（与 frontend app/ 一一对应） |
| 单文件最大规模 | `commands/session.rs` 24 个 command 660 行 | `app/terminal/commands/tmux/pane.rs` 单文件 ≤ 4 个 command |
| module 内部 | 自由 | 强制 `api.rs` 唯一对外入口 |
| 跨 module 调用 | 直接调任意 `commands/*` / `services/*` | 只调 `modules/<other>/api.rs` |
| 与 frontend 对应 | 隐式 | 显式（§3 对应表） |
| setup 钩子代码 | 散在 `lib.rs` 内联块 | 抽到 `app/shell/api.rs::initialize()` 编排 |
| settings/persistence 归属 | 平级 `commands/persistence.rs` + `commands/logging.rs` | **合并进** `app/settings/commands/` 子目录（一个产品功能 = 一个 module） |

## 8. 入口链（与 v0 对照）

**v0**：
```
src-tauri/src/lib.rs::run()
  └─► tauri::Builder::default().invoke_handler(commands::mod::all_handlers())
      └─► commands/{session,persistence,logging}::*
          └─► services::session_manager::*
              └─► infrastructure::{pty,ssh,tmux}::*
```

**v1**：
```
src-tauri/src/lib.rs::run()
  ├─► app::shell::api::initialize(app)            (启动钩子)
  │    └─► app::shell::commands::init_logging::*
  │    └─► app::shell::commands::init_binary_frame::*
  └─► tauri::Builder::default()
       .invoke_handler(app::mod::all_handlers())
       └─► app::{session,terminal,settings}::api::*
           └─► service::{session_manager,tmux_session,...}::*
               └─► infrastructure::{pty,ssh,tmux}::*
```

## 9. 关键设计决策

### 9.1 语义名 `app/` vs 落地目录 `commands/`

- v0 README 已经确定落地目录为 `commands/`（避免全量重写 import）
- 本文使用「app」作为语义名以与 frontend 镜像——**不需要**真的把目录改成 `app/`；将来若做 import 重写 PR，可以一并 `mv commands app`
- 模块内部文件名同样：v1 文档写 `app/session/api.rs`，实际落地仍为 `commands/session.rs`（顶层），子目录 `commands/session/` 用作 sub-module 划分

### 9.2 persistence/logging 不单独成 module

v0 把 persistence 和 logging 列为独立 module。v1 合并进 `app/settings/`：

- **理由**：所有持久化调用都来自 settings 流程（保存 session config / 保存 group / 保存 attach 列表）——没有「独立于 settings 的 persistence 业务」
- logging 同理：只有 settings tab 会读 / 写 log config，其他 module 调 `log_message` 是横切关注点（走 `infra/logger`，不经过 settings）
- **避免** `app/persistence` / `app/logging` 这种"按技术层切"反模式——会变回 v0 的资源类型切分

### 9.3 workspace module 暂时无 IPC

MVP 的 workspace 状态（pane 树 / window 列表）完全在 frontend store。backend 不参与——所以 `app/workspace/` 是预留位，当前只有 README 占位，无 `#[tauri::command]`。如果未来要把 pane 树迁到 backend（如多窗口同步），再激活该 module。

### 9.4 shell module 不暴露 `#[tauri::command]`

`app/shell/` 的「初始化 / 关闭序列」是 `.setup()` 钩子里的编排代码（不是 IPC 命令）：

- 注册 logging reload handle
- 注册 `RealAppBackend` + emit `session-output-channel`
- 将来可能要做的：清理 old log files（已在 `lib.rs` 内联）

它通过 `pub fn initialize(app: &mut App) -> Result<(), String>` 暴露一个**纯 Rust 函数**，由 `lib.rs::run()` 在 `.setup()` 内调用。

## 10. 跨 module 协调

5 个 module 之间的协调**只通过 api.rs**，不绕过 import 内部文件：

| 协调类型 | 谁编排 | 通过哪个 api.rs |
|---|---|---|
| session 创建后通知 settings 持久化 | `app/session` | `app/session/api.rs::on_session_created` 内部调 `app/settings/api::save_session_config` |
| terminal 创建 tmux 后通知 settings 持久化 attached_tmux | `app/terminal` | `app/terminal/api.rs::on_tmux_attached` 内部调 `app/settings/api::save_attached_tmux_servers` |
| 启动 → 加载 settings → 触发 workspace load | `app/shell` | `app/shell/api.rs::initialize` 按顺序调 `app/settings/api::load_all` → `app/terminal/api::auto_attach` |
| settings 变更 → 应用到 terminal | `app/settings` | `app/settings/api.rs::apply_log_config` 调 reload handle（不调 terminal，因为 terminal 不消费 log config） |

## 11. 文档地图

- 顶层（本文）：设计契约 / 现状映射 / 依赖方向 / v0→v1 diff
- 5 module 子文档：每个 module 3 份（RESPONSIBILITY / INTERFACE / DOWNSTREAM）
- 命令清单（§6）：与 `commands::mod::all_handlers()` 1:1 对应

**TM 验收入口**：先读本文档，再对照 `lib.rs::run()` 内的 `.setup()` 块与 `.invoke_handler(...)` 注册列表。