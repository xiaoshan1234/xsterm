# Module · App Settings — 对下依赖

> **位置**：`src-tauri/src/app/modules/settings/`

## 1. 依赖图

```
modules/settings/
├── api.rs        ────►  tauri-plugin-store::StoreExt    (唯一直接 import 的 infra)
├── api.rs        ────►  logging_setup::*               (LogConfig / cleanup_old_logs)
├── api.rs        ────►  tracing::{debug,info,warn,error} (log_message 转发)
├── api.rs        ────►  tracing_subscriber::reload::*  (EnvFilter reload handle)
├── api.rs        ────►  models/session::*              (SessionInfo / AttachedTmuxServer)
├── api.rs        ────►  models/group::*                (GroupStore)
├── api.rs        ────►  models/capabilities::*         (CapabilityFlags)
└── commands/     ────►  (不调任何其他 module —— settings 是被调用方)
```

**关键约束**：settings **不** import 任何 `services::*` / `app/<other>/*` / `infrastructure::{pty,ssh,tmux}::*`——它是无状态持久化层。

## 2. tauri-plugin-store（唯一直接依赖的 infra）

settings 是**唯一**允许直接 import `tauri_plugin_store::StoreExt` 的 module：

| 调用 | 来源 | 何时 |
|---|---|---|
| `app.store("sessions.json")` | `tauri_plugin_store` | `save_sessions_impl` / `load_sessions_impl` |
| `app.store("groups.json")` | 同上 | `save_groups` / `load_groups` |
| `app.store("attached_tmux.json")` | 同上 | `save_attached_tmux_servers_impl` / `load_attached_tmux_servers` |
| `app.store("log_config.json")` | 同上 | `set_log_config` |

**约束**：

- 其他 module **禁止**直接 import `tauri_plugin_store` —— 必须经过 settings_api
- settings **不**在其他文件 import `tauri_plugin_store`（除本 module 内部）
- 所有 store key / file name 字面量集中在 `model.rs` 的 const 中

## 3. logging_setup

| 调用 | 来源 | 何时 |
|---|---|---|
| `LogConfig` (struct) | `crate::logging_setup` | `load_log_config_impl` 返回类型 + `set_log_config` 参数 |
| `cleanup_old_logs(&log_dir, max_bytes)` | `crate::logging_setup` | shell.initialize 步骤（**不在本 module**，shell 调） |

**约束**：settings 只读 `LogConfig` 类型 + 读 / 写它的 JSON 序列化；**不**做 cleanup（那是 shell 启动序列的责任）。

## 4. tracing

| 调用 | 来源 | 何时 |
|---|---|---|
| `tracing::debug!(target: "frontend", "{}", msg)` | `tracing` crate | `log_message` 收到 `"DEBUG"` level 时 |
| `tracing::info!(target: "frontend", "{}", msg)` | 同上 | `"INFO"` level（default） |
| `tracing::warn!(target: "frontend", "{}", msg)` | 同上 | `"WARN"` level |
| `tracing::error!(target: "frontend", "{}", msg)` | 同上 | `"ERROR"` level |

**约束**：

- `target: "frontend"` 是关键——让 frontend log 与 backend log 在同一个文件里 grep 时能区分
- `log_message` **不**生成新的 span / event；只把已有 message 加上 `[source] message - data` 格式串

## 5. tracing-subscriber（reload handle）

| 调用 | 来源 | 何时 |
|---|---|---|
| `reload::Handle<EnvFilter, Registry>` | `tracing_subscriber::reload` | `set_log_config` 注入到 `State<Arc<Mutex<...>>>` 后 reload |
| `EnvFilter::new(&config.log_level)` | `tracing_subscriber` | `set_log_config` 内部 |

**约束**：

- reload handle 由 `logging_setup::init_logging` 创建（**不**在 settings module 创建）
- settings 只**消费** reload handle —— 通过 `state.lock()?.handle.reload(new_filter)?`
- 创建 / 管理 reload handle 是 logging_setup 的责任

## 6. models

settings 模块直接读以下 models 类型：

| 类型 | 来源 |
|---|---|
| `SessionInfo` | `models/session.rs` |
| `AttachedTmuxServer` | `models/session.rs` |
| `GroupStore` | `models/group.rs` |
| `SessionGroup` | `models/group.rs` |
| `CapabilityFlags` | `models/capabilities.rs` |
| `LogConfig` | `logging_setup.rs`（不是 model，但与 model 同等地位） |

**约束**：models 是纯数据类型，settings 可自由 import。

## 7. 设计意图：settings 是「唯一 import infra 的 module」

v0 反模式：`commands/persistence.rs` + `commands/logging.rs` + `commands/session.rs` 三处都 import `tauri_plugin_store::StoreExt`——任何持久化策略变更（如加 encryption）要改 3 处。

v1 边界：

- settings module 是**唯一** import `tauri_plugin_store` 的地方
- 其他 module 只调 `settings_api::*` —— 完全不知道持久化用的是 tauri-plugin-store
- 未来如果换成 sqlite / sled，只改 settings module 一个地方

## 8. v0 → v1 持久化入口迁移

| v0 现状 | v1 改法 |
|---|---|
| `commands/session.rs::create_tmux_session` 内联调 `crate::commands::persistence::save_attached_tmux_servers_impl(&app, &servers)` | `app/terminal/commands/tmux/session.rs::create_tmux_session` 内调 `app/settings/api::save_attached_tmux_servers_impl(&app, &servers)` |
| `commands/session.rs::attach_tmux_session` 同样内联 | 同上 |
| `commands/session.rs::create_local_session` 直接构造 `RealAppBackend::new(app)` | `app/session/commands/local/create.rs` 内调 `session_api::create_local(state, backend, config)` |
| `commands/logging.rs::log_message` 直接 `tracing::*!` | 不变（属于本 module） |
| `commands/logging.rs::set_log_config` 直接 reload EnvFilter | 不变 |

## 9. 不允许的依赖

- ❌ `modules/settings/` → `services::session_manager::*`（settings 不知道 session 存在）
- ❌ `modules/settings/` → `services::tmux_session::*`（同上）
- ❌ `modules/settings/` → `app/<other>/*`（settings 是被调用方）
- ❌ `modules/settings/` → `infrastructure::pty::*` / `infrastructure::ssh::*` / `infrastructure::tmux::*`
- ❌ 其他 module → `tauri_plugin_store` 直调（必须经过 settings_api）

## 10. 依赖变更流程

1. **新增持久化 IPC** → 加 `commands/persistence/<domain>.rs` + 加 pure function + 加 `#[tauri::command]` wrapper + 在 §2 / §6 同步
2. **新增 logging IPC** → 加 `commands/logging/<domain>.rs` + 加 §3 / §4 / §5 同步
3. **修改 store file name** → ⚠️ 破坏性变更——前端缓存的 store 会失效，需要 migration 脚本
4. **修改 store key** → 同上警告
5. **修改 log reload 行为** → 在 §5 同步 + 注意不要破坏 `set_log_config` 的 reload 时机
6. **新增跨 module 持久化触发点**（如未来 workspace save）→ 加 `settings_api::save_workspace_state` + 在被调用方（workspace module）的 DOWNSTREAM 加对应行