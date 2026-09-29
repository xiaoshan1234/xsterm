# Services · Config — 职责

> **位置**：`src-tauri/src/services/config/`
> **类型**：⭐ toml 配置加载 + notify 热更新 + migration（RFC 0003）
> **状态**：MVP P0-5（PRD §2 M9）

## 1. 一句话架构

**config = 1 个 `ConfigStore` (Arc<RwLock<AppConfig>>) + toml 加载 + notify 监听 + migration**

```
src-tauri/src/services/config/
├── mod.rs              公开 API（ConfigStore + load / write / on_reloaded）
├── store.rs            Arc<RwLock<AppConfig>> + write_allowlist / get_allowlist
├── loader.rs           toml::from_str + serde validation
├── watcher.rs          notify 热更新监听 + debounce 1s
├── migration.rs        从 store.json 迁移到 toml（30 天 .bak 回退）
├── schema.rs           AppConfig 完整定义（serde + schemars）
├── whitelist.rs        set_config MCP 工具白名单字段
└── tests.rs            migration roundtrip + notify 事件
```

## 2. 职责

config service 是 **PRD §2 M9 配置系统的底层真相源**：

1. **toml 加载** — 启动时从 `%APPDATA%\xsterm\config.toml` 读
2. **migration** — 旧 store.json 一次性迁移 + 30 天 .bak 回退
3. **热更新** — notify 监听 config.toml 改动，1s debounce 后 reload
4. **白名单写入** — `set_config` MCP 工具只能改白名单字段
5. **事件广播** — config-reloaded 事件给 frontend 订阅
6. **配子模块 hot reload** — config 变化时联动更新 attach idle_timeout / log level / ssh host_key_verify 等

## 3. 不承担

- ❌ sessions / groups / attached_tmux 持久化（归 `commands/persistence.rs` 现有逻辑，config.toml [profiles.*] 是另一回事）
- ❌ log 配置（独立 `commands/logging.rs`，独立 log_config.json 过渡期）
- ❌ 前端直存 store（config 改走 backend IPC）

## 4. AppConfig schema

```rust
// services/config/schema.rs
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppConfig {
    pub version: u32,                // schema version
    #[serde(default)]
    pub general: GeneralConfig,
    #[serde(default)]
    pub terminal: TerminalConfig,
    #[serde(default)]
    pub appearance: AppearanceConfig,
    #[serde(default)]
    pub keybindings: KeybindingsConfig,
    #[serde(default)]
    pub profiles: ProfilesConfig,    // profile_name → SessionConfig
    #[serde(default)]
    pub mcp: McpConfig,
    #[serde(default)]
    pub ssh: SshConfig,
    #[serde(default)]
    pub tunnel: TunnelConfig,        // ⭐ M8
    #[serde(default)]
    pub updater: UpdaterConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GeneralConfig {
    pub theme: Theme,                        // "dark" | "light" | "auto"
    pub default_profile: String,             // "pwsh"
    pub product_name: String,                // "xsterm"
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TerminalConfig {
    pub font_family: String,                 // "Cascadia Code"
    pub font_size: u16,                      // 14
    pub scrollback: u32,                     // 10000
    pub copy_on_select: bool,
    pub bracketed_paste_default: bool,
    pub cursor_blink: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceConfig {
    pub theme: String,                       // 5 个 ANSI preset
    pub terminal_theme: String,              // 5 个 ANSI preset
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingsConfig {
    // 用户可覆盖所有快捷键
    pub new_tab: String,                     // "Ctrl+T"
    pub close_tab: String,                   // "Ctrl+W"
    pub split_horizontal: String,            // "Ctrl+Shift+D"
    pub split_vertical: String,              // "Ctrl+Shift+E"
    pub switch_tab: String,                  // "Ctrl+Tab"
    pub goto_tab: String,                    // "Ctrl+1..9"
    // ... 见完整列表
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesConfig {
    pub entries: HashMap<String, SessionConfig>,  // profile_name → config
    pub default: Option<String>,                  // 默认 profile
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    pub enabled: bool,
    pub stdio: bool,                            // 默认 true
    pub http: McpHttpConfig,
    pub destructive_keys: DestructiveKeysConfig,
    pub idle_timeout: IdleTimeoutConfig,
    pub audit: AuditConfig,
    pub rate_limit_rps: u32,                    // 默认 100
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct McpHttpConfig {
    pub enabled: bool,                          // 默认 false
    pub host: String,                           // "127.0.0.1"
    pub port: u16,                              // 19847
    pub token: Option<String>,                  // 自动生成
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub host_key_verify: HostKeyVerify,         // "ask" | "no" | "yes"
    pub known_hosts_path: PathBuf,
    pub keepalive_interval_secs: u32,
    pub connect_timeout_secs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TunnelConfig {
    pub enabled: bool,
    pub ssh_host: String,
    pub ssh_user: String,
    pub ssh_port: u16,
    pub ssh_auth: SshAuthConfig,
    pub local_mcp_port: u16,                    // 19847（本地 MCP HTTP）
    pub remote_port: u16,                       // 远端暴露端口
    pub allowed_remote_users: Vec<String>,      // 白名单
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterConfig {
    pub channel: UpdateChannel,                 // "store" | "github" | "disabled"
    pub auto_check: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoggingConfig {
    pub log_level: String,                      // "info" | "debug" | "warn"
    pub max_file_size: u64,
    pub max_log_files: u32,
}

// ... 各 enum 省略
```

