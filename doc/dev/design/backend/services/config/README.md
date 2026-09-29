# Services · Config — 职责

> **位置**：`src-tauri/src/services/config/`
> **类型**：⭐ 配置存储 + 跨子系统联动更新
> **决策**：RFC 0003-revised —— 保留 `tauri-plugin-store` JSON 格式（**不**迁移 toml）

## 1. 一句话架构

**config = 1 个 `ConfigStore` (包装 tauri-plugin-store) + 联动更新 callback**

```
src-tauri/src/services/config/
├── mod.rs              公开 API（ConfigStore + load / get / set / on_reloaded）
├── store.rs            Arc<RwLock<Settings>> + apply_to_subsystems 联动
└── defaults.rs         Settings::default() 默认值
```

**删除**（RFC 0003-revised）：
- ❌ `migration.rs`（30 天 .bak 迁移不需要）
- ❌ `watcher.rs`（notify 监听 toml 不需要）
- ❌ `whitelist.rs`（JSON 直存不需要白名单）
- ❌ `loader.rs` 中 toml 相关

## 2. 职责

config service 处理应用设置的持久化 + 跨子系统联动：

1. **持久化** — 启动时从 `%APPDATA%\xsterm\store.json` 读 + 写
2. **schema 兼容** — 每个字段 `#[serde(default)]`，新增字段向前兼容
3. **联动更新** — Settings 变化时同步更新 attach idle_timeout / log level / ssh host_key_verify 等
4. **事件广播** — `config-reloaded` 事件给 frontend 订阅（store 自身 reactive + backend emit 兼容）

## 3. 不承担

- ❌ toml 格式（RFC 0003-revised 删除）
- ❌ migration / 30 天 .bak（无格式变化）
- ❌ 白名单写入（JSON 直存不需要——frontend UI 是受信的）
- ❌ 第三方 schema 校验（zod / valibot 在 frontend 承担）
- ❌ sessions / groups / attached_tmux 持久化（归 `commands/persistence.rs` 现有逻辑，独立 key）

## 4. Settings schema

```rust
// models/config.rs
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    // ============ general ============
    pub theme: String,                       // "dark" | "light" | "auto"
    pub default_profile: Option<String>,
    pub product_name: String,                // "xsterm"

    // ============ terminal ============
    pub terminal_font_family: String,
    pub terminal_font_size: u16,
    pub terminal_scrollback: u32,
    pub terminal_copy_on_select: bool,
    pub terminal_bracketed_paste_default: bool,
    pub terminal_cursor_blink: bool,

    // ============ appearance ============
    pub appearance_theme: String,             // 5 个 ANSI preset
    pub appearance_terminal_theme: String,   // 5 个 ANSI preset

    // ============ sidebar ============
    pub sidebar_width: u16,
    pub show_sidebar: bool,

    // ============ keybindings（用户可覆盖）============
    pub keybindings: HashMap<String, String>,  // "newTab" -> "Ctrl+T"

    // ============ MCP ============
    pub mcp: McpSettings,

    // ============ SSH ============
    pub ssh: SshSettings,

    // ============ tunnel (M8) ============
    pub tunnel: TunnelSettings,

    // ============ logging ============
    pub log_level: String,                    // "info" | "debug" | "warn"
    pub max_file_size: u64,
    pub max_log_files: u32,

    // ============ updater ============
    pub updater_channel: String,              // "github" | "store" | "disabled"
    pub updater_auto_check: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct McpSettings {
    pub enabled: bool,
    pub http_enabled: bool,
    pub http_port: u16,
    pub http_token: Option<String>,
    pub destructive_keys_policy: String,
    pub idle_timeout_seconds: u64,
    pub rate_limit_rps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SshSettings {
    pub host_key_verify: String,              // "ask" | "no" | "yes"
    pub keepalive_interval_secs: u32,
    pub connect_timeout_secs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TunnelSettings {
    pub enabled: bool,
    pub ssh_host: String,
    pub ssh_user: String,
    pub ssh_port: u16,
    pub local_mcp_port: u16,
    pub remote_port: u16,
    pub allowed_remote_users: Vec<String>,
}
```

