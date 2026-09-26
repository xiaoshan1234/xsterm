# Commands · Shell — Log Runtime

> **位置**：`src-tauri/src/commands/shell/`（log 相关子模块）
> **职责**：log_config runtime + ReloadHandle 管理 + 4 个 log IPC command
> **归属说明**：log_config 是 backend 启动序列的一部分，**属于 shell runtime**——v6 从原 `commands/shell/log_config.rs` 合并进来

## 1. 这个子模块负责什么

shell log 子模块持有 **backend logging runtime**——ReloadHandle 是 tracing subscriber 重载句柄，shell 启动时创建、修改 log config 时 reload。

**承担 3 类职责**：

1. **LogConfig 持久化** —— 读 / 写 `log_config.json`（typed wrapper）
2. **ReloadHandle 管理** —— 启动时创建 ReloadHandle + 注入 app state；set_log_config 时 reload
3. **Log IPC commands** —— `log_message` / `get_log_config` / `set_log_config` / `get_log_dir` 共 4 个

**明确不做**：

- attached_tmux.json（归 `domain/terminal::attached_tmux`）
- saved sessions.json / groups.json（frontend 直存）

## 2. 为什么 log_config runtime 归 commands/shell 而不归独立 persistence domain

| 原因 | 说明 |
|---|---|
| **ReloadHandle 是 tracing runtime 句柄** | 由 `crate::logging_setup::init_logging()` 创建——是 backend 启动序列的一部分 |
| **shell.initialize() 触发读 log_config** | 启动时读 log_config → 创建 ReloadHandle → 注册 app state —— 完整启动序列 |
| **没有跨 domain 业务** | log config 不被 session / terminal / persistence 任何其他 domain 读取 |
| **generic JSON IO 不必要** | log_config 只有一家用——不需要抽象 |
| **frontend 直存 vs backend reload 语义不同** | log_config 改完要 reload `tracing` subscriber——frontend 没法 reload；attached_tmux 是 backend 进程级状态——frontend 也管不了 |

## 3. 子模块结构

```rust
// commands/shell/log_config.rs（v6 新增，从 commands/shell/log_config.rs 合并过来）
use tracing_subscriber::reload::{Handle, EnvFilter, Registry};
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogConfig {
    pub log_level: String,            // "DEBUG" / "INFO" / "WARN" / "ERROR"
    pub max_log_files: u32,
    pub max_file_size: u64,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            log_level: "INFO".to_string(),
            max_log_files: 10,
            max_file_size: 10 * 1024 * 1024,  // 10 MB
        }
    }
}

/// 启动时调：读 log_config.json + 创建 ReloadHandle
pub fn load_log_config(app: &AppHandle) -> Result<LogConfig, String>;

/// IPC `set_log_config` 调：写 store + reload filter
pub fn set_log_config(
    app: &AppHandle,
    state: &Arc<LogConfigState>,
    config: &LogConfig,
) -> Result<(), String>;

/// IPC `get_log_config` 调
pub fn get_log_config(app: &AppHandle) -> Result<LogConfig, String>;

/// IPC `get_log_dir` 调
pub fn get_log_dir(app: &AppHandle) -> Result<PathBuf, String>;

// Generic JSON IO helper（只在本文件内）
fn save_json_value(app: &AppHandle, file: &str, key: &str, value: &serde_json::Value) -> Result<(), String>;
fn load_json_value(app: &AppHandle, file: &str, key: &str) -> Result<Option<serde_json::Value>, String>;

pub const LOG_CONFIG_FILE: &str = "log_config.json";
pub const LOG_CONFIG_KEY: &str = "config";

pub struct LogConfigState {
    reload_handle: Mutex<Handle<EnvFilter, Registry>>,
}

impl LogConfigState {
    pub fn new(reload_handle: Handle<EnvFilter, Registry>) -> Self;
    pub fn reload_filter(&self, filter: EnvFilter) -> Result<(), String>;
}
```

**关键**：

- `commands/shell/api.rs::initialize()` 内部调 `load_log_config` + 创建 ReloadHandle + 注入 `Arc<LogConfigState>`
- 4 个 IPC command 直接调本子模块函数
- 直接 import `tauri_plugin_store::StoreExt` —— shell 现在是 backend 中**唯一**允许直接 import tauri-plugin-store 的 commands module（除了 terminal）

