# Services · Config — 对外接口

> **位置**：`src-tauri/src/services/config/mod.rs`
> **唯一入口**：`use crate::services::config::{ConfigStore, load, write_allowlist, on_reloaded}`
> **被使用方**：`commands/config::*` + `mcp_server::tools::{get_config, set_config, list_profiles}` + `lib.rs::run()` (启动)

## 1. 公开类型

```rust
pub struct ConfigStore {
    inner: Arc<RwLock<AppConfig>>,
    config_path: PathBuf,
    app: AppHandle,
}

pub type UnlistenHandle = Box<dyn FnOnce() + Send>;

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("field '{0}' is not writable via MCP")]
    FieldNotWritable(String),
    #[error("field '{0}' is not readable")]
    FieldNotReadable(String),
    #[error("validation error: {0}")]
    ValidationError(String),
    #[error("toml parse error: {0}")]
    ParseError(String),
    #[error("io error: {0}")]
    IoError(String),
    #[error("migration error: {0}")]
    MigrationError(String),
}
```

**`AppConfig` 完整定义** 见 [`README.md §4`](README.md) + `models/config.rs`。

## 2. ConfigStore 公开方法

```rust
impl ConfigStore {
    /// ⭐ 启动时调
    pub async fn load(app: &AppHandle) -> Result<Self, ConfigError>;

    /// 读全配置
    pub async fn get(&self) -> AppConfig;

    /// ⭐ MCP set_config 调——白名单 + schema 校验 + atomic write
    pub async fn write_allowlist(&self, patch: NewConfig) -> Result<AppConfig, ConfigError>;

    /// ⭐ 订阅 reload 事件（callback）
    pub fn on_reloaded(&self, cb: impl Fn(&AppConfig) + Send + Sync + 'static) -> UnlistenHandle;

    /// 手动 reload（notify watcher 内部也调）
    pub async fn reload(&self) -> Result<(), ConfigError>;

    /// 启动 notify watcher（lib.rs::run() setup block 调一次）
    pub fn start_watcher(&self);

    /// 读单个字段（路径语法："mcp.destructiveKeys.policy"）
    pub fn get_field(&self, path: &str) -> Option<serde_json::Value>;
}
```

## 3. 接缝契约

### 3.1 lib.rs::run() 启动入口

```rust
.setup(|app| {
    // ⭐ ConfigStore 加载（先于 MCP start，因为 MCP start 要读 config）
    let config_store = services::config::ConfigStore::load(app.handle())?;

    // ⭐ 启动 notify watcher（持续监听 config.toml 改动）
    config_store.start_watcher();

    app.manage(Arc::new(config_store));

    // ⭐ 启动 MCP server（依赖 config_store 读 mcp.enabled / http config）
    let mcp_handle = mcp_server::start(...).await?;
    app.manage(mcp_handle);

    Ok(())
})
```

### 3.2 MCP get_config / set_config

```rust
// mcp_server/tools/get_config.rs
pub async fn get_config(ctx: &McpContext, params: GetConfigParams) -> Result<...> {
    let config = ctx.config_store.get().await;

    if let Some(fields) = params.fields {
        // 字段白名单读取
        let filtered = whitelist::filter_readable(&config, &fields)?;
        Ok(CallToolResult::success(serde_json::to_value(filtered)?))
    } else {
        Ok(CallToolResult::success(serde_json::to_value(config)?))
    }
}

// mcp_server/tools/set_config.rs
pub async fn set_config(ctx: &McpContext, params: SetConfigParams) -> Result<...> {
    // 1. ⭐ 白名单校验
    whitelist::validate(&params.patch)?;

    // 2. ⭐ schema 校验
    let partial: PartialAppConfig = serde_json::from_value(params.patch)
        .map_err(|e| ConfigError::ValidationError(e.to_string()))?;

    // 3. merge + atomic write
    let new_config = ctx.config_store.write_allowlist(partial).await?;
    Ok(CallToolResult::success(serde_json::to_value(new_config)?))
}
```

### 3.3 commands/config::get_config

```rust
#[tauri::command]
pub async fn get_config(
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<AppConfig, String> {
    Ok(config_store.get().await)
}

#[tauri::command]
pub async fn set_config(
    patch: serde_json::Value,
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<AppConfig, String> {
    whitelist::validate(&patch)?;
    let partial: PartialAppConfig = serde_json::from_value(patch)
        .map_err(|e| e.to_string())?;
    config_store.write_allowlist(partial).await.map_err(|e| e.to_string())
}
```

## 4. 白名单

```rust
// services/config/whitelist.rs
pub static WRITABLE_FIELDS: &[&str] = &[
    "terminal.fontSize",
    "terminal.fontFamily",
    "terminal.scrollback",
    "terminal.copyOnSelect",
    "terminal.bracketedPasteDefault",
    "terminal.cursorBlink",
    "appearance.theme",
    "appearance.terminalTheme",
    "keybindings.*",
    "mcp.destructiveKeys.policy",
    "mcp.idleTimeout.seconds",
    "mcp.rateLimitRps",
    // 不可写：
    // - ssh.hostKeyVerify (安全关键)
    // - updater.channel (用户授权)
    // - logging.logLevel (需要 restart)
    // - profiles.* (单独 command)
];

pub static READABLE_FIELDS: &[&str] = &[
    // 全部可读，除了 ssh.privateKeyPath 等敏感字段
];

pub fn validate(patch: &serde_json::Value) -> Result<(), ConfigError>;
pub fn filter_readable(config: &AppConfig, fields: &[String]) -> Result<serde_json::Value, ConfigError>;
```

## 5. 错误码映射

| ConfigError | McpError / IPC 错误 |
|---|---|
| `FieldNotWritable(field)` | `FieldNotWritable` (-32008) |
| `FieldNotReadable(field)` | `FieldNotReadable` (-32019) |
| `ValidationError(msg)` | `ValidationError` (-32020) |
| `ParseError(msg)` | `Internal` (-32603) |
| `IoError(msg)` | `Internal` (-32603) |
| `MigrationError(msg)` | `Internal` (-32603) |

## 6. config-reloaded 事件

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigReloadedEvent {
    pub config: AppConfig,
    pub source: ConfigReloadedSource,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConfigReloadedSource {
    FileWatch,        // notify 监听触发
    ManualWrite,      // set_config 写入触发
    InitialLoad,      // 启动时加载
}
```

frontend UI 监听 `listen('config-reloaded', cb)` → 同步 settings store。

## 7. 不对外暴露

- `migration::from_store_json` 内部
- `watcher::start_watcher` 内部 Box::leak
- `apply_to_subsystems` 内部联动更新

## 8. 变更流程

1. **新增 AppConfig 字段** → models/config.rs + Default impl + 白名单更新（如可写）+ INTERFACE.md
2. **修改 write_allowlist 行为** → 同步 INTERFACE.md + 测试
3. **新增白名单字段** → whitelist.rs + INTERFACE.md §4

## 9. 性能

| 操作 | 预算 |
|---|---|
| `load()` (首次启动，无 migration) | < 100ms |
| `load()` (with migration) | < 500ms |
| `get()` | < 0.5ms (RwLock read) |
| `write_allowlist()` | < 50ms (validate + atomic write + reload notify) |
| `reload()` (from notify) | < 200ms (parse + validate + write + emit) |
| `start_watcher()` | < 5ms (spawn task) |

## 10. 文档

- [`README.md`](README.md) — 职责
- [`INTERFACE.md`](INTERFACE.md) — 本文档
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图
- [`../../../adr/0003-config-toml-migration.md`](../../../adr/0003-config-toml-migration.md) — RFC 决策