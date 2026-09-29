# Backend · Commands 层（Tauri IPC 编排）

> **位置**：`src-tauri/src/commands/`（语义名；落地目录沿用 Rust 习惯）
> **关注点**：把 frontend IPC 调用映射到 backend domain 业务逻辑
> **平级于**：domain / infra（3 层架构的最上层）
> **Frontend 对应**：[`../../frontend/app/`](../../frontend/app/README.md)（frontend 5 module ↔ backend **3 module**，app/settings 跨多 backend，app/workspace 状态完全 frontend 持有 backend 无对应 module）

## 1. 3 module 划分

```
src-tauri/src/commands/                           # 语义名（顶层 3 module）
├── mod.rs                 3 module re-export 集合
├── session/               ⭐ 核心 IPC module
│   ├── api.rs             (pub session api——纯 Rust 函数 + State 注入)
│   ├── commands/          #[tauri::command] 集合（每个 IPC 一个文件）
│   │   ├── local/         create_local_session / write_session / resize_pty_session
│   │   ├── ssh/           create_ssh_session / resize_ssh_session / upload_image_to_ssh_session
│   │   ├── dispatch.rs    create_session (generic dispatcher)
│   │   ├── list.rs        list_sessions
│   │   ├── close.rs       close_session
│   │   └── output.rs      get_session_output_channel (binary frame 起点归 session)
│   └── *.test.rs
│
├── terminal/              ⭐ tmux IPC + attached_tmux 持久化 module
│   ├── api.rs             (pub terminal api)
│   ├── commands/
│   │   ├── tmux/          tmux -CC IPC（11 个 command）
│   │   │   ├── session.rs     create_tmux_session / attach_tmux_session / probe_tmux_session_exists
│   │   │   ├── pane.rs        create_tmux_pane / kill_tmux_pane / resize_tmux_pane / capture_tmux_pane
│   │   │   ├── window.rs      create_tmux_window / kill_tmux_window / rename_tmux_window
│   │   │   ├── server.rs      get_attached_tmux_servers / detach_tmux_controller / kill_server_via_controller / unmark_attached_tmux
│   │   │   └── auto_attach.rs auto_attach_tmux_servers
│   │   └── attached_tmux.rs    save_attached_tmux_servers / load_attached_tmux_servers（v5 合并）
│   └── *.test.rs
│
└── shell/                 ⭐ 启动钩子 + log runtime IPC + user config IPC module
    ├── api.rs             (pub initialize / shutdown 纯函数)
    ├── init.rs            注册 logging reload handle + binary frame + app state
    ├── commands/
    │   ├── logging/        log IPC（4 个 command）
    │   │   ├── message.rs          log_message
    │   │   └── config.rs           get_log_config / set_log_config / get_log_dir
    │   └── config/         user config IPC（v5.1 新增——PRD §2 M9 完整方案；4 个 command）
    │       ├── read.rs             read_config
    │       ├── write.rs            write_config（merge partial + schema check + atomic write + emit reload）
    │       ├── watch_start.rs      watch_config_start（notify 后台 task 启动；MVP 默认开）
    │       └── watch_stop.rs       watch_config_stop（高级用户禁用 watch）
    └── *.test.rs
```

| module | 产品功能 | IPC 数量 |
|---|---|---|
| `commands/session` | session lifecycle + **MCP attach（P1-3）** | **13 个**（10 + 3 MCP attach：set_mcp_attach / clear_mcp_attach / list_mcp_attached）|
| `commands/terminal` | tmux -CC IPC + attached_tmux 持久化 | **15 个**（tmux 13 + attached_tmux 2；含独立 auto_attach.rs——P1-1）|
| `commands/shell` | 启动 / 关闭 + log runtime + **user config IPC（v5.1 新增）** | **8 个**（log_message + get/set_log_config + get_log_dir + read/write_config + watch_config_start/stop） |
| **commands 合计** | — | **36 个** |

**砍掉的原因**：

- `commands/settings`（砍）：attached_tmux 持久化归 terminal（tmux 业务），log runtime 归 shell（启动时调）。backend IPC 从 31 → 27。
- `commands/workspace`（砍）：workspace 状态完全 frontend 持有（Zustand store + paneTree 算法），backend 无对应 module。

**改一个产品功能 = 改 1 个 backend commands module + 1 个 frontend app module**（但 workspace / settings 跨多 backend）。