## 4. 跟其他 domain 的关系

| domain / module | 关系 |
|---|---|
| `domain/session` | session 通过 `session.log.rs::start_session_logging` 间接使用 tracing —— 不读 log_config |
| `domain/terminal` | terminal 通过 `bridge.rs::emit` 间接使用 tracing —— 不读 log_config |
| `infra/tauri::tauri-plugin-store` | shell 直接 import（**唯一**允许这么做的 commands module —— 因为 log_config 是 backend runtime 一部分） |
| `crate::logging_setup` | shell `initialize()` 内部调 `init_logging(log_dir, &config)` 创建 ReloadHandle |

## 5. 跟 commands 的关系

| commands module | 怎么用 shell log 子模块 |
|---|---|
| `commands/shell/api.rs::initialize` | 启动时调 `log_config::load_log_config` + 创建 ReloadHandle + 注册 `Arc<LogConfigState>` |
| `commands/shell/commands/logging/message.rs::log_message` | 直接 emit Tauri event 给 frontend listener |
| `commands/shell/commands/logging/config.rs::get_log_config` | 调 `log_config::get_log_config` |
| `commands/shell/commands/logging/config.rs::set_log_config` | 调 `log_config::set_log_config`（写 + reload） |
| `commands/shell/commands/logging/config.rs::get_log_dir` | 调 `log_config::get_log_dir` |

## 6. 这个子模块的"产品语言"术语

- **LogConfig** —— `{ log_level, max_log_files, max_file_size }`
- **ReloadHandle** —— `tracing_subscriber::reload::Handle<EnvFilter, Registry>`，让 `set_log_config` 实时改 filter
- **rolling writer** —— `crate::logging_setup` 创建的 rotating file writer（zstd-compressed log files）
- **log directory** —— `app.path().app_log_dir()` 解析的绝对路径
- **store file / store key** —— log_config.json / `"config"`

## 7. 关键设计约束

### 7.1 shell.initialize() 启动序列

```rust
// commands/shell/api.rs
pub fn initialize(app: &mut App) -> Result<(), String> {
    // 1. 解析 log 目录
    let log_dir = app.handle().path().app_log_dir()
        .map_err(|e| e.to_string())?;
    
    // 2. 读 log_config.json
    let config = log_config::load_log_config(app.handle())?;
    
    // 3. 创建 ReloadHandle（委托给 crate::logging_setup）
    let reload_handle = crate::logging_setup::init_logging(&log_dir, &config)
        .map_err(|e| e.to_string())?;
    
    // 4. 注册 ReloadHandle 到 app state
    app.manage(Arc::new(LogConfigState::new(reload_handle)));
    
    // 5. 注册 RealAppBackend
    let backend = infra::tauri::RealAppBackend::new(app.handle().clone());
    app.manage(Arc::new(backend));
    
    // 6. emit session-output-channel
    // ...
    
    Ok(())
}
```

**关键**：

- shell.initialize() 是启动序列入口——所有 ReloadHandle / AppBackend 注册都从这里发起
- 启动时按顺序：解析 log_dir → 读 log_config → 创建 ReloadHandle → 注册 state

### 7.2 set_log_config 写 + reload 原子操作

```rust
// commands/shell/commands/logging/config.rs
#[tauri::command]
pub async fn set_log_config(
    config: LogConfig,
    app: AppHandle,
    state: State<'_, Arc<LogConfigState>>,
) -> Result<(), String> {
    log_config::set_log_config(app.inner(), state.inner(), &config)
}
```

```rust
// commands/shell/log_config.rs
pub fn set_log_config(
    app: &AppHandle,
    state: &Arc<LogConfigState>,
    config: &LogConfig,
) -> Result<(), String> {
    // 1. 写 log_config.json
    let value = serde_json::to_value(config).map_err(|e| e.to_string())?;
    save_json_value(app, LOG_CONFIG_FILE, LOG_CONFIG_KEY, &value)?;
    
    // 2. 重新加载 EnvFilter
    state.reload_filter(EnvFilter::new(&config.log_level))?;
    
    Ok(())
}
```

