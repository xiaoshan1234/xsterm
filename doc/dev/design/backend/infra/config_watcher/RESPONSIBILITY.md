# Module · Infra Config Watcher — 职责

> **位置**：`src-tauri/src/infrastructure/config_watcher/`
> **类型**：⭐ 物理适配层新子模块（PRD §2 M9 + §3 数据 + §7 启动流程 + §6 G4 验收 + RFC 0003）
> **被使用方**：`commands/shell`（启动期注入 config + 启动 watcher + emit `config-reloaded`）、`commands/shell`（新增 `read_config` / `write_config` / `watch_config_start` / `watch_config_stop` IPC）
> **Frontend 对应**：[`../../../frontend/service/persistence/RESPONSIBILITY.md §3 改写后`](../../../frontend/service/persistence/RESPONSIBILITY.md)（前端不直存 settings.json；所有 settings 走 backend config.toml）；[`frontend/app/settings/`](../../../frontend/app/settings/)（UI 改 settings 调 `invoke('write_config')`）

> **架构依据**：本子模块**全部归 backend infra** —— PRD §2 M9 的三个核心特性（TOML 文件 + notify watch + schema 校验）的实现**全部需要 fs / notify crate / schema derive from Rust types**，这些 frontend 没有。详见 audit 报告 "config.toml + watch + schema 方案能 frontend 实现吗" 的逐项拆解。

## 1. 这个子模块负责什么

config_watcher 子模块承担 **PRD §2 M9 完整方案**——让 xsterm 像 Vim/Neovim 一样是"可配置的工具"：

1. **配置文件** —— `%APPDATA%\xsterm\config.toml`（TOML 格式，人类可读 + 注释友好；高级用户可用 VS Code 手编）
2. **schema.json 生成 + 校验** —— 启动时从 Rust `AppConfig` struct（`schemars` crate 自动派生）生成 `%APPDATA%\xsterm\xsterm-schema.json`；用户 VS Code 关联后智能提示；启动期 read + schema 校验，**违反 schema 拒绝启动**（PRD §6 G4）
3. **watch notify 自动 reload** —— `notify` crate 监听 `config.toml` 文件改动 → debounce 200ms → 重新 read + schema check → emit Tauri 事件 `config-reloaded` 给 frontend
4. **RFC 0003 迁移** —— 启动时如果检测到旧版 store.json，按字段映射迁移到 config.toml（带 diff 报告 + 30 天 .bak 回退 + 迁移日志）

## 2. 这个子模块 **不**负责什么

- **不存其他 backend-only 状态**——attached_tmux 归 `infra/tauri::RealAppBackend` 路径（`domain/terminal/attached_tmux`）；log_config 归 `commands/shell/log_config`
- **不渲染 UI**——settings UI 归 frontend `ui/settings/`；本模块只 emit Tauri 事件给 frontend
- **不调 frontend 任何代码**——通过 Tauri event bus `config-reloaded` 单向通知
- **不做迁移脚本的元数据持久化**——迁移日志写到 `%APPDATA%\xsterm\logs\config-migration.log`（复用 logging_setup 体系），不是新 store

## 3. 子结构

```rust
src-tauri/src/infrastructure/config_watcher/
├── mod.rs                  re-export 6 文件
├── config.rs               ⭐ AppConfig struct (serde + schemars derive) — 单 source of truth
├── path.rs                 config.toml / xsterm-schema.json 的 %APPDATA% 路径解析
├── load.rs                 启动期 read + schema check + 拒绝启动 (PRD §6 G4)
├── write.rs                atomic write (写到 tmp 文件 + rename 防止半截写)
├── schema.rs               从 AppConfig 生成 JSON Schema (schemars)
├── watch.rs                notify Watcher + debounce + 重新 read + emit `config-reloaded`
├── migration.rs            RFC 0003: store.json → config.toml 字段映射 + .bak 回退 + 迁移日志
└── errors.rs               ConfigError (thiserror derive,含 schema 校验具体错误位置)
```

## 4. 跟 frontend infra 的关系

| 项 | backend `infra/config_watcher` | frontend `service/persistence` |
|---|---|---|
| settings.json 直存 | ❌ 砍 | ❌ **砍**——frontend 不再直存 settings |
| TOML 直读直写 | ✅ backend 主路径 | ❌ |
| schema.json 生成 | ✅ backend 启动期写 | ❌ |
| schema.json 消费 | ❌（VS Code 自己读） | ❌ |
| write_config IPC | ✅ backend 接收 + schema check + atomic write | ❌ |
| write_config 触发 | frontend UI 表单调 `invoke('write_config', { partial })` | ✅ UI 触发 |
| config-reloaded 事件 emit | ✅ backend watch loop emit | ❌ |
| config-reloaded 事件订阅 | ❌ | ✅ frontend `service/persistence` 订阅 → 重新 read backend → 本地 store 同步 |

