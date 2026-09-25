# Module · App Terminal — 对下依赖

> **位置**：`src-tauri/src/app/modules/terminal/`

## 1. 依赖图

```
modules/terminal/
├── api.rs        ────►  app/session/api.rs           (create_tmux 被 session dispatcher 调用)
├── api.rs        ────►  app/settings/api.rs          (save_attached_tmux_servers after create/attach/detach/kill)
├── api.rs        ────►  services/session_manager     (唯一直接调用的 service)
├── api.rs        ────►  models/session::*            (TmuxCcConfig / TmuxSessionInit / AttachedTmuxServer)
└── api.rs        ────►  infrastructure/app_backend   (RealAppBackend::new 构造 AppHandle wrapper)
```

**关键约束**：terminal module **不** import `services::tmux_session::*` 字段——通过 `SessionManager::create_tmux` / `attach_tmux` / 等 public methods 间接访问 `TmuxController`。

## 2. app/session

| 调用 | 来源 | 何时调 |
|---|---|---|
| `session_api::create_session(...)` 内部路由到 `terminal_api::create_tmux` | `app/session/api.rs` | 前端调 `create_session(SessionConfig::TmuxCc)` 时 |

**关键**：这是 session → terminal 的跨 module 调用，由 session dispatcher 发起。terminal 自身**不** call session_api。

## 3. app/settings

terminal 在以下触发点调 settings_api：

| 触发点 | 调用 | 来源 | 时机 |
|---|---|---|---|
| `create_tmux_session` 成功 | `settings_api::save_attached_tmux_servers(&app, &servers)` | `app/settings/api.rs` | controller 创建后立即 |
| `attach_tmux_session` 成功 | `settings_api::save_attached_tmux_servers(&app, &servers)` | `app/settings/api.rs` | attach 成功后立即 |
| `detach_tmux_controller` 成功 | `settings_api::save_attached_tmux_servers(&app, &servers)` | `app/settings/api.rs` | detach 后立即 |
| `kill_server_via_controller` 成功 | `settings_api::save_attached_tmux_servers(&app, &servers)` | `app/settings/api.rs` | kill 后立即 |
| `unmark_attached_tmux` | `settings_api::save_attached_tmux_servers(&app, &servers)` | `app/settings/api.rs` | 强制清除 stale entry |

**关键**：

- terminal **不**直接 import `tauri_plugin_store` —— 必须经过 `settings_api`
- 持久化失败**不**向上传播（tracing::warn 即可）
- 每次 controller 集合变更都同步一次——`save_attached_tmux_servers` 接受全量 `Vec<AttachedTmuxServer>`，由 SessionManager 投影

## 4. services/session_manager

terminal api **唯一直接调用**的 service。调用面：

| 调用 | 何时 |
|---|---|
| `state.create_tmux(&config, backend)` | `create_tmux_session` / session dispatcher |
| `state.attach_tmux(&config, backend)` | `attach_tmux_session` |
| `state.probe_tmux_session_exists(&config)` | `probe_tmux_session_exists` |
| `state.auto_attach_on_startup(&servers, backend)` | `auto_attach_tmux_servers` |
| `state.create_tmux_pane(controller_id, &parent_pane, &direction)` | `create_tmux_pane` |
| `state.kill_tmux_pane(controller_id, &pane_id)` | `kill_tmux_pane` |
| `state.resize_tmux_pane(controller_id, &pane_id, rows, cols)` | `resize_tmux_pane` |
| `state.capture_tmux_pane(controller_id, &pane_id, lines)` | `capture_tmux_pane` |
| `state.create_tmux_window(controller_id, name.as_deref())` | `create_tmux_window` |
| `state.kill_tmux_window(controller_id, &window_id)` | `kill_tmux_window` |
| `state.rename_tmux_window(controller_id, &window_id, &new_name)` | `rename_tmux_window` |
| `state.list_attached_tmux_servers()` | `get_attached_tmux_servers`（projection） |
| `state.detach_tmux_controller(controller_id)` | `detach_tmux_controller` |
| `state.close_tmux_controller(controller_id)` | `kill_server_via_controller` |

**约束**：

- terminal **不** import `services::session_manager` 的字段（tmux_controllers / sessions DashMap）—— 只通过 public methods
- terminal **不** import `services::tmux_session::*`（包括 controller / bridge / protocol）

## 5. services/tmux_session（间接）

terminal **不**直接调用 `TmuxController` / `TmuxBridge` / `TmuxProtocol`——通过 `SessionManager` 的 method 间接使用。这是 v4 的**核心边界规则**：

