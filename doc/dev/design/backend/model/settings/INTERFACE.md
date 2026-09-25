# Model · Settings — 对外接口

> **位置**：`src-tauri/src/models/settings/`
> **唯一进口**：`use crate::models::settings::*;` 或精确 `use crate::models::settings::types::DisplayConfig;`

## 1. 对外暴露什么

settings domain 暴露 4 类符号:

1. **Types**——`SizingMode / DisplayConfig / EnvConfig / SavedSessionConfigV1 / SavedSessionConfigKind` + re-export `crate::logging_setup::LogConfig`
2. **Accessor functions**——纯查询 helper
3. **Rules functions**——纯变更 / 校验 helper
4. **Error types**——`SettingsError`(thiserror derive)

## 2. 核心接口

### 2.1 Types

```rust
use serde::{Deserialize, Serialize};

// ============ 运行时可调显示配置 ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SizingMode {
    Fit,
    Fixed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayConfig {
    pub font_family: String,
    pub font_size: u16,
    pub theme_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor_blink: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sizing_mode: Option<SizingMode>,
}

impl Default for DisplayConfig {
    fn default() -> Self {
        Self {
            font_family: "JetBrains Mono".to_string(),
            font_size: 14,
            theme_id: "dark".to_string(),
            cursor_blink: None,
            sizing_mode: None,
        }
    }
}

// ============ 环境变量 ============

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvConfig {
    #[serde(default)]
    pub vars: HashMap<String, String>,
}

// ============ 持久化 saved config(支持 schema migration)============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSessionConfigV1 {
    pub version: u32,                  // = 1
    pub id: String,                    // UUID
    pub name: String,
    pub kind: SavedSessionConfigKind,
    pub base_config_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,       // unix ms
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SavedSessionConfigKind {
    #[serde(rename = "local")]
    Local(LocalSessionConfig),

    #[serde(rename = "ssh")]
    Ssh(SSHSessionConfig),

    #[serde(rename = "tmux-cc")]
    TmuxCc(TmuxCcConfig),
}

// ============ LogConfig re-export ============

pub use crate::logging_setup::LogConfig;
// ↑ 当前 LogConfig 定义在 crate::logging_setup.rs(settings re-export)
```

### 2.2 Accessor functions

```rust
// models/settings/accessor.rs
use crate::models::settings::types::{DisplayConfig, EnvConfig, SavedSessionConfigV1};

/// 默认 DisplayConfig(常量)
pub fn default_display_config() -> DisplayConfig {
    DisplayConfig::default()
}

/// 合并用户 patch + 默认值(返回新对象)
pub fn merge_display_config(base: &DisplayConfig, patch: &DisplayConfig) -> DisplayConfig {
    DisplayConfig {
        font_family: if patch.font_family.is_empty() { base.font_family.clone() } else { patch.font_family.clone() },
        font_size: if patch.font_size == 0 { base.font_size } else { patch.font_size },
        theme_id: if patch.theme_id.is_empty() { base.theme_id.clone() } else { patch.theme_id.clone() },
        cursor_blink: patch.cursor_blink.or(base.cursor_blink),
        sizing_mode: patch.sizing_mode.clone().or_else(|| base.sizing_mode.clone()),
    }
}

/// 获取 effective log config(merged with defaults)
pub fn effective_log_config(saved: Option<&LogConfig>) -> LogConfig {
    saved.cloned().unwrap_or_else(default_log_config)
}

/// 默认 LogConfig
pub fn default_log_config() -> LogConfig {
    LogConfig {
        log_level: "info".to_string(),
        max_log_files: 5,
        max_file_size: 1024 * 1024,
    }
}
```

### 2.3 Rules functions(校验 + 不变更)

```rust
// models/settings/rules.rs

/// 校验 DisplayConfig 是否合法
pub fn validate_display_config(config: &DisplayConfig) -> Result<(), SettingsError> {
    if config.font_size == 0 || config.font_size > 100 {
        return Err(SettingsError::InvalidFontSize(config.font_size));
    }
    if config.font_family.is_empty() {
        return Err(SettingsError::EmptyFontFamily);
    }
    Ok(())
}

/// 校验 LogConfig(构造器 try_new 内部使用)
pub fn validate_log_config(config: &LogConfig) -> Result<(), SettingsError> {
    if config.log_level.is_empty() {
        return Err(SettingsError::EmptyLogLevel);
    }
    if config.max_log_files == 0 {
        return Err(SettingsError::ZeroMaxLogFiles);
    }
    if config.max_file_size == 0 {
        return Err(SettingsError::ZeroMaxFileSize);
    }
    Ok(())
}
```