**关键边界**：settings **唯一 source of truth 是 backend config.toml**；frontend store 是 mirror，由 `config-reloaded` 事件保持同步。

## 5. 跟其他 backend infra 子模块的关系

| 子模块 | 关系 |
|---|---|
| `infra/tauri` | 通过 `Arc<dyn AppBackend>::emit("config-reloaded", ...)` 推送事件；不依赖具体 tauri runtime |
| `infra/pty` / `ssh` / `tmux` | 平级；infra/config_watcher 不调它们 |
| `crate::logging_setup` | 迁移日志走 `tracing`；reload 错误日志走 `tracing::warn!` |

**关键约束**：
- `infra/config_watcher` **是 backend 唯一允许直接 import `notify` + `schemars` + `toml` + `serde_json` 的地方**
- service 层通过 `infra/config_watcher/api`（`read_config` / `write_config` 等公开函数）间接调用

## 6. 跟 commands / domain 的关系

| module | 怎么用 infra/config_watcher |
|---|---|
| `commands/shell/api.rs::initialize` | 启动期：调 `infra::config_watcher::load::load_and_validate()` → 注入 `AppConfig` 到 `Arc<AppConfig>` state → 启动 `watch` 后台 task |
| `commands/shell/commands/config.rs` | `read_config` / `write_config` / `watch_config_start` / `watch_config_stop` IPC handler 调对应 `infra::config_watcher::*` 函数 |
| `domain/session` / `domain/terminal` | 启动期通过 `Arc<AppConfig>` 读取字段；不直接 import infra/config_watcher（保持 domain 纯粹） |
| `commands/session/commands/log_config.rs` | **不归本模块**——log_config 是 backend runtime tracing 配置，跟用户 config.toml 是**两个独立配置源**。详见 §8 |

## 7. 用户故事（backend / frontend / 终端用户三视角）

