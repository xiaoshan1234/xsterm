# Module · App Session — 对下依赖

> **位置**：`src-tauri/src/app/modules/session/`

## 1. 依赖图

```
modules/session/
├── api.rs        ────►  app/terminal/api.rs          (create_session dispatcher 路由 tmux)
├── api.rs        ────►  app/settings/api.rs          (save_session_config after create)
├── api.rs        ────►  services/session_manager     (唯一直接调用的 service)
├── commands/     ────►  services/local_session       (LocalSession 构造)
├── commands/     ────►  services/ssh_session         (SshSession 构造)
├── commands/     ────►  services/session_log         (start_session_logging)
├── commands/     ────►  infrastructure/app_backend   (RealAppBackend::new 构造 AppHandle wrapper)
├── commands/     ────►  infrastructure/ssh           (upload_file_via_ssh)
└── api.rs        ────►  models/session::*            (SessionConfig / SessionInfo / 等纯数据类型)
```

## 2. app/terminal

| 调用 | 来源 | 何时调 |
|---|---|---|
| `terminal_api::create_tmux(state, backend, &tmux)` | `app/terminal/api.rs` | `create_session` 收到 `SessionConfig::TmuxCc` 时 |

**关键**：session **不**直接 import `services::tmux_session::TmuxController` —— 跨 module 必须走 `app/terminal/api.rs`。

## 3. app/settings

| 调用 | 来源 | 何时调 |
|---|---|---|
| `settings_api::save_session_config(&app, &info, &config)` | `app/settings/api.rs` | `create_local_session` / `create_ssh_session` 创建后，config.should_save 为 true 时 |

**关键**：

- session **不**直接调用 `tauri_plugin_store` —— 必须经过 settings_api
- 持久化失败**不**向上传播（best-effort，tracing::warn 即可）

## 4. services/session_manager

session api **唯一直接调用**的 service。调用面：

| 调用 | 何时 |
|---|---|
| `state.create_local(config, backend)` | `commands/local/create.rs` |
| `state.create_ssh(config, backend)` | `commands/ssh/create.rs` |
| `state.write(session_id, &data)` | `commands/write.rs` |
| `state.resize_pty_session(session_id, rows, cols)` | `commands/local/resize.rs` |
| `state.resize_ssh_session(session_id, rows, cols)` | `commands/ssh/resize.rs` |
| `state.upload_image(session_id, &filename, data)` | `commands/ssh/upload.rs` |
| `state.close(session_id)` | `commands/close.rs` |
| `state.list()` | `commands/list.rs` |

**约束**：

- session **不**直接 import `services::session_manager` 的字段（DashMap / AtomicU32 / tmux_controllers）—— 只通过 public methods
- session **不** import `services::tmux_session::*` —— tmux 操作归 `app/terminal/`

## 5. services/local_session

| 调用 | 来源 | 何时 |
|---|---|---|
| `services::local_session::create_local_session(pty_system, config, backend, id)` | `services/local_session/mod.rs` | `commands/local/create.rs` |

**约束**：仅用于构造 `LocalSession` 对象；session 模块**不**直接 import `infrastructure::pty::*`。

## 6. services/ssh_session

| 调用 | 来源 | 何时 |
|---|---|---|
| `services::ssh_session::create_ssh_session(ssh_backend, config, backend, id)` | `services/ssh_session/mod.rs` | `commands/ssh/create.rs` |

## 7. services/session_log

| 调用 | 来源 | 何时 |
|---|---|---|
| `services::session_log::start_session_logging(id, &config)` | `services/session_log.rs` | create_local / create_ssh 之后 |

**约束**：调用失败**不**传播（仅 tracing::warn）—— 日志缺失不应阻断 session 创建。

## 8. infrastructure

| 调用 | 来源 | 何时 |
|---|---|---|
| `RealAppBackend::new(app_handle)` | `infrastructure/app_backend.rs` | 每个 create_xxx_session command 入口处 |
| `upload_file_via_ssh(&ssh_cfg, &local_path, &remote_path)` | `infrastructure/ssh.rs` | `upload_image_to_ssh_session` 内部 |

**约束**：session 模块是**唯一允许**直接 import `infrastructure::ssh::upload_file_via_ssh` 的 module —— 因为这是 SSH 上传的原子操作，没有 business rule 可以下沉。

## 9. models

session 模块直接读以下 models 类型（参数 / 返回值）：

| 类型 | 来源 |
|---|---|
| `LocalSessionConfig` | `models/session.rs` |
| `SSHSessionConfig` | `models/session.rs` |
| `SessionConfig` (enum) | `models/session.rs` |
| `SessionInfo` | `models/session.rs` |
| `TmuxCcConfig` | `models/session.rs` |
| `CapabilityFlags` | `models/capabilities.rs` |
| `SessionLoggingConfig` | `models/session.rs` |

**约束**：models 是纯数据类型，session 可自由 import，不算跨层。

## 10. 设计意图：session 是「原子能力 + 跨 module 协调者」

session 模块**两个角色**：

1. **原子能力提供者**：create_local / create_ssh / write / close / resize 都是单一原子操作 —— 这些**不**调其他 backend app module
2. **跨 module 协调者**：
   - create 后持久化 → 调 `app/settings/api`
   - create_session generic dispatcher 路由 tmux → 调 `app/terminal/api`

**对比 v3**：v3 的 `commands/session.rs` 把所有跨 module 调用硬编码进 IPC handler（`create_tmux_session` 内部直接调 `commands::persistence::save_attached_tmux_servers_impl`），破坏了边界。v4 通过 api.rs 重定向，session 不再 import `commands::*`。

## 11. v3 → v4 跨 module 调用的迁移

| v3 现状 | v4 改法 |
|---|---|
| `commands/session.rs::create_tmux_session` 内联调 `crate::commands::persistence::save_attached_tmux_servers_impl` | `app/terminal/api.rs::create_tmux` 内部调 `app/settings/api::save_attached_tmux_servers` |
| `commands/session.rs::create_session` 内部直接 `state.create_tmux(...)` | `commands/session/dispatch.rs` 内部调 `app/terminal/api::create_tmux(state, backend, &tmux)` |
| `commands/session.rs::upload_image_to_ssh_session` 内部调 `state.upload_image(...)` | 不变（同一 service 调用，无需 api 边界） |

## 12. 不允许的依赖

- ❌ `modules/session/` → `services::tmux_session::*`（必须经过 `app/terminal/api.rs`）
- ❌ `modules/session/` → `infrastructure::pty::*`（必须经过 `services::local_session::*`）
- ❌ `modules/session/` → `commands::persistence::*`（必须经过 `app/settings/api.rs`）
- ❌ `modules/session/` → `services::session_manager` 的字段直读（必须通过 public methods）
- ❌ `modules/session/` → `app/shell/api.rs::initialize`（shell 不调 session，session 完全由前端触发）

## 13. 依赖变更流程

1. **新增 IPC 命令** → 加 `commands/<domain>.rs` + 加 `services::session_manager::method()` + 在 §4 同步
2. **新增 service 方法** → 在 `services::session_manager` 加 + 在 §4 同步
3. **新增跨 module 调用** → 加 `app/<other>/api::method()` + 在 §2 / §3 同步
4. **修改 service 字段**（如 SessionManager 新增 DashMap）→ 在 §4 加新 method 文档，**禁止**让 session module 直读字段
5. **修改 IPC payload key**（如 `data` → `bytes`）→ 禁止；如不可避免，需 frontend + backend 同步改