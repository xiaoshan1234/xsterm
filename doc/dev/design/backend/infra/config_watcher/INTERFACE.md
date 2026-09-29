# Module · Infra Config Watcher — 对外接口

> **位置**：`src-tauri/src/infrastructure/config_watcher/`
> **唯一进口**：`use crate::infrastructure::config_watcher::*;`

## 1. 对外暴露什么

config_watcher 暴露 **6 类符号**：

1. **`AppConfig` struct** —— config.toml 的 typed 表示（serde + schemars derive）
2. **`load_and_validate()`** —— 启动期读 + schema 校验；违反 schema 返回 `Err(SchemaError)`
3. **`write_config()`** —— atomic write（tmp 文件 + rename）
4. **`start_watcher()` / `stop_watcher()`** —— notify 后台 task
5. **`emit_reload_event()`** —— backend 主动 reload 后 emit Tauri `config-reloaded` 事件
6. **`migrate_from_store_json()`** —— RFC 0003 迁移脚本

外部 module 通过 `infrastructure::config_watcher::*` 调这些公开函数。

## 2. 核心接口

### 2.1 AppConfig struct

```rust
use serde::{Deserialize, Serialize};
use schemars::JsonSchema;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]  // 严格 schema
pub struct AppConfig {
    pub keybindings: KeybindingsConfig,
    pub default_shell: String,           // 例: "pwsh.exe"
    pub font_size: u16,                  // 例: 14
    pub theme: ThemeConfig,
    pub log: LogConfig,
    pub sidebar: SidebarConfig,
    pub terminal_preferences: TerminalPreferencesConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct KeybindingsConfig {
    pub new_tab: String,                  // 例: "Ctrl+T"
    pub close_tab: String,                // 例: "Ctrl+W"
    pub next_tab: String,                 // 例: "Ctrl+Tab"
    pub previous_tab: String,             // 例: "Ctrl+Shift+Tab"
    pub split_horizontal: String,         // 例: "Ctrl+Shift+D"
    pub split_vertical: String,           // 例: "Ctrl+Shift+E"
    pub close_pane: String,               // 例: "Ctrl+Shift+W"
    pub copy: String,                     // 例: "Ctrl+Shift+C"
    pub paste: String,                    // 例: "Ctrl+Shift+V"
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct ThemeConfig {
    pub name: String,                     // 例: "cursor-dark"
    pub background: String,               // 例: "#1a1a1a"
    pub foreground: String,               // 例: "#e8e6e0"
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct LogConfig {
    pub level: String,                    // 例: "INFO"
    pub max_log_files: u32,                // 例: 10
    pub max_file_size: u64,                // 例: 10485760 (10 MB)
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SidebarConfig {
    pub visible: bool,                    // 例: true
    pub position: String,                 // 例: "left" | "right"
    pub width: u16,                       // 例: 240
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct TerminalPreferencesConfig {
    pub scrollback_lines: u32,            // 例: 10000
    pub cursor_blink: bool,               // 例: true
    pub font_family: String,              // 例: "Cascadia Code"
}
```

### 2.2 load_and_validate()

```rust
/// 启动期读 + schema 校验。违反 schema → 返回具体错误，lib.rs::run 拒绝启动
/// PRD §6 G4: "故意写错配置 → 应用拒绝启动并提示具体错误"
pub fn load_and_validate(app: &AppHandle) -> Result<AppConfig, ConfigError>;

/// 错误包含 schema 校验位置（line / column）+ 期望类型 + 实际类型
/// 例: SchemaError { line: 5, column: 12, field: "fontSize", expected: "u16", found: "string" }
```

**关键**：
- 启动期 `commands/shell/api.rs::initialize` 第一步调
- schema 校验失败 → `Result::Err` → `lib.rs::run` 弹出错误对话框 + 退出
- **不**降级到"用默认值"——PRD §6 G4 明确要求拒绝启动

### 2.3 write_config()

