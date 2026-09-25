# Domain · Persistence — 对外接口

> **位置**：`src-tauri/src/domain/persistence/api.rs`
> **唯一进口**：`use crate::domain::persistence::*;`

## 1. 对外暴露什么

persistence domain 暴露 3 类符号：

1. **Generic JSON value IO** —— `save_json_value` / `load_json_value` / `delete_json_value` / `store_exists`
2. **Typed wrapper** —— 只 `save_attached_tmux_typed` / `load_attached_tmux_typed`（其他 sessions/groups 走 frontend 直存，不归 backend）
3. **Error 类型** —— `PersistenceError`（thiserror derive）

**砍掉的 typed wrapper**：

- ~~`save_sessions_typed` / `load_sessions_typed`~~ —— frontend 直存 sessions.json
- ~~`save_groups_typed` / `load_groups_typed`~~ —— frontend 直存 groups.json

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

### 2.2 Typed wrapper（仅 attached_tmux）

```rust
// domain/persistence/attached_tmux.rs
use crate::domain::terminal::AttachedTmuxServer;

pub const ATTACHED_TMUX_FILE: &str = "attached_tmux.json";
pub const ATTACHED_TMUX_KEY: &str = "servers";

pub fn save_attached_tmux_typed(app: &AppHandle, servers: &[AttachedTmuxServer]) -> Result<(), String>;
pub fn load_attached_tmux_typed(app: &AppHandle) -> Result<Vec<AttachedTmuxServer>, String>;
// ↑ 文件不存在时返回 Vec::new()
```

**为什么不 typed wrapper 全砍**：attached_tmux 是进程级状态（controller Arc 注册表），backend 必须自己加载 + 保存；typed wrapper 提供类型安全 + 集中 store key 字面量。

### 2.3 Error 类型

```rust
// domain/persistence/errors.rs
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

// 在 domain/persistence/mod.rs 根级
impl From<PersistenceError> for String {
    fn from(e: PersistenceError) -> Self { e.to_string() }
}
```

## 3. 跨 domain 调用接口

### 3.1 settings → persistence（log_config.json IO）

```rust
// domain/persistence/api.rs
use crate::domain::persistence::LogConfig;

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

**为什么 log_config backend 持久化**：log level 改了要 reload `tracing` subscriber（ReloadHandle 是 backend runtime 句柄），frontend 没法 reload。

### 3.2 commands/terminal → persistence（attached_tmux.json）

```rust
// commands/terminal/api.rs
use crate::domain::persistence as persistence_api;

#[tauri::command]
pub async fn create_tmux_session(...) -> Result<TmuxSessionInit, String> {
    let result = domain::session::create_tmux(...).await;
    if result.is_ok() {
        let servers = state.inner().list_attached_tmux_servers();
        if let Err(e) = persistence_api::save_attached_tmux_typed(&app, &servers) {
            tracing::warn!("create_tmux_session: persistence failed: {e}");
        }
    }
    result
}
```

**为什么 attached_tmux backend 持久化**：tmux controller Arc 注册表 + SSH channel 都在 backend 进程里，shutdown 时 frontend 已关，**backend 必须自己持久化**。

## 4. 接缝契约

```rust
// domain/persistence/api.rs 是唯一对外入口
// app / 其他 service 调 persistence_api::*（typed wrapper 或 generic wrapper）
// 不允许直接 import domain/persistence/attached_tmux.rs 内部
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

1. **新增 typed wrapper**（如未来加 `workspace.json`）→ 加 `domain/persistence/<file>.rs` + 在 §2.2 同步 + 加 store file / key const
2. **修改 typed wrapper 签名** → ⚠️ breaking——检查所有 app 调用方 + frontend `service/persistence` 类型
3. **修改 store file name** → ⚠️ breaking——老 store 文件丢失，需要 migration
4. **删除 typed wrapper** → 从 persistence 文件 + app 调用方同步删除

## 7. 错误传播约定

- `Result<T, String>` 作为公共 API 返回类型（不暴露 PersistenceError 到调用方）
- `PersistenceError` 内部使用，通过 `From<PersistenceError> for String` 在 `domain/persistence/mod.rs` 根级实现
- 调用方通过 `?` 运算符自动转换

## 8. MVP 范围之外（未来扩展）

### 8.1 schema migration

```rust
// domain/persistence/migrations.rs（未来）
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

**触发条件**：store schema 变化（如 `AttachedTmuxServer` 加字段 / 字段重命名）

### 8.2 store 损坏自动 fallback + 备份

```rust
// domain/persistence/api.rs（未来）
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

**触发条件**：用户报告"我的 attached tmux 列表突然消失了"