**关键**：
- 每个字段 `#[serde(default)]` —— 新增字段向前兼容
- `#[serde(default)]` 在 struct 级别 + 字段级别双层保护
- **不**用 `deny_unknown_fields`（前端可能加新字段，backend 不报错）
- **不**派生 JsonSchema（schema 校验在 frontend）

## 5. 公开 API

```rust
// services/config/mod.rs
pub struct ConfigStore {
    inner: Arc<RwLock<Settings>>,
    store: Arc<tauri_plugin_store::Store>,    // ⭐ 包装 tauri-plugin-store
    app: AppHandle,
}

impl ConfigStore {
    /// 启动时调：load + apply_to_subsystems
    pub async fn load(app: &AppHandle) -> Result<Self, ConfigError>;

    /// 读全配置
    pub async fn get(&self) -> Settings;

    /// ⭐ 直接写 settings（无需白名单，JSON 直存）
    pub async fn write(&self, patch: SettingsPatch) -> Result<Settings, ConfigError>;

    /// ⭐ 订阅 reload 事件
    pub fn on_reloaded(&self, cb: impl Fn(&Settings) + Send + Sync + 'static) -> UnlistenHandle;

    /// 手动 reload
    pub async fn reload(&self) -> Result<(), ConfigError>;
}
```

## 6. 跟其他 service 的关系

| service | 关系 |
|---|---|
| `services/attach` | 接收 `mcp.idle_timeout_seconds` 联动更新 |
| `services/logging_setup` | 接收 `log_level` / `max_file_size` 联动更新 |
| `services/ssh_session` | 接收 `ssh.host_key_verify` 变化（需要 reconnect） |
| `services/reverse_tunnel` | 接收 `tunnel.enabled` 启停 |
| `commands/persistence` | 独立 key（不共享 store.json 的 `settings` key） |
| `commands/mcp::mcp_status` | 读 `mcp.enabled` / `mcp.http_*` |
| `commands/tunnel::*` | 读 `tunnel.*` 字段 |

## 7. 联动更新

```rust
// services/config/store.rs
async fn apply_to_subsystems(
    new_settings: &Settings,
    handles: &SubsystemHandles,
) -> Result<(), ConfigError> {
    // 1. attach idle_timeout
    handles.attach_registry.set_idle_timeout(new_settings.mcp.idle_timeout_seconds);

    // 2. log level
    handles.logging.reload_filter(&new_settings.log_level)?;

    // 3. ssh host_key_verify（如果改了，需要 reconnect）
    if handles.ssh_config.host_key_verify != new_settings.ssh.host_key_verify {
        handles.ssh_backend.notify_config_change(&new_settings.ssh).await?;
    }

    // 4. tunnel enable/disable
    if new_settings.tunnel.enabled && !handles.tunnel.is_running() {
        handles.tunnel.start().await?;
    } else if !new_settings.tunnel.enabled && handles.tunnel.is_running() {
        handles.tunnel.stop().await?;
    }

    Ok(())
}
```

**触发时机**：
- 启动时（`ConfigStore::load()` 末尾）
- 写 settings 时（`ConfigStore::write()` 末尾）
- frontend 主动 reload 时（`ConfigStore::reload()` 末尾）

**不监听文件**：RFC 0003-revised 删除 notify 监听——frontend 是唯一写入入口，无外部文件修改场景。

## 8. IPC 契约

### 8.1 `commands/persistence.rs` 扩展

```rust
// commands/persistence.rs
const SETTINGS_STORE: &str = "settings.json";
const SETTINGS_KEY: &str = "settings";

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let store = app.store(SETTINGS_STORE).map_err_string()?;
    match store.get(SETTINGS_KEY) {
        Some(value) => {
            let settings: Settings = serde_json::from_value(value.clone()).map_err_string()?;
            Ok(settings)
        }
        None => Ok(Settings::default()),  // ⭐ 缺 settings.json 用 default
    }
}

#[tauri::command]
pub async fn save_settings(
    settings: Settings,
    app: AppHandle,
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<(), String> {
    config_store.write_full(settings).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn patch_settings(
    patch: serde_json::Value,
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<Settings, String> {
    let new_settings = config_store.write(patch).await.map_err(|e| e.to_string())?;
    Ok(new_settings)
}
```