| SessionManager method | 内部使用的 tmux_session 符号 |
|---|---|
| `create_tmux` / `attach_tmux` | `TmuxController::spawn_create` |
| `create_tmux_pane` / `kill_tmux_pane` | `TmuxController::send_keys` / `send_command` |
| `capture_tmux_pane` | `TmuxController::capture_pane` |
| `list_attached_tmux_servers` | `TmuxController::session_name` |
| `detach_tmux_controller` | `TmuxController::detach` + unbind |

**为什么**：v3 在 bug 0009 时 `SessionManager::create_tmux` 直接读 `TmuxController` 的 `window_bindings` HashMap，导致 stale data。v4 通过 SessionManager method 隔离 terminal 模块与 tmux controller 的耦合——terminal 只关心"业务事件"，不关心 controller 内部字段。

## 6. infrastructure

| 调用 | 来源 | 何时 |
|---|---|---|
| `RealAppBackend::new(app_handle)` | `infrastructure/app_backend.rs` | 每个 create_xxx / attach_xxx command 入口处 |

**约束**：terminal 是**唯一允许**直接 import `infrastructure::app_backend` 的 module（与 session module 共享此权限）—— 因为这是 Tauri-level handle wrapper，没有业务规则。

terminal **不**直接 import `infrastructure::tmux::*` 或 `infrastructure::ssh::*`。

## 7. models

terminal 模块直接读以下 models 类型：

| 类型 | 来源 |
|---|---|
| `TmuxCcConfig` | `models/session.rs` |
| `TmuxSessionInit` | `models/session.rs` |
| `TmuxControlWindowInit` | `models/session.rs` |
| `AttachedTmuxServer` | `models/session.rs` |
| `AutoAttachOutcome` | `services::session_manager.rs`（输出类型） |

**约束**：models 是纯数据类型，terminal 可自由 import。

## 8. 设计意图：terminal 是「tmux -CC 系统的 IPC facade」

v3 的反模式：`commands/session.rs::create_tmux_session` 直接调 `state.create_tmux(...)` 同时内联调 `commands::persistence::save_attached_tmux_servers_impl(&app, &servers)`——一个 IPC handler 跨越：

1. service 层（state.create_tmux）
2. 跨 module persistence（save_attached_tmux_servers_impl）
3. 跨 module backend 类型（RealAppBackend）

v4 的边界：

- terminal api 是**纯 function 集合**（pub fn）——可被同 module commands 调用，可被其他 module 通过 api 边界调用
- `#[tauri::command]` wrapper 只做 3 件事：注入 State / 构造 backend / 调 api + 触发 settings 持久化
- 跨 module 调用只通过 `app/<other>/api.rs`

## 9. v3 → v4 跨 module 调用的迁移

| v3 现状 | v4 改法 |
|---|---|
| `commands/session.rs::create_tmux_session` 内联调 `crate::commands::persistence::save_attached_tmux_servers_impl(&app, &servers)` | `app/terminal/commands/tmux/session.rs::create_tmux_session` 内调 `app/settings/api::save_attached_tmux_servers(&app, &servers)` |
| `commands/session.rs::attach_tmux_session` 同样内联 | 同上 |
| `commands/session.rs::detach_tmux_controller` 同样内联 | 同上 |
| `commands/session.rs::kill_server_via_controller` 同样内联 | 同上 |

## 10. 不允许的依赖

- ❌ `modules/terminal/` → `services::tmux_session::*`（必须经过 `SessionManager` public method）
- ❌ `modules/terminal/` → `services::tmux_session::controller::TmuxController` 字段
- ❌ `modules/terminal/` → `infrastructure::tmux::*`（必须经过 service）
- ❌ `modules/terminal/` → `infrastructure::ssh::*`（probe SSH 走 SessionManager）
- ❌ `modules/terminal/` → `commands::session::*`（必须经过 `app/session/api.rs`）
- ❌ `modules/terminal/` → `commands::persistence::*`（必须经过 `app/settings/api.rs`）

## 11. 依赖变更流程

1. **新增 tmux IPC 命令** → 加 `commands/tmux/<sub>.rs` + 加 `services::session_manager::method()` + 在 §4 同步
2. **新增 tmux controller 操作**（如未来加 `swap_tmux_pane`）→ 加 `TmuxController::swap_pane` + 加 `SessionManager::swap_tmux_pane` wrapper + 加 `commands/tmux/pane.rs` 的 wrapper + 在 §5 同步
3. **新增持久化触发点** → 加 `settings_api::save_*` 调用 + 在 §3 同步
4. **修改 IPC payload key** → 禁止；如不可避免需 frontend + backend 同步改
5. **新增 terminal preferences IPC**（如未来）→ 加 `commands/preferences.rs` + 加 `app/settings/api::save_terminal_preferences`（preferences 持久化属于 settings）