**MCP server 不属于 backend commands 层** —— MCP server 整体归 frontend `app/mcp/` (复杂业务放 TS 层原则)。backend 只为 MCP 提供 stdio transport helper（如果需要）：`infra/tauri/mcp_transport.rs` 提供 stdio/TCP listener + JSON-RPC 序列化，frontend `app/mcp/` 持有 9 个 tool 实现 + attach 状态机 + 白名单。详见 `doc/dev/design/frontend/app/mcp/RESPONSIBILITY.md` + `doc/dev/design/backend/README.md` §1.1。
## 2. 3 module ↔ 5 个 frontend app module 对应表

| backend commands module | frontend app module | 对应关系 |
|---|---|---|
| `commands/shell` | `app/shell` | 启动 / 关闭序列 + log runtime IPC（log_message / get/set_log_config / get_log_dir）；frontend shell.initialize() 通过 `listen("ready", ...)` 等待 |
| `commands/terminal` | `app/terminal` | frontend 调 `invoke('create_tmux_pane', ...)` → backend `commands/terminal/commands/tmux/pane.rs::create_tmux_pane`<br>`invoke('save_attached_tmux_servers')` → `commands/terminal/commands/attached_tmux.rs`（attached_tmux 归 terminal）|
| `commands/session` | `app/session` | frontend 调 `invoke('create_local_session', ...)` → backend `commands/session/commands/local/create.rs::create_local_session` |
| （backend 无对应 module）| `app/settings` | `save_sessions` / `load_sessions` / `save_groups` / `load_groups` —— frontend `infra/store` 直存（sessions/groups/theme）<br>`save_attached_tmux_servers` 等 backend-only 持久化归 `commands/terminal`<br>**user settings 走 `commands/shell/commands/config/`（v5.1 新增）**：UI 改 settings → `invoke('write_config', { partial })` → backend `infra/config_watcher` 写 config.toml + emit `config-reloaded` → frontend 监听 reload 同步 |
| （backend 无对应 module）| `app/workspace` | workspace 状态完全 frontend 持有（Zustand store + paneTree 算法），backend 无对应 module——所有 workspace 操作前端自行处理 |

## 3. 每个 module 的内部约定

```rust
commands/<name>/
├── api.rs            ⭐ 唯一对外入口（其他 commands module 只能 import 这个）
├── commands/         #[tauri::command] 集合（每个 IPC 一个文件 + .test.rs）
│   ├── <domain>/     按子域分子目录（local / ssh / tmux / pane / window / ...）
│   └── composition/  跨 commands module 协调的 command 集合（可选）
├── mod.rs            barrel：只 re-export api.rs
└── *.test.rs
```

**强制规则**：

- `mod.rs` 只 `pub use api::*`
- 其他 commands module `use crate::commands::<name>::api`
- **禁止** import `commands/*` 内部文件、`SessionManager` / `TmuxController` 内部字段
- 这条规则让 module 内部重构不影响其他 module

**api.rs 跟 commands/ 的分工**：

```rust
// commands/session/api.rs
use tauri::AppHandle;
use crate::domain::session::{SessionManager, SessionInfo, LocalSessionConfig};
use std::sync::Arc;

/// 纯函数入口：创建 local session（被 commands/local/create.rs 调用）
pub async fn create_local(
    state: &Arc<SessionManager>,
    backend: Arc<dyn AppBackend>,
    config: LocalSessionConfig,
) -> Result<SessionInfo, String> {
    state.create_local(config, backend).await
}

// commands/session/commands/local/create.rs
use crate::commands::session::api as session_api;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn create_local_session(
    config: LocalSessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    let backend = Arc::new(RealAppBackend::new(app.clone()));
    session_api::create_local(state.inner(), backend, config).await
}
```

**关键**：

- `api.rs` 是**纯 Rust 函数**（async OK，但**不**接收 `State<AppHandle>`）
- `commands/<name>.rs` 是**`#[tauri::command]` wrapper**（注入 `State<AppHandle>` + 调 `api.rs`）
- 这条分层让 domain 方法**完全可单测**（不需要 mock Tauri）

## 4. 跨 module 协调

3 commands module 之间的协调**只通过 `commands/<other_module>/api.rs`**（domain 模块不感知 commands 边界）：