**关键**：写 store + reload filter **不是原子**——但 ReloadHandle 是 backend 内部状态，崩溃重启时 ReloadHandle 重新创建，所以**不需要事务**。

### 7.3 log_message 不读 log_config

```rust
// commands/shell/commands/logging/message.rs
#[tauri::command]
pub fn log_message(level: String, message: String, app: AppHandle) -> Result<(), String> {
    // 直接 emit Tauri event 给 frontend listener
    // 不读 log_config（filter 由 EnvFilter 全局应用）
    let payload = LogMessage { level, message };
    app.emit("log-message", payload).map_err(|e| e.to_string())?;
    Ok(())
}
```

**关键**：frontend 的 `log_message` 是**前端 UI 显示用**——backend 不写自己的 log file（backend log file 由 tracing subscriber 自动写）。这两个职责**完全分离**。

### 7.4 store key 字面量集中在 log_config.rs 内部

```rust
// commands/shell/log_config.rs
pub const LOG_CONFIG_FILE: &str = "log_config.json";
pub const LOG_CONFIG_KEY: &str = "config";
```

**关键**：文件路径 + store key 字面量集中在 log_config.rs 的 const——避免散落。

## 8. 错误处理

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LogConfigError {
    #[error("invalid log level: {0}")]
    InvalidLogLevel(String),
    #[error("invalid max_file_size: {0}")]
    InvalidMaxFileSize(u64),
    #[error("reload handle poisoned")]
    ReloadHandlePoisoned,
    #[error("log_config.json io error: {0}")]
    Io(#[from] std::io::Error),
}
```

## 9. 测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_config_default_values() {
        let cfg = LogConfig::default();
        assert_eq!(cfg.log_level, "INFO");
        assert_eq!(cfg.max_log_files, 10);
    }

    #[test]
    fn load_missing_file_returns_default() {
        let app = mock_app_handle_fresh();
        let cfg = load_log_config(&app).unwrap();
        assert_eq!(cfg, LogConfig::default());
    }

    #[test]
    fn set_then_get_roundtrip() {
        let app = mock_app_handle();
        let state = Arc::new(LogConfigState::new(mock_reload_handle()));
        let new_cfg = LogConfig { log_level: "DEBUG".to_string(), ..Default::default() };
        set_log_config(&app, &state, &new_cfg).unwrap();
        let loaded = get_log_config(&app).unwrap();
        assert_eq!(loaded.log_level, "DEBUG");
    }
}
```

## 10. MVP 范围之外（未来扩展）

| 功能 | 触发条件 |
|---|---|
| 实时 log message 转发到 OS notification | 需要 OS 通知集成时 |
| log 远程上传（前端 UI 可看 backend log） | 调试场景需要远程看 log |
| log 加密存储 | 敏感 log 信息（auth token 等） |
| log sampling（trace 模式下只采样 1% log） | 高并发性能瓶颈时 |

## 11. 跟 frontend service 的职责分叉

| 维度 | frontend service/settings (logging) | backend commands/shell/log_config |
|---|---|---|
| 类型定义 | TS interface | Rust struct |
| 状态机 | zustand store（frontend 持镜像） | `Arc<LogConfigState>`（backend 持 ReloadHandle） |
| 持久化 | **frontend 不直写 log_config.json**（v4 改：统一通道） | backend `infra::tauri::tauri-plugin-store` 直存 log_config.json |
| 修改后行为 | frontend 调 `invoke('set_log_config', config)` → backend 写 store + reload `tracing` subscriber | backend 写 store + reload（被 frontend 触发） |
| 字段源 | `SettingsTab` UI 编辑 | `commands/shell::initialize()` 启动时读 |

**关键（v4 改）**：frontend 和 backend **不**共享 `log_config.json` 写入路径——frontend **不**直写，统一通过 IPC 触发。

- frontend 改 settings.logConfig → 调 `invoke('set_log_config')` → backend 写 store + reload
- frontend 启动时读 `get_log_config` 显示当前值
- backend 启动时读 log_config.json 初始化 ReloadHandle（不写回——启动顺序保证一致性）

**禁止**：
- ❌ frontend `service/persistence` 直写 `log_config.json`（只有 backend `infra::tauri` 能写）
- ❌ backend ReloadHandle 创建时 sync 写回 store（启动顺序保证一致性，无需事务）