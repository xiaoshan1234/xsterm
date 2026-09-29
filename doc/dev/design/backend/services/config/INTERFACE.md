# Services · Config — 对外接口

> **位置**：`src-tauri/src/services/config/mod.rs`
> **唯一入口**：`use crate::services::config::{ConfigStore, Settings, load, get, write}`
> **被使用方**：`commands/persistence::load_settings / save_settings / patch_settings` + `lib.rs::run()` (启动)

## 1. 公开类型

```rust
pub struct ConfigStore {
    inner: Arc<RwLock<Settings>>,
    store: Arc<tauri_plugin_store::Store>,
    app: AppHandle,
}

pub type UnlistenHandle = Box<dyn FnOnce() + Send>;

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("io error: {0}")]
    IoError(String),
    #[error("json parse error: {0}")]
    ParseError(String),
    #[error("validation error: {0}")]
    ValidationError(String),
}
```

**`Settings` 完整定义** 见 [`README.md §4`](README.md) + `models/config.rs`。

## 2. ConfigStore 公开方法

```rust
impl ConfigStore {
    /// ⭐ 启动时调
    pub async fn load(app: &AppHandle) -> Result<Self, ConfigError>;

    /// 读全配置
    pub async fn get(&self) -> Settings;

    /// ⭐ 直接写 settings（merge patch）
    pub async fn write(&self, patch: serde_json::Value) -> Result<Settings, ConfigError>;

    /// ⭐ 整 settings 替换
    pub async fn write_full(&self, settings: Settings) -> Result<Settings, ConfigError>;

    /// ⭐ 订阅 reload 事件（callback）
    pub fn on_reloaded(&self, cb: impl Fn(&Settings) + Send + Sync + 'static) -> UnlistenHandle;

    /// 手动 reload
    pub async fn reload(&self) -> Result<(), ConfigError>;
}
```

## 3. 接缝契约

### 3.1 lib.rs::run() 启动入口

```rust
.setup(|app| {
    // ⭐ ConfigStore 加载（启动第一件事）
    let config_store = services::config::ConfigStore::load(app.handle())?;
    app.manage(Arc::new(config_store));

    // ... 后续：SessionManager / OutputChannel / tunnel ...
})
```

`ConfigStore::load()` 内部：
1. 读 `%APPDATA%\xsterm\settings.json`
2. 缺文件 → `Settings::default()`
3. `apply_to_subsystems(&settings, &handles)` 联动更新
4. 注册 store change listener
5. emit `config-reloaded` 事件

### 3.2 commands/persistence 镜像

```rust
// commands/persistence.rs
const SETTINGS_STORE: &str = "settings.json";
const SETTINGS_KEY: &str = "settings";

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let store = app.store(SETTINGS_STORE).map_err_string()?;
    match store.get(SETTINGS_KEY) {
        Some(value) => {
            serde_json::from_value::<Settings>(value.clone()).map_err_string()
        }
        None => Ok(Settings::default()),
    }
}

#[tauri::command]
pub async fn save_settings(
    settings: Settings,
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<(), String> {
    config_store.write_full(settings).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn patch_settings(
    patch: serde_json::Value,
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<Settings, String> {
    config_store.write(patch).await.map_err(|e| e.to_string())
}
```

### 3.3 commands/mcp::mcp_status 镜像

```rust
#[tauri::command]
pub async fn mcp_status(
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<McpStatus, String> {
    let settings = config_store.get().await;
    let mcp = &settings.mcp;
    Ok(McpStatus {
        enabled: mcp.enabled,
        http_port: mcp.http_port,
        http_token_masked: mask_token(&mcp.http_token),
        http_enabled: mcp.http_enabled,
    })
}
```

### 3.4 frontend 调用

```typescript
// app/settings/usecases/load.ts
import { invoke } from "@/infra/tauri/api";
import type { Settings } from "@/model/settings/types";

const settings = await invoke<Settings>("load_settings");
useSettingsService().setMany(settings);

// app/settings/usecases/updateSetting.ts
const newSettings = await invoke<Settings>("patch_settings", {
    patch: { terminalFontSize: 16 }
});
useSettingsService().setMany(newSettings);

// app/mcp/server.ts 启动时读 MCP 配置
const status = await invoke<McpStatus>("mcp_status");
if (status.enabled && status.http_enabled) {
    startHttpServer({ port: status.http_port, token: ... });
}
```

## 4. 错误码映射

| ConfigError | IPC 错误字符串 |
|---|---|
| `IoError(msg)` | "io error: X" |
| `ParseError(msg)` | "json parse error: X" |
| `ValidationError(msg)` | "validation error: X" |

## 5. config-reloaded 事件

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigReloadedEvent {
    pub config: Settings,
    pub source: ConfigReloadedSource,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConfigReloadedSource {
    InitialLoad,
    ManualWrite,
    FrontendReload,
}
```

frontend UI 监听 `listen('config-reloaded', cb)` → 同步 settings store。

## 6. 不对外暴露

- `apply_to_subsystems` 内部联动
- `store change listener` 内部 handle
- `Settings::default()` 实现（在 `models/config.rs`）

## 7. 变更流程

1. **新增 Settings 字段** → models/config.rs 加 `#[serde(default)]` + README.md §4 + INTERFACE.md §2 同步
2. **修改 write 行为** → INTERFACE.md §2 同步 + 测试
3. **修改联动逻辑** → apply_to_subsystems + README.md §7

## 8. 性能

| 操作 | 预算 |
|---|---|
| `load()` (首次启动, 缺文件 → default) | < 50ms |
| `load()` (有 settings.json) | < 100ms (parse + apply_to_subsystems) |
| `get()` | < 0.5ms (RwLock read) |
| `write(patch)` | < 30ms (merge + write + apply_to_subsystems) |
| `write_full(settings)` | < 30ms |
| `reload()` | < 100ms |

## 9. 文档

- [`README.md`](README.md) — 职责
- [`INTERFACE.md`](INTERFACE.md) — 本文档
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图
- [`../../../adr/0003-revised-config-json.md`](../../../adr/0003-revised-config-json.md) — RFC 决策