### 2.4 Error types

```rust
// models/settings/errors.rs
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("log_level is empty")]
    EmptyLogLevel,

    #[error("max_log_files is zero")]
    ZeroMaxLogFiles,

    #[error("max_file_size is zero")]
    ZeroMaxFileSize,

    #[error("font_size {0} is invalid (must be 1-100)")]
    InvalidFontSize(u16),

    #[error("font_family is empty")]
    EmptyFontFamily,

    #[error("env var name '{0}' is invalid")]
    InvalidEnvVarName(String),

    #[error("saved session config version {0} is not supported")]
    UnsupportedSavedConfigVersion(u32),
}

// 在 models/settings/mod.rs 根级
impl From<SettingsError> for String {
    fn from(e: SettingsError) -> Self { e.to_string() }
}
```

## 3. 跨 domain 类型引用

settings types 引用以下其他 domain 的**纯类型字段**:

```rust
// models/settings/types.rs
use crate::models::session::types::{LocalSessionConfig, SSHSessionConfig};  // SavedSessionConfigKind 变体
use crate::models::tmux::types::TmuxCcConfig;                                // SavedSessionConfigKind 变体
```

**关键**:
- 引用**纯类型字段**是允许的(因为类型本身不含业务逻辑)
- settings 是**横切 domain**——其他 domain **不** import settings 的**函数 / trait**(只引用 DisplayConfig / EnvConfig 字段)

## 4. 接缝契约

```rust
// services/settings/api.rs
use crate::models::settings::{LogConfig, default_log_config, effective_log_config};

pub fn load_log_config(app: &AppHandle) -> Result<LogConfig, String> {
    let saved = persistence::load_json_value(app, "log_config.json", "config")?;
    Ok(effective_log_config(saved.as_ref().and_then(|v| serde_json::from_value(v.clone()).ok())))
}
```

```rust
// services/session/manager.rs
use crate::models::settings::EnvConfig;  // LocalSessionConfig.env_config 字段

impl SessionManager {
    pub fn create_local(
        &self,
        config: LocalSessionConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<SessionInfo, String> {
        // ...
    }
}
```

```rust
// app/settings/commands/logging/config.rs
use crate::models::settings::LogConfig;

#[tauri::command]
pub async fn set_log_config(
    config: LogConfig,                    // ← IPC 反序列化
    // ...
) -> Result<(), String> {
    // ...
}
```

**接缝约束**:
- service / app / infra 都 import `models/settings::*` 作为参数 / 返回类型
- 禁止 import `models/settings` 的**内部**(子模块文件)
- 禁止 `models/settings` import `services/*` 或 `app/*`

## 5. 不对外暴露

- `crate::logging_setup::LogConfig` 的内部字段(只能通过 accessor 间接读)
- `validate_*` 函数的内部校验逻辑
- saved config 的 `version` 字段迁移细节(预留 v2 migration 用)

## 6. api.rs 变更流程

1. **新增 DisplayConfig 字段** → 加 `types.rs::DisplayConfig` 字段 + §2.1 + frontend `model/settings/types.ts` 同步
2. **新增 SettingsError 变体** → 加 `errors.rs` 变体 + §2.4 + 检查所有 `?` 调用方
3. **新增 accessor function** → 加 `accessor.rs` 函数 + §2.2
4. **新增 rules function** → 加 `rules.rs` 函数 + §2.3
5. **修改 SavedSessionConfig schema**(v2) → 加 `SavedSessionConfigV2` + `migrate_v1_to_v2()` helper

## 7. 错误传播约定

- 模型层内部:返回 `Result<T, SettingsError>`(typed error)
- 模型层对外:`From<SettingsError> for String` 在 `models/settings/mod.rs` 根级实现
- service 层:`Result<T, String>`(现状);未来可统一为 typed error
- app 层:`Result<T, String>`(IPC 序列化)