## 5. 公开 API

```rust
// services/config/mod.rs
pub struct ConfigStore {
    inner: Arc<RwLock<AppConfig>>,
    config_path: PathBuf,
    app: AppHandle,
}

impl ConfigStore {
    /// ⭐ 启动时调：load + migration + notify listener
    pub async fn load(app: &AppHandle) -> Result<Self, ConfigError>;

    /// 读全配置
    pub async fn get(&self) -> AppConfig;

    /// 读单个字段
    pub async fn get_field<K>(&self, key_path: K) -> Option<serde_json::Value>;

    /// ⭐ 白名单写入（MCP set_config 调）
    pub async fn write_allowlist(&self, patch: NewConfig) -> Result<AppConfig, ConfigError>;

    /// ⭐ 订阅 reload 事件
    pub fn on_reloaded(&self, cb: impl Fn(&AppConfig) + Send + Sync + 'static) -> UnlistenHandle;

    /// 触发 reload（notify watcher 调用 / config.toml 改动后）
    pub async fn reload(&self) -> Result<(), ConfigError>;

    /// 启动 notify 监听（tokio task 持续跑）
    pub fn start_watcher(&self);
}
```

## 6. migration 路径（RFC 0003）

```
xsterm.exe 启动
    ↓
ConfigStore::load()
    ↓
1. 检查 config.toml 是否存在
    ├── 是 → 直接 parse + return
    └── 否 ↓
2. 检查 store.json (sessions/groups/attached_tmux/log_config) 是否存在
    ├── 是 → migration::from_store_json()
    │         ↓
    │        a. 读所有 *.json
    │        b. 合并 + 字段映射
    │        c. 写到 config.toml
    │        d. 重命名 *.json → *.json.bak
    │        e. schedule_delete(.bak, 30 days)
    └── 否 → 首次启动 → 写默认 config.toml
3. return ConfigStore
```

**回滚路径**：30 天内用户删 `config.toml` → 重启时检测 `.bak` → 自动恢复 + 提示。

## 7. 热更新（notify）

```rust
// services/config/watcher.rs
use notify::{Watcher, RecursiveMode, EventKind};
use notify_debouncer_full::{new_debouncer, DebounceEventResult};

pub fn start_watcher(store: Arc<ConfigStore>) {
    let path = store.config_path.clone();
    let store_clone = store.clone();

    let mut debouncer = new_debouncer(Duration::from_secs(1), None, move |result: DebounceEventResult| {
        match result {
            Ok(events) if events.iter().any(|e| matches!(e.kind, EventKind::Modify(_))) => {
                tracing::info!("config.toml modified, reloading");
                if let Err(e) = tokio::spawn({
                    let store = store_clone.clone();
                    async move { store.reload().await }
                }).await {
                    tracing::error!("config reload failed: {e}");
                }
            }
            Ok(_) => {},  // 忽略其他事件
            Err(e) => tracing::error!("notify error: {e}"),
        }
    }).unwrap();

    debouncer.watcher().watch(&path, RecursiveMode::NonRecursive).unwrap();

    // ⭐ keep debouncer alive（用 Leak 或全局 static）
    Box::leak(Box::new(debouncer));
}
```

**注意**：debouncer 必须常驻——`Box::leak` 模式与 `logging_setup.rs` 的 `mem::forget(_guard)` 风格一致（AGENTS.md 提到）。

## 8. 白名单写入

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
    // - profiles.* (复杂度高，单独 command)
];

pub fn is_writable(field_path: &str) -> bool {
    WRITABLE_FIELDS.iter().any(|p| {
        if p.ends_with(".*") {
            field_path.starts_with(&p[..p.len() - 2])
        } else {
            field_path == *p
        }
    })
}
```

## 9. config-reloaded 事件

```rust
// services/config/store.rs
pub async fn reload(&self) -> Result<(), ConfigError> {
    let new_config = loader::load_from_disk(&self.config_path)?;
    
    // 1. 写回 store
    *self.inner.write().await = new_config.clone();

    // 2. ⭐ emit config-reloaded 事件
    self.app.emit("config-reloaded", ConfigReloadedEvent {
        config: new_config.clone(),
        source: ConfigReloadedSource::FileWatch,
    })?;

    // 3. ⭐ 联动更新各子系统
    apply_to_subsystems(&new_config, &self.subsystem_handles).await?;

    Ok(())
}

