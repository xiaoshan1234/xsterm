# Module · App Settings — 对外接口

> **位置**：`src-tauri/src/app/modules/settings/api.rs`（落地 `src-tauri/src/commands/settings.rs` + `commands/settings/` 子目录）
> **唯一进口**：`use crate::app::modules::settings::api::*;`

## 1. 对外暴露什么

settings module 暴露两类符号：

1. **Pure functions**（`pub fn`）—— 内部 store helper 入口，可被同 module `commands/` 子模块调用，可被**其他 module 通过 api 边界**调用（核心跨 module 入口）
2. **`#[tauri::command]` wrappers**（`pub async fn`）—— 注入 `AppHandle` / `State<Arc<Mutex<ReloadHandle>>>` 后调用 (1)

## 2. 核心接口

### 2.1 persistence — sessions

```rust
use crate::models::session::SessionInfo;
use tauri::AppHandle;

// ============ pure functions ============

/// 同步纯函数：保存所有 session list（被 commands/persistence/sessions.rs 和 session create 触发）
pub fn save_sessions_impl(app: &AppHandle, sessions: &[SessionInfo]) -> Result<(), String>;

/// 同步纯函数：读取 sessions（被 commands/persistence/sessions.rs 调用）
pub fn load_sessions_impl(app: &AppHandle) -> Result<Vec<SessionInfo>, String>;

// ============ #[tauri::command] wrappers ============

#[tauri::command]
pub async fn save_sessions(sessions: Vec<SessionInfo>, app: AppHandle) -> Result<(), String>;

#[tauri::command]
pub async fn load_sessions(app: AppHandle) -> Result<Vec<SessionInfo>, String>;
```

### 2.2 persistence — groups

```rust
use crate::models::group::GroupStore;

#[tauri::command]
pub async fn save_groups(store_data: GroupStore, app: AppHandle) -> Result<(), String>;

#[tauri::command]
pub async fn load_groups(app: AppHandle) -> Result<GroupStore, String>;
// ↑ 文件不存在时返回空 GroupStore { groups: vec![], next_group_id: 1 }
```

### 2.3 persistence — attached_tmux_servers

```rust
use crate::models::session::AttachedTmuxServer;

/// 同步纯函数：保存 attached tmux 列表（被 commands/persistence/attached_tmux.rs
/// 和 terminal create/attach/detach/kill 触发）
pub fn save_attached_tmux_servers_impl(
    app: &AppHandle,
    servers: &[AttachedTmuxServer],
) -> Result<(), String>;

#[tauri::command]
pub async fn save_attached_tmux_servers(
    servers: Vec<AttachedTmuxServer>,
    app: AppHandle,
) -> Result<(), String>;

#[tauri::command]
pub async fn load_attached_tmux_servers(
    app: AppHandle,
) -> Result<Vec<AttachedTmuxServer>, String>;
```

### 2.4 logging

```rust
use crate::logging_setup::LogConfig;
use std::sync::{Arc, Mutex};
use tracing_subscriber::{reload, EnvFilter, Registry};

/// 前端日志转发（被 commands/logging/message.rs 调用）
#[tauri::command]
pub async fn log_message(
    level: String,
    source: String,
    message: String,
    data: Option<String>,
) -> Result<(), String>;
// ↑ level = "DEBUG" | "INFO" | "WARN" | "ERROR"，转发到 tracing::{debug,info,warn,error}
// ↑ target = "frontend"，grep 时与 backend log 区分

/// 同步纯函数：读 log config（被 commands/logging/config.rs 和 shell.initialize 调用）
pub fn load_log_config_impl(app: &AppHandle) -> Result<LogConfig, String>;

#[tauri::command]
pub async fn get_log_config(app: AppHandle) -> Result<LogConfig, String>;

#[tauri::command]
pub async fn set_log_config(
    config: LogConfig,
    app: AppHandle,
    state: State<'_, Arc<Mutex<reload::Handle<EnvFilter, Registry>>>>,
) -> Result<(), String>;
// ↑ 写 store + reload EnvFilter

#[tauri::command]
pub async fn get_log_dir(app: AppHandle) -> Result<String, String>;
```

## 3. 跨 module 调用的具体实现

settings module 是**被调用方**——它不主动调其他 module。其他 module 调 settings 的入口：

### 3.1 app/shell → settings（启动时读 log config）

```rust
// app/shell/api.rs
use crate::app::modules::settings::api as settings_api;

pub fn initialize(app: &mut tauri::App) -> Result<(), String> {
    // 1. 读 log config
    let config = settings_api::load_log_config_impl(&app.handle())?;
    // 2. 启动 rolling writer
    let reload_handle = logging_setup::init_logging(&log_dir, &config);
    app.manage(Arc::new(reload_handle));
    // ...
}
```

