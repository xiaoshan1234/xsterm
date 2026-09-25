# Service · Persistence — 对外接口

> **位置**：`src-tauri/src/services/persistence/api.rs`
> **唯一进口**：`use crate::services::persistence::*;`

## 1. 对外暴露什么

persistence domain 暴露 4 类符号：

1. **Generic JSON value IO**——`save_json_value` / `load_json_value` / `delete_json_value`
2. **Typed wrapper**——`save_sessions_typed` / `load_sessions_typed` / `save_groups_typed` / `load_groups_typed` / `save_attached_tmux_typed` / `load_attached_tmux_typed`
3. **Utility**——`store_exists(&app, file) -> bool`
4. **Error 类型**——`PersistenceError`（thiserror derive）

## 2. 核心接口

### 2.1 Generic JSON value IO

```rust
use serde_json::Value;
use tauri::AppHandle;

/// 写任意 JSON value 到指定 (file, key)
/// 等价于 `store.set(key, value); store.save();`
pub fn save_json_value(
    app: &AppHandle,
    file: &str,
    key: &str,
    value: &Value,
) -> Result<(), String>;

/// 读指定 (file, key) 的 JSON value
/// 返回 None 当 store 文件或 key 不存在
pub fn load_json_value(
    app: &AppHandle,
    file: &str,
    key: &str,
) -> Result<Option<Value>, String>;

/// 删除指定 (file, key) 的 value
/// 等价于 `store.delete(key); store.save();`
pub fn delete_json_value(
    app: &AppHandle,
    file: &str,
    key: &str,
) -> Result<(), String>;

/// 检查 store 文件是否被持久化（store 文件存在 + 至少 1 个 key）
pub fn store_exists(app: &AppHandle, file: &str) -> bool;
```

### 2.2 Typed wrappers（按 store 文件分文件）

```rust
// services/persistence/sessions.rs
use crate::models::session::SessionInfo;

const SESSIONS_FILE: &str = "sessions.json";
const SESSIONS_KEY: &str = "sessions";

pub fn save_sessions_typed(app: &AppHandle, sessions: &[SessionInfo]) -> Result<(), String>;
pub fn load_sessions_typed(app: &AppHandle) -> Result<Vec<SessionInfo>, String>;

// services/persistence/groups.rs
use crate::models::group::GroupStore;

const GROUPS_FILE: &str = "groups.json";
const GROUPS_KEY: &str = "groups";

pub fn save_groups_typed(app: &AppHandle, groups: &GroupStore) -> Result<(), String>;
pub fn load_groups_typed(app: &AppHandle) -> Result<GroupStore, String>;
// ↑ 文件不存在时返回 GroupStore { groups: vec![], next_group_id: 1 }

// services/persistence/attached_tmux.rs
use crate::models::session::AttachedTmuxServer;

const ATTACHED_TMUX_FILE: &str = "attached_tmux.json";
const ATTACHED_TMUX_KEY: &str = "servers";

pub fn save_attached_tmux_typed(app: &AppHandle, servers: &[AttachedTmuxServer]) -> Result<(), String>;
pub fn load_attached_tmux_typed(app: &AppHandle) -> Result<Vec<AttachedTmuxServer>, String>;
```

### 2.3 Error 类型

```rust
// services/persistence/errors.rs
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PersistenceError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("tauri-plugin-store error: {0}")]
    Store(String),

    #[error("json serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("store key {0} not found in {1}")]
    KeyNotFound(String, String),

    #[error("invalid typed value: {0}")]
    InvalidType(String),
}

// 在 services/persistence/mod.rs 根级
impl From<PersistenceError> for String {
    fn from(e: PersistenceError) -> Self { e.to_string() }
}
```

## 3. 跨 domain 调用接口

### 3.1 settings → persistence（log_config.json IO）

```rust
// services/settings/api.rs（v1.1——下个 PR 改造）
use crate::services::persistence as persistence_api;

pub fn load_log_config(app: &AppHandle) -> Result<LogConfig, String> {
    let value = persistence_api::load_json_value(app, "log_config.json", "config")?
        .ok_or_else(|| "log_config.json missing".to_string())?;
    serde_json::from_value(value).map_err(|e| e.to_string())
}

pub fn save_log_config(app: &AppHandle, config: &LogConfig) -> Result<(), String> {
    let value = serde_json::to_value(config).map_err(|e| e.to_string())?;
    persistence_api::save_json_value(app, "log_config.json", "config", &value)
}
```

