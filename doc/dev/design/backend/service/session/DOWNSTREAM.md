# Service · Session — 对下依赖

> **位置**：`src-tauri/src/services/session/`

## 1. 依赖图

```
services/session/
├── api.rs        ────►  services/tmux::* (TmuxController 公开方法)
├── api.rs        ────►  services/session/backends/* (3 种实现)
├── api.rs        ────►  infrastructure/pty::* (PtySystem trait)
├── api.rs        ────►  infrastructure/ssh::* (SshBackend trait)
├── api.rs        ────►  infrastructure/app_backend::* (AppBackend trait)
├── api.rs        ────►  models/session::* (SessionConfig / SessionInfo / ActiveSession)
├── api.rs        ────►  models/capabilities::* (CapabilityFlags)
├── backends/local.rs  ────►  services/local_session_impl::* (PTY 实现的 helper)
│                          （拆自 v3 services/local_session/* 的 spawn/bytes/resolution）
├── backends/ssh.rs    ────►  services/ssh_session_impl::* (russh 连接 helper)
│                          （拆自 v3 services/ssh_session/*）
└── log.rs            ────►  crate::logging_setup (tracing appender)
```

## 2. services/tmux

session 通过 `TmuxController` 公开方法访问 tmux 功能：

| 调用 | 来源 | 何时 |
|---|---|---|
| `TmuxController::spawn_create(config, backend, ssh_backend, controller_id, allocator)` | `services/tmux/controller/spawn.rs` | `SessionManager::create_tmux` / `attach_tmux` |
| `TmuxController::await_first_pane()` | `services/tmux/controller/sync.rs` | create / attach 后等待 bootstrap pane |
| `TmuxController::take_initial_state()` | `services/tmux/controller/sync.rs` | create / attach 后等待 windows + panes |
| `TmuxController::tmux_window_id_for_pane(&pane_id)` | `services/tmux/controller/registry.rs` | 查 pane 所属 window id |
| `TmuxController::controller_id()` | `services/tmux/controller/mod.rs` | tmux pane handle 持有 |
| `TmuxController::session_name()` | `services/tmux/controller/mod.rs` | `list_attached_tmux_servers` projection |
| `TmuxController::send_keys(&pane, bytes)` | `services/tmux/controller/commands.rs` | `TmuxPaneHandle::write` |
| `TmuxController::resize_pane(&pane, rows, cols)` | 同上 | `TmuxPaneHandle::resize` |
| `TmuxController::unbind_pane(&pane)` | `services/tmux/controller/registry.rs` | `TmuxPaneHandle::close` |
| `TmuxController::capture_pane(&pane, lines)` | `services/tmux/controller/commands.rs` | `SessionManager::capture_tmux_pane` |
| `TmuxController::detach()` | 同上 | `SessionManager::detach_tmux_controller` |

**约束**：

- session **不** import `TmuxController` 的字段（pane_bindings / window_bindings / initial_state / dispatch_task 等）
- session **不** import `services::tmux::bridge::*`（bridge 是 controller 内部事件推送机制）
- session **不** import `services::tmux::protocol::*`（纯协议层，controller 封装）
- session 通过 `Arc<TmuxController>` 持有引用——可调用所有公开方法

**关键（bug 0009 防御）**：v3 的 `SessionManager::create_tmux` 直读 `TmuxController.window_bindings` HashMap——v4 严格禁止字段直读。所有跨 domain 访问走 trait / public method。

## 3. services/session/backends（自身子模块）

| 调用 | 来源 | 何时 |
|---|---|---|
| `LocalSession::write / resize / close` | `backends/local.rs` | `SessionManager::write` / `resize_pty_session` / `close` |
| `SshSession::write / resize / close / get_ssh_config` | `backends/ssh.rs` | 同上 + 上传图片 |
| `TmuxPaneHandle::write / resize / close`（委托给 controller） | `backends/tmux_pane.rs` | tmux session 同上 |

**约束**：

- 3 种 backend 都实现 `SessionBackend` trait
- `SshSession` 是具体类型（非 `dyn SessionBackend`）——保留具体类型以读 `SSHSessionConfig`
- 通过 `ActiveSession` enum 统一调度

## 4. infrastructure/pty

| 调用 | 来源 | 何时 |
|---|---|---|
| `PtySystem` trait object（`Box<dyn PtySystem>` 持有） | `infrastructure/pty.rs` | `SessionManager::new` 默认 `NativePtySystem::new()` |
| `PtySystem::openpty(config) -> PtyPair` | 同上 | `LocalSession` 构造时 |

**约束**：infra trait 是同步（或 `BoxFuture`）——service 决定调度。session 通过 trait object 持有。

## 5. infrastructure/ssh