**关键**：
- 存储 key 单独 `settings.json`（不是合并到 `store.json`）—— 避免影响 sessions / groups 等其他 key
- `load_settings` 缺文件时返回 `Settings::default()` —— 首次启动无报错
- `patch_settings` 支持部分更新（merge patch）

### 8.2 frontend 调用

```typescript
// app/settings/usecases/load.ts
import { invoke } from "@/infra/tauri/api";
const settings = await invoke<Settings>("load_settings");
useSettingsService().setMany(settings);

// app/settings/usecases/updateSetting.ts
const newSettings = await invoke<Settings>("patch_settings", {
    patch: { terminalFontSize: 16 }
});
useSettingsService().setMany(newSettings);
```

**注意**：frontend `service/persistence` 不再走 `config` 子模块（RFC 0003-revised 删除），直接用 IPC。

## 9. config-reloaded 事件

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

## 10. 迁移路径（RFC 0003-revised 简化）

```
xsterm.exe 启动
    ↓
ConfigStore::load()
    ↓
1. 读 %APPDATA%\xsterm\settings.json
   ├── 存在 → serde_json::from_value → Settings
   └── 不存在 → Settings::default()（首次启动）
    ↓
2. apply_to_subsystems(&settings, &handles)
   - attach idle_timeout / log level / ssh host_key_verify / tunnel enable
    ↓
3. return ConfigStore
```

**无 migration**（无格式变化，从 JSON 到 JSON）。
**无 30 天 .bak**（不适用）。
**无 notify 监听**（frontend 是唯一写入入口）。

## 11. 测试

```rust
#[tokio::test]
async fn load_defaults_when_settings_json_missing() {
    let temp = tempfile::tempdir().unwrap();
    let store = ConfigStore::load_from(temp.path()).await.unwrap();
    let settings = store.get().await;
    assert_eq!(settings.theme, "dark");  // default
    assert_eq!(settings.terminal_font_size, 14);  // default
}

#[tokio::test]
async fn patch_settings_partial_update() {
    let store = ConfigStore::load_from(tempdir().path()).await.unwrap();
    let new_settings = store.write(json!({ "terminalFontSize": 16 })).await.unwrap();
    assert_eq!(new_settings.terminal_font_size, 16);
    assert_eq!(new_settings.theme, "dark");  // 不变
}

#[tokio::test]
async fn forward_compat_new_fields_use_default() {
    // 模拟老 store.json 缺新字段
    let old_json = r#"{"theme": "light"}"#;  // 只有 theme
    let settings: Settings = serde_json::from_str(old_json).unwrap();
    assert_eq!(settings.terminal_font_size, 14);  // default
}
```

## 12. 强约束（pre-commit 必跑）

```bash
# ❌ 不再有 toml 依赖
grep -rn 'toml::' src-tauri/src/services/config/
# 必须为空

# ❌ 不再有 notify 依赖
grep -rn 'notify::' src-tauri/src/services/config/
# 必须为空

# ❌ 不再有 schema migration
grep -rn 'migration::from_' src-tauri/src/services/config/
# 必须为空

# ❌ 不再有白名单
grep -rn 'whitelist\|WRITABLE_FIELDS' src-tauri/src/services/config/
# 必须为空

# Settings 字段必须有 default
grep -rnE 'pub\s+\w+:' src-tauri/src/models/config.rs | grep -v 'serde(default'
# 必须为空（每个字段都有 #[serde(default)]）
```

## 13. 文档

- [`README.md`](README.md) — 本文档
- [`INTERFACE.md`](INTERFACE.md) — `ConfigStore` / `Settings` 公开 API
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图
- [`../../../adr/0003-revised-config-json.md`](../../../adr/0003-revised-config-json.md) — 决策 RFC

## 14. 验收

- `Settings` 每个字段都有 `#[serde(default)]` ✅
- `load_settings` 缺文件返回 default（无报错）✅
- `patch_settings` 支持部分 merge ✅
- 联动更新子系统（attach / log / ssh / tunnel）正确 ✅
- Cargo build time -5%（少了 4 个 crate）✅
- frontend `service/persistence` 不再走 `config` 子模块 ✅