```rust
/// atomic write config.toml
pub fn write_config(config: &AppConfig) -> Result<(), ConfigError>;

/// atomic write with partial update (UI 增量改 config)
pub fn write_config_partial(
    current: &AppConfig,
    partial: PartialAppConfig,
) -> Result<AppConfig, ConfigError>;
// ↑ merge partial into current → schema check → atomic write → 返回新 AppConfig

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PartialAppConfig {
    pub keybindings: Option<KeybindingsConfig>,
    pub default_shell: Option<String>,
    pub font_size: Option<u16>,
    pub theme: Option<ThemeConfig>,
    pub log: Option<LogConfig>,
    pub sidebar: Option<SidebarConfig>,
    pub terminal_preferences: Option<TerminalPreferencesConfig>,
}
```

### 2.4 start_watcher / stop_watcher

```rust
/// 启动 notify 后台 task 监听 config.toml
/// - 文件改动 → debounce 200ms → 重新 load + validate
/// - 成功 → emit `config-reloaded` Tauri 事件
/// - 失败 → tracing::warn! + 保留旧 config（不 reload）
pub fn start_watcher(app: AppHandle) -> Result<RecommendedWatcher, ConfigError>;

/// 停止 watcher（关闭 app 时调，或高级用户禁用）
pub fn stop_watcher(watcher: RecommendedWatcher);
```

### 2.5 emit_reload_event

```rust
/// 后台 task reload 成功后调用
pub fn emit_reload_event(app: &AppHandle, config: &AppConfig);

/// 事件 payload
#[derive(Serialize, Clone)]
pub struct ConfigReloadedEvent {
    pub config: AppConfig,
    pub timestamp_ms: u64,
    pub source: ReloadSource,   // Auto (watch trigger) | Manual (write_config trigger)
}

pub enum ReloadSource { Auto, Manual }
```

**frontend 监听**：
```typescript
import { listen } from "@tauri-apps/api/event";

listen<ConfigReloadedEvent>("config-reloaded", (event) => {
  configStore.setState(event.payload.config);
  logger.debug(`config reloaded from ${event.payload.source}`);
});
```

### 2.6 migrate_from_store_json

```rust
/// RFC 0003 迁移: 旧版 store.json → 新 config.toml
/// 仅在启动期检测到旧 store.json 且 config.toml 不存在时调
pub fn migrate_from_store_json(app: &AppHandle) -> Result<AppConfig, ConfigError>;

/// 迁移产物:
/// 1. store.json → store.json.<timestamp>.bak (30 天保留)
/// 2. 字段映射写入 config.toml
/// 3. 写迁移日志到 logs/config-migration.log (diff 报告)
```

## 3. IPC 契约（commands/shell/commands/config.rs）

```rust
#[tauri::command]
pub async fn read_config(
    state: State<'_, Arc<RwLock<AppConfig>>>,
) -> Result<AppConfig, String>;
// ↑ frontend UI 初始化 / 重启时调 — 返回当前 config

#[tauri::command]
pub async fn write_config(
    partial: PartialAppConfig,
    state: State<'_, Arc<RwLock<AppConfig>>>,
    app: AppHandle,
) -> Result<AppConfig, String>;
// ↑ frontend UI 改 settings 调 — merge + validate + atomic write + emit reload
// ↑ 返回新 AppConfig（frontend 拿到返回值也能更新 store）

#[tauri::command]
pub async fn watch_config_start(
    state: State<'_, Arc<Mutex<Option<RecommendedWatcher>>>>,
    app: AppHandle,
) -> Result<(), String>;
// ↑ MVP 默认启动；UI 提供"暂停 watch"按钮（高级用户）

#[tauri::command]
pub async fn watch_config_stop(
    state: State<'_, Arc<Mutex<Option<RecommendedWatcher>>>>,
) -> Result<(), String>;
```

**frontend 对应**：
```typescript
// service/persistence/config.ts
export const configApi = {
  read: () => invoke<AppConfig>("read_config"),
  write: (partial: PartialAppConfig) => invoke<AppConfig>("write_config", { partial }),
  watchStart: () => invoke("watch_config_start"),
  watchStop: () => invoke("watch_config_stop"),
};
```