**当前状态**：MVP 保持 `services/settings/api.rs` 直调 tauri-plugin-store；下个 PR 改。

### 3.2 app/session → persistence（typed wrapper）

```rust
// app/session/commands/local/create.rs
use crate::services::persistence as persistence_api;

pub async fn create_local_session(...) -> Result<SessionInfo, String> {
    let info = session_api::create_local(...)?;

    // 触发持久化
    if config.should_save.unwrap_or(false) {
        if let Err(e) = persistence_api::save_sessions_typed(&app, &vec![info.clone()]) {
            tracing::warn!("create_local_session: persistence failed: {e}");
        }
    }
    Ok(info)
}
```

### 3.3 app/terminal → persistence（typed wrapper）

```rust
// app/terminal/commands/tmux/session.rs
use crate::services::persistence as persistence_api;

#[tauri::command]
pub async fn create_tmux_session(...) -> Result<TmuxSessionInit, String> {
    let result = terminal_api::create_tmux(...).await;
    if result.is_ok() {
        let servers = state.inner().list_attached_tmux_servers();
        if let Err(e) = persistence_api::save_attached_tmux_typed(&app, &servers) {
            tracing::warn!("create_tmux_session: persistence failed: {e}");
        }
    }
    result
}
```

## 4. 接缝契约

```rust
// services/persistence/api.rs 是唯一对外入口
// app / 其他 service 调 persistence_api::*（typed wrapper 或 generic wrapper）
// 不允许直接 import services/persistence/{sessions,groups,attached_tmux}.rs 内部
```

**接缝约束**：

- typed wrapper 是 public API（供其他 service / app 调用）
- generic JSON IO 是 public API（供 settings 等需要自定义 store 的 service 调用）
- typed wrapper **不**直接暴露 store key 字面量（const 隐藏在 typed wrapper 文件内）
- 其他 service **不** import `tauri_plugin_store`（必须经过 persistence_api）

## 5. 不对外暴露

- `tauri_plugin_store::StoreExt` —— 只有 persistence api 内部使用
- store key 字面量（const）—— 隐藏在 typed wrapper 文件
- `serde_json::Value` 序列化 / 反序列化的细节 —— 由 typed wrapper 封装

## 6. api.rs 变更流程

1. **新增 typed wrapper** → 加 `services/persistence/<file>.rs` + 在 §2.2 同步 + 加 store file / key const
2. **修改 typed wrapper 签名** → ⚠️ breaking——检查所有 app 调用方 + frontend `service/persistence` 类型
3. **修改 store file name** → ⚠️ breaking——老 store 文件丢失，需要 migration
4. **删除 typed wrapper** → 从 persistence 文件 + app 调用方 + frontend 同步删除
5. **新增 migration**（未来） → 加 `services/persistence/migrations.rs` + migration 注册表

## 7. 错误传播约定

- `Result<T, String>` 作为公共 API 返回类型（不暴露 PersistenceError 到调用方）
- `PersistenceError` 内部使用，通过 `From<PersistenceError> for String` 在 `services/persistence/mod.rs` 根级实现
- 调用方通过 `?` 运算符自动转换

## 8. MVP 范围之外（未来扩展）

### 8.1 schema migration

```rust
// services/persistence/migrations.rs（未来）
pub trait Migration {
    fn version(&self) -> u32;
    fn migrate(&self, value: &mut Value) -> Result<(), PersistenceError>;
}

pub fn run_migrations(file: &str, current: &mut Value) -> Result<(), PersistenceError> {
    let migration = MIGRATIONS
        .iter()
        .find(|m| m.file == file && m.version() > read_version(file)?);
    // ... 应用 migration
}
```

**触发条件**：store schema 变化（如 `SessionInfo` 加字段 / 字段重命名）

### 8.2 store 损坏自动 fallback + 备份

```rust
// services/persistence/api.rs（未来）
pub fn load_json_value_safe(
    app: &AppHandle,
    file: &str,
    key: &str,
) -> Result<Option<Value>, PersistenceError> {
    match load_json_value(app, file, key) {
        Ok(v) => Ok(v),
        Err(PersistenceError::Json(_)) => {
            // 备份损坏文件
            backup_corrupt_store(app, file)?;
            Err(PersistenceError::InvalidType("corrupt store".into()))
        }
        Err(e) => Err(e),
    }
}
```

**触发条件**：用户报告"我的 settings 突然消失了"