async fn apply_to_subsystems(
    config: &AppConfig,
    handles: &SubsystemHandles,
) -> Result<(), ConfigError> {
    // attach idle_timeout
    handles.attach_registry.set_idle_timeout(config.mcp.idle_timeout.seconds);

    // log level
    handles.logging.reload_filter(&config.logging.log_level)?;

    // ssh host_key_verify（如果改了，需要 reconnect）
    if handles.ssh_config.host_key_verify != config.ssh.host_key_verify {
        handles.ssh_backend.notify_config_change(&config.ssh).await?;
    }

    // tunnel enable/disable
    if config.tunnel.enabled && !handles.tunnel.is_running() {
        handles.tunnel.start().await?;
    } else if !config.tunnel.enabled && handles.tunnel.is_running() {
        handles.tunnel.stop().await?;
    }

    Ok(())
}
```

## 10. IPC 契约（commands/config.rs）

```rust
#[tauri::command]
pub async fn get_config(config_store: State<'_, Arc<ConfigStore>>) -> Result<AppConfig, String> {
    Ok(config_store.get().await)
}

#[tauri::command]
pub async fn set_config(
    patch: serde_json::Value,
    config_store: State<'_, Arc<ConfigStore>>,
) -> Result<AppConfig, String> {
    // 1. ⭐ 白名单校验
    validate_allowlist(&patch)?;

    // 2. ⭐ schema 校验
    let partial: PartialAppConfig = serde_json::from_value(patch)
        .map_err(|e| ConfigError::ValidationError(e.to_string()))?;

    // 3. merge + 写盘
    config_store.write_allowlist(partial)
        .map_err(|e| e.to_string())
}
```

## 11. 跟其他 service 的关系

| service | 关系 |
|---|---|
| `services/attach` | 接收 `idle_timeout` 更新 |
| `services/logging_setup` | 接收 `log_level` 更新 |
| `services/ssh_session` | 接收 `host_key_verify` 变化（需要 reconnect） |
| `services/reverse_tunnel` | 接收 `tunnel.enabled` 启停 |
| `services/subscribe` | 不感知 config 变化 |
| `services/capture` | 不感知 config 变化 |
| `mcp_server::tools::get_config / set_config` | 调 `config_store.get_allowlist / write_allowlist` |
| `commands/config` | 调 `config_store` |

## 12. 测试

```rust
#[tokio::test]
async fn migration_from_store_json() {
    let temp = tempfile::tempdir().unwrap();
    let store_json = temp.path().join("sessions.json");
    let config_toml = temp.path().join("config.toml");

    // 准备 store.json
    std::fs::write(&store_json, r#"{"sessions":[{"id":42,"name":"test"}]}"#).unwrap();

    let config = ConfigStore::load_from(temp.path()).await.unwrap();
    assert!(config_toml.exists());
    let bak = store_json.with_extension("json.bak");
    assert!(bak.exists());

    let new_config = config.get().await;
    assert_eq!(new_config.profiles.entries.len(), 1);
}

#[tokio::test]
async fn write_allowlist_rejects_ssh_host_key_verify() {
    let store = ConfigStore::load_from(tempdir().path()).await.unwrap();
    let patch = json!({ "ssh": { "hostKeyVerify": "no" } });
    let result = store.write_allowlist(patch).await;
    assert!(matches!(result, Err(ConfigError::FieldNotWritable(_))));
}
```

## 13. 强约束

```bash
# config 写入必须经过 whitelist
grep -rn 'config_store\.write\|config\.write' src-tauri/src/ --include='*.rs' | grep -v 'whitelist\|tests\|//'
# 必须只出现在 services/config/whitelist.rs / commands/config.rs / mcp_server/tools/set_config.rs

# config schema 校验必须经过 loader
grep -rn 'toml::from_str\|serde_json::from_value' src-tauri/src/services/config/ --include='*.rs'
# 必须只出现在 loader.rs / store.rs (白名单后)

# migration 是 idempotent
grep -rn 'migration::from_store_json' src-tauri/src/ --include='*.rs'
# 必须只出现在 services/config/store.rs::load

# notify watcher 不允许 duplicate spawn
grep -rn 'start_watcher' src-tauri/src/ --include='*.rs'
# 必须只出现在 lib.rs::run() 的 setup block
```

## 14. 文档

- [`README.md`](README.md) — 本文档
- [`INTERFACE.md`](INTERFACE.md) — ConfigStore / AppConfig 公开 API
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图
- RFC 0003 — toml 迁移决策