| 调用 | 来源 | 何时 |
|---|---|---|
| `SshBackend` trait object（`Arc<dyn SshBackend>` 持有） | `infrastructure/ssh.rs` | `SessionManager::new` 默认 `SshBackendImpl::new()` |
| `SshBackend::connect(config) -> SshChannel` | 同上 | `SshSession` 构造时 |
| `upload_file_via_ssh(&config, &local_path, &remote_path)` | `infrastructure/ssh.rs` | `SessionManager::upload_image` |

## 6. infrastructure/app_backend

| 调用 | 来源 | 何时 |
|---|---|---|
| `AppBackend` trait object（`Arc<dyn AppBackend>`）作为参数传入 | `infrastructure/app_backend.rs` | 每个 create_xxx 方法签名 |

**约束**：`AppBackend` 是 Tauri-level handle wrapper——session 不直接 import，由 `app/` 模块构造后传入。

## 7. models

session 模块直接读以下 models 类型：

| 类型 | 来源 |
|---|---|
| `LocalSessionConfig` / `SSHSessionConfig` / `TmuxCcConfig` | `models/session.rs` |
| `SessionInfo` / `TmuxSessionInit` / `AttachedTmuxServer` / `SessionLoggingConfig` / `tmux_pane_info()` | `models/session.rs` |
| `CapabilityFlags` | `models/capabilities.rs` |
| `ActiveSession` enum（v3 在 models/session.rs 内） | 迁移到 `services/session/api.rs`（不属 models）|

**约束**：models 是纯数据类型——session 可自由 import。但 `ActiveSession` 等"持有 backend"的容器类型迁到 services（不属于纯模型）。

## 8. logging_setup

| 调用 | 来源 | 何时 |
|---|---|---|
| `crate::logging_setup::*` (tracing appender 初始化) | `crate::logging_setup.rs` | `start_session_logging` 内部 |

## 9. 设计意图：session 是「backend 的状态机中心」

v4 把"session 是核心 domain"具象化：

- **3 种 backend 都是 session 的实现** —— local/ssh/tmux_pane 是 `SessionBackend` trait 的 3 种 impl
- **tmux controller 不在 session domain 内** —— controller 由 `services/tmux/` 创建，session 通过 `Arc<TmuxController>` 持有
- **session id 全局共享** —— 3 种 backend 都从 `SessionIdSource::allocate()` 取 id
- **bug 0009 防御** —— 严格禁止字段直读，强制走 trait / public method

## 10. v3 → v4 跨调用迁移

| v3 现状 | v4 改法 |
|---|---|
| `services/session_manager.rs::create_tmux` 直读 `TmuxController.window_bindings` HashMap | `services/session/manager.rs::create_tmux` 调 `TmuxController::tmux_window_id_for_pane(&pane_id)` 公开方法 |
| `services/session_manager.rs::attach_tmux` 同样直读 window_bindings | 同上 |
| `services/local_session/*` 平铺 4 文件 | `services/session/backends/local.rs` 单一文件（按 backend 类型分组）|
| `services/ssh_session/mod.rs` 1 文件 | `services/session/backends/ssh.rs` 单一文件 |
| `services/session_manager.rs::TmuxPaneHandle` 内联 | `services/session/backends/tmux_pane.rs` 抽出 |
| `services/session_log.rs` 平铺 | `services/session/log.rs` |
| `models/session.rs::SessionIdSource` | `services/session/id.rs` |

## 11. 不允许的依赖

- ❌ `services/session/` → `services/tmux::*` 的字段（必须走公开方法）
- ❌ `services/session/` → `services/tmux::bridge::*`（bridge 是 controller 内部）
- ❌ `services/session/` → `services/tmux::protocol::*`（controller 封装）
- ❌ `services/session/` → `app::*`（service 不知道 IPC）
- ❌ `services/session/` → `tauri_plugin_store::*`（持久化归 `services/persistence/`）
- ❌ `services/session/` → `services/settings::*`（settings 是横切，由 app 注入 default）
- ❌ `services/session/` → `services/workspace::*`（MVP 预留）
- ❌ 其他 service → `services/session` 的字段直读（必须通过 `SessionManager` public method）

## 12. 依赖变更流程

1. **新增 SessionManager method** → 加 `manager.rs` 方法 + 更新 INTERFACE.md §2
2. **新增 SessionBackend trait method** → 加 trait + 3 个 backend impl + 更新 INTERFACE.md §3
3. **新增 tmux controller 公开方法**（被 session 调用） → 加 `services/tmux/controller/*` 方法 + 在 §2 同步
4. **修改 SessionManager 字段** → ⚠️ breaking——检查所有 `app/<module>/api.rs` 调用方 + frontend `service/session/api.ts` 类型
5. **新增 backend 类型** → 加 `backends/<new>.rs` + 在 `ActiveSession` enum 加 variant + 3 个 trait 实现 + INTERFACE.md §4 更新