### 7.1 终端用户视角
- **新装 xsterm**: 首次启动写默认 `config.toml` + `xsterm-schema.json` 到 `%APPDATA%\xsterm\`，用户可在 VS Code 打开手编
- **改键位**: 在 settings 抽屉改 `Ctrl+T` → 保存 → **不重启 app，下一次按键立刻响应**（watch + emit reload）
- **写错字段**: `fontSize = "abc"` → xsterm 启动时报错"schema validation failed: fontSize must be u16, found string at line 5"
- **CI / 自动化**: 测试用 schema 校验 config fixture

### 7.2 frontend 视角
- UI 改 settings → 调 `invoke('write_config', { partial: { keybindings: { ... } } })` → backend merge + validate + write → emit reload → 监听 reload 事件 → 重新 `read_config` → 本地 store 更新
- frontend store **永远不**直写 `settings.json`（之前 v4 直存路径**已砍**）

### 7.3 backend 视角
- 启动：`load_and_validate()` → schema check → 通过则 inject + 启动 watcher；不通过则 return `Err(SchemaError)` 给 lib.rs::run 拒绝启动
- watcher 后台 task：监听文件 → debounce 200ms → 重新 load + validate → emit `config-reloaded` Tauri 事件

## 8. 这个子模块的"产品语言"术语

- **config.toml** —— TOML 格式配置文件，路径 `%APPDATA%\xsterm\config.toml`
- **xsterm-schema.json** —— JSON Schema 文件（从 Rust AppConfig 派生），路径 `%APPDATA%\xsterm\xsterm-schema.json`，供 VS Code 关联
- **AppConfig** —— Rust struct，serde + schemars derive；config.toml 的 typed 表示
- **PartialAppConfig** —— `AppConfig` 的部分更新类型（用于 UI 增量改 config）
- **watcher** —— `notify::RecommendedWatcher` 实例，监听单个文件
- **debounce** —— 文件多次连续修改只触发一次 reload（200ms 窗口）
- **atomic write** —— 写到 `config.toml.tmp` 然后 `rename` 到 `config.toml`（POSIX rename 原子性），防止读到半截写
- **schema 校验** —— 用 `schemars` 生成的 schema 校验反序列化结果（不只在反序列化时校验 schema，还显式 validate）
- **config-reloaded 事件** —— Tauri event payload `{ config: AppConfig, timestamp_ms: u64 }`，frontend 监听
- **migration log** —— RFC 0003 迁移过程日志，写到 `%APPDATA%\xsterm\logs\config-migration.log`

## 9. 关键设计约束

### 9.1 AppConfig 是单一 source of truth

```rust
use serde::{Deserialize, Serialize};
use schemars::JsonSchema;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]  // 严格拒绝 schema 外的字段
pub struct AppConfig {
    pub keybindings: KeybindingsConfig,
    pub default_shell: String,
    pub font_size: u16,
    pub theme: ThemeConfig,
    pub log: LogConfig,
    pub sidebar: SidebarConfig,
    pub terminal_preferences: TerminalPreferencesConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct KeybindingsConfig {
    pub new_tab: String,            // 例: "Ctrl+T"
    pub close_tab: String,          // 例: "Ctrl+W"
    pub next_tab: String,           // 例: "Ctrl+Tab"
    pub split_horizontal: String,   // 例: "Ctrl+Shift+D"
    pub split_vertical: String,     // 例: "Ctrl+Shift+E"
    // ...
}
```

**关键**：所有字段必须有 `#[schemars]` derive；backend 自动生成 schema.json；frontend 不持有类型，不漂移。

### 9.2 启动期拒绝错配置

```rust
// commands/shell/api.rs::initialize
pub fn initialize(app: &mut tauri::App) -> Result<(), String> {
    let config = infra::config_watcher::load::load_and_validate(&app.handle())?;
    // ↑ schema 校验失败 → 返回 Err(SchemaError { line: 5, column: 12, message: "..." })
    //    lib.rs::run 收到 Err → 拒绝启动 → 弹出错误对话框（PRD §6 G4）
    
    app.manage(Arc::new(RwLock::new(config)));
    
    let watcher = infra::config_watcher::watch::start_watcher(app.handle(), config_path())?;
    app.manage(watcher);
    
    Ok(())
}
```

### 9.3 atomic write 防止半截读

```rust
// infra/config_watcher/write.rs
pub fn write_config(config: &AppConfig) -> Result<(), ConfigError> {
    let target = config_path();
    let tmp = target.with_extension("toml.tmp");
    
    let toml_str = toml::to_string_pretty(config)?;
    std::fs::write(&tmp, toml_str)?;       // 写到 .tmp
    std::fs::rename(&tmp, &target)?;       // POSIX rename 原子性
    
    Ok(())
}
```

### 9.4 watch + debounce + emit reload

```rust
// infra/config_watcher/watch.rs
pub fn start_watcher(app: AppHandle, path: PathBuf) -> Result<RecommendedWatcher, ConfigError> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    
    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, _>| {
        if let Ok(event) = res {
            if event.kind.is_modify() || event.kind.is_create() {
                let _ = tx.blocking_send(());
            }
        }
    })?;
    
    watcher.watch(&path, notify::RecursiveMode::NonRecursive)?;
    
    // debounce + reload 后台 task
    tokio::spawn(async move {
        let mut last_reload = Instant::now();
        while rx.recv().await.is_some() {
            // 200ms debounce
            tokio::time::sleep(Duration::from_millis(200)).await;
            
            match load_and_validate(&app) {
                Ok(new_config) => {
                    *app.state::<Arc<RwLock<AppConfig>>>().write().await = new_config.clone();
                    let _ = app.emit("config-reloaded", new_config);
                }
                Err(e) => {
                    tracing::warn!("config reload failed: {e}");
                    // 不 emit reload——保留旧 config + frontend 状态
                }
            }
        }
    });
    
    Ok(watcher)
}
```

## 10. 占位与未来工作

- **schema 文档** —— MVP 用 `schemars` 自动生成 schema.json；未来可加手维护的 `xsterm-config.example.toml`（带注释说明每个字段）
- **schema 版本迁移** —— AppConfig 加 `#[serde(rename = "v2")]` 字段时，旧 config.toml 拒绝启动 + 提示手动迁移路径
- **多文件拆分** —— MVP 单 config.toml；未来可拆 `keybindings.toml` / `theme.toml` / `terminal.toml`（多 watch task）
- **CRDT 配置同步** —— 当前单进程；未来多窗口 / 远端同步需 CRDT（out of scope）
- **notify 替代方案** —— MVP 用 `notify` crate；未来如跨平台问题可换 `tauri-plugin-fs`（但那要求 webview 直接 fs，sandbox 风险）

## 11. 文档地图

- 顶层（本文）：PRD §2 M9 完整方案的 backend 实现
- `INTERFACE.md`：API + IPC 契约
- `DOWNSTREAM.md`：依赖图 + 强制约束
- PRD §2 M9 + §3 数据 + §6 G4 + §7 启动流程 + §5 R12 RFC 0003
- frontend 对应：service/persistence RESPONSIBILITY §3 改写后（已砍 settings.json 直存）+ app/settings 设计