## 4. 类型

### 4.1 ConfigError enum

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("config file not found: {0}")]
    NotFound(PathBuf),
    
    #[error("config parse failed: {0}")]
    Parse(toml::de::Error),
    
    #[error("schema validation failed: line {line}, column {column}, field '{field}': expected {expected}, found {found}")]
    SchemaValidation {
        line: usize,
        column: usize,
        field: String,
        expected: String,
        found: String,
    },
    
    #[error("atomic write failed: {0}")]
    Write(io::Error),
    
    #[error("watcher failed: {0}")]
    Watch(notify::Error),
    
    #[error("migration failed: {0}")]
    Migration(String),
}
```

### 4.2 AppConfig schema derive

由 `schemars::JsonSchema` derive 自动生成，**frontend 不持有此类型**——frontend 通过 IPC payload 拿到 typed 对象。

### 4.3 PartialAppConfig schema derive

同上，**字段全部 `Option<T>`**，用于 UI 增量更新（只改部分字段不影响其他字段）。

## 5. 接缝契约

```rust
// src-tauri/src/lib.rs::run()
fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 1. ⭐ 启动期 config 加载 + schema 校验（schema 失败拒绝启动）
            let config = infra::config_watcher::load::load_and_validate(&app.handle())?;
            // ↑ Err(SchemaValidation { ... }) → 拒绝启动 + 错误对话框
            
            // 2. 注册 AppConfig state
            app.manage(Arc::new(RwLock::new(config)));
            
            // 3. 启动 notify watcher（emit config-reloaded 给 frontend）
            let watcher = infra::config_watcher::watch::start_watcher(app.handle())?;
            app.manage(Mutex::new(Some(watcher)));
            
            // 4. RFC 0003 迁移（如果旧 store.json 存在）
            if let Ok(_) = infra::config_watcher::migration::detect_legacy_store(app.handle()) {
                let migrated = infra::config_watcher::migration::migrate_from_store_json(app.handle())?;
                *app.state::<Arc<RwLock<AppConfig>>>().write().await = migrated.clone();
                let _ = infra::config_watcher::emit::emit_reload_event(app.handle(), &migrated);
            }
            
            // 5. 其他启动步骤（log_config / RealAppBackend / MCP server 启动由 frontend app/shell 编排）
            commands::shell::api::initialize(app.handle())?;
            
            Ok(())
        })
        .invoke_handler(commands::mod::all_handlers())
        .run(tauri::generate_context!())
}
```

## 6. 不对外暴露

- `notify::RecommendedWatcher` 内部状态——只通过 `start_watcher` / `stop_watcher` 公开函数
- `toml::Value` 中间表示——只内部用
- 文件 IO 细节（POSIX rename、文件锁等）——封装在 `write.rs` / `load.rs`
- schema derive 生成的 JSON Schema 内部结构——只通过 `generate_schema()` 函数返回

## 7. api 变更流程

1. **新增 AppConfig 字段** → 加字段到 struct（serde + schemars derive）+ 更新 `Default` impl + 测试 + schema.json 自动更新
2. **修改字段类型** → ⚠️ breaking——用户 config.toml 拒绝启动 + 提示迁移路径（迁移脚本或用户手改）
3. **新增 IPC** → 加 `commands/shell/commands/config.rs::new_command` + `INTERFACE.md §3` 同步 + frontend 对应 API
4. **修改 IPC payload** → ⚠️ breaking——frontend + backend 同步更新
5. **修改 watcher 行为**（如 debounce 改 500ms）→ 更新 §9.4 + 测试

## 8. 错误传播约定

- infra → commands：`Result<T, String>`（AppHandle error 简化）
- commands → IPC wire：`Result<T, String>`（Tauri 默认 wire 格式）
- 启动期错误（schema 失败）→ `Result::Err` 直接抛 `lib.rs::run` → 错误对话框
- watch reload 失败 → `tracing::warn!` + **不**emit reload（保留旧 config + frontend 状态）