| 协调类型 | 谁编排 | 通过哪个 api.rs |
|---|---|---|
| terminal 创建 tmux 后持久化 attached_tmux | `commands/terminal` | `commands/terminal/api.rs::saveAttachedTmuxServers` |
| 启动 → 加载 log_config + binary frame | `commands/shell` | `commands/shell/api.rs::initialize` |
| settings 变更 → 应用到 terminal | （已删除）| `commands/terminal/api.rs::applyTerminalPreferences` |

**关键**：跨 module 调用**只**通过 `commands/<other>/api.rs`——不绕过 import 内部文件。

## 5. 依赖方向

```                     ┌─────────────────────────┐
                     │  commands/               │
                     │  ──► domain/*           │
                     │  ──► domain/types       │
                     │  ──► (无 persistence layer；IO 下沉到归属域) │
                     └─────────────────────────┘
                            │  ▲
   ┌────────────────────────┘  │
   │                           │
   ▼                           │
domain/* ──► infra/* ──► 外部 crate
```

**关键规则**：

- **commands → domain**：正常依赖——commands 编排 domain 业务
- **commands → infra**：**禁止**（commands 不直接调 infra trait，必须经过 domain）
- **commands 跨 module**：只通过 `commands/<other_module>/api.rs` 互相调用
- **commands → commands**：**禁止**直接 import 内部文件

## 6. commands shell 特殊性

`commands/shell/` 不暴露 `#[tauri::command]`——它是 `.setup()` 钩子内的编排代码：

```rust
// lib.rs::run()
fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 启动钩子：调 commands/shell/api::initialize()
            commands::shell::api::initialize(app.handle())?;
            
            // 注册 state
            app.manage(Arc::new(Services::new()));
            
            // ... 其他启动钩子
            Ok(())
        })
        .invoke_handler(commands::mod::all_handlers())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**关键**：

- `commands/shell/api.rs::initialize(app: &AppHandle)` 是启动入口——注册 logging reload handle + binary frame + app state
- `commands/shell/api.rs::shutdown()` 是关闭入口——清理 old log + flush tracing + 关闭 SessionManager
- 通过 `listen("ready", ...)` 通知 frontend 启动完成

## 7. 关键设计决策

### 7.1 为什么 api.rs + commands/<name>.rs 分两层

- `api.rs` 纯 Rust 函数（async OK，不接收 `State<AppHandle>`）——**完全可单测**
- `commands/<name>.rs` `#[tauri::command]` wrapper——**只做参数提取 + 调 api.rs**
- 这条分层让 domain 方法**完全可单测**（不需要 mock Tauri runtime）

### 7.2 为什么砍 commands/session/api.rs 这种"空壳纯转发"

- 旧 4 层 `commands/session/api.rs::create_local(state, backend, config)` 跟 `service/session/SessionManager::create_local(config, backend)` 是**两层相同语义的函数**——只是参数顺序不同
- 砍掉 `api.rs` 这一层后，`#[tauri::command]` wrapper 直接放在 `commands/session/commands/local/create.rs`，内部 `state.create_local(config, backend)`——**少一层**
- 但保留 `api.rs` 用于**跨 module 调用**（commands/session 需要被 commands/terminal 调，必须有一个非 Tauri 的入口）

### 7.3 为什么 settings 模块包含 persistence + logging

- backend 只剩 6 个 settings IPC（4 个 logging + 2 个 attached_tmux）
- 这 6 个 IPC 都涉及"backend-only 持久化"或"backend runtime config"——归 settings 自然
- frontend 直存的 sessions/groups/settings frontend-only 配置走 `infra/store`

### 7.4 为什么 shell 不暴露 #[tauri::command]

- shell 的"初始化 / 关闭序列"是 `.setup()` 钩子里的编排代码（不是 IPC 命令）
- 注册 logging reload handle + binary frame + app state——**Tauri runtime 副作用**
- 通过 `listen("ready", ...)` 通知 frontend 启动完成——单向 push，不需要 frontend 调

## 8. 文档地图

- 顶层（本文）：commands 5 module 总览 + 跟 frontend app module 镜像 + 跨 module 协调规则
- 各 module 子文档：每个 module 3 份（RESPONSIBILITY / INTERFACE / DOWNSTREAM）
- 每个 IPC command：单独 `.rs` 文件 + `.test.rs`

**TM 验收入口**：先读本文档（5 module 总览）→ 读 `commands/session/RESPONSIBILITY.md`（最大 IPC module）→ 读 `commands/terminal/DOWNSTREAM.md`（跨 module 协调示例）。