### 3.2 app/session → settings（创建后持久化 saved config）

```rust
// app/session/commands/local/create.rs
use crate::app::modules::settings::api as settings_api;

pub async fn create_local_session(...) -> Result<SessionInfo, String> {
    let info = session_api::create_local(...)?;

    // 触发持久化（如果 should_save）
    if config.should_save.unwrap_or(false) {
        if let Err(e) = settings_api::save_session_config(&app, &info, &config) {
            tracing::warn!("create_local_session: persistence failed: {e}");
        }
    }
    Ok(info)
}
```

### 3.3 app/terminal → settings（controller 集合变更后持久化）

```rust
// app/terminal/commands/tmux/session.rs
use crate::app::modules::settings::api as settings_api;

#[tauri::command]
pub async fn create_tmux_session(...) -> Result<TmuxSessionInit, String> {
    let result = terminal_api::create_tmux(...).await;
    if result.is_ok() {
        let servers = state.inner().list_attached_tmux_servers();
        if let Err(e) = settings_api::save_attached_tmux_servers_impl(&app, &servers) {
            tracing::warn!("create_tmux_session: persistence failed: {e}");
        }
    }
    result
}
```

**关键**：

- 其他 module 调 settings **必须**通过 `settings_api::*` 入口（pure function）
- settings **不**反向 import 任何 module 的 IPC handler
- 持久化失败**不**向上传播（best-effort，tracing::warn 即可）

## 4. 接缝契约

```typescript
// 前端 app/settings/api.ts
import { invoke } from "@tauri-apps/api/core";

export async function saveSessions(sessions: SessionInfo[]) {
  return invoke<void>("save_sessions", { sessions });
}

export async function loadSessions() {
  return invoke<SessionInfo[]>("load_sessions");
}

export async function setLogConfig(config: LogConfig) {
  return invoke<void>("set_log_config", { config });
}
```

**接缝约束**：

- 前端只通过 `invoke()` 调 backend settings api
- 前端 **不** import backend `commands::settings::*`
- 持久化失败 → backend 静默忽略 + tracing::warn（不向上抛）

## 5. 不对外暴露

- `tauri_plugin_store::StoreExt` —— settings 内部使用，外部不感知
- `tracing_subscriber::reload::Handle` —— settings 内部使用
- 持久化文件路径字面量（`"sessions.json"` / `"groups.json"` / `"attached_tmux.json"` / `"log_config.json"`）—— 通过 `model.rs` 的 const 集中管理

## 6. api.rs 变更流程

1. **新增持久化 IPC** → 加 `commands/persistence/<domain>.rs` + 加 pure function + 加 `#[tauri::command]` wrapper
2. **修改命令签名** → 同步更新 `api.rs` + INTERFACE.md §2 + 前端 `app/settings/api.ts` 类型
3. **删除命令** → 三处一起删除
4. **新增跨 module 持久化触发点**（如未来 settings 加 "save workspace state"）→ 加 `settings_api::save_workspace_state` + 在被调用方（workspace module）调

## 7. 关键的 IPC 契约

下列 payload key 是 frontend ↔ backend 契约的一部分，**禁止重命名**：

| 命令 | 参数名 | 原因 |
|---|---|---|
| `log_message` | `level` / `source` / `message` / `data` | `sessionService.logMessage({ level, source, message, data })` |
| `set_log_config` | `config` | generic param name |
| `save_groups` | `storeData` (camelCase) | 前端 `sessionService.saveGroups({ storeData })` |
| `save_sessions` | `sessions` | 前端 `sessionService.saveSessions({ sessions })` |

详见 `app/settings/DOWNSTREAM.md` §3 的 IPC contract 注释块。

## 8. 关键设计约束

### 8.1 settings 是「横切 module」的副作用集中点

所有"保存 / 读取"操作都集中在 settings——其他 module 不直接 import `tauri-plugin-store`。这样：

- 持久化策略变更（如加 encryption / 改 JSON 格式）只改 settings module
- 持久化失败的处理逻辑集中（统一 best-effort + warn）
- 测试容易（mock `tauri-plugin-store` 只在 settings module 一处）

### 8.2 log_message 是唯一横切的 IPC

`log_message` 是 frontend → backend 的**单向 fire-and-forget**——不返回业务结果。它的存在意义是：

- 让前端 console.log 能落到 backend rolling log（用户报告 bug 时一并打包）
- 让 frontend panic / error 能进入 tracing 流

但它的**业务归属**是 logging 不是 settings tab——所以 v4 仍然把它放在 `app/settings/commands/logging/`，只是接受"logging 是 settings 的子关注点"这个设计折衷（更好的归类是 `infra/logger` 的 IPC facade，但 MVP 没有该 module）。