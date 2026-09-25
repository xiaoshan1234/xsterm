# Service · Settings — 职责

> **位置**：`src-tauri/src/services/settings/`
> **类型**：⭐ 横切 domain（应用配置 + log 配置，被所有 domain 用）
> **被调用方**：`app/shell`、`app/settings`、`app/terminal`、`app/session`（间接通过 app/settings）
> **Frontend 对应**：[`../../../../frontend/service/settings/RESPONSIBILITY.md`](../../../../frontend/service/settings/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么

settings domain 持有 **backend 侧的应用配置**——MVP 主要是 log 配置（其他 settings 字段在 frontend store）。

承担 4 类职责：

1. **LogConfig 数据结构**——`{ log_level: String, max_log_files: u32, max_file_size: u64 }`
2. **LogConfig 持久化**——读 / 写 `log_config.json`
3. **EnvFilter reload handle 管理**——`Arc<Mutex<reload::Handle<EnvFilter, Registry>>>`，让 `set_log_config` 实时改 filter
4. **应用启动时的 log 初始化**——启动 rolling writer + 清理旧 log

**MVP 范围**：backend 的 settings domain 只管 log_config。其他 settings 字段（theme / font / sidebar / defaultShell 等）只在前端 store + persistence。

**未来扩展**：如果 backend 加 "settings 全字段持久化"（如：default shell 跨平台迁移），settings domain 扩展到 LogConfig + 通用 settings。

## 2. 这个 domain **不**负责什么

- **不持有 settings 全字段** —— 只管 log_config；其他字段在前端
- **不渲染 UI** —— backend 无 UI
- **不存 session / workspace / group** —— 各自归自己的 domain
- **不调 tauri-plugin-store 直接** —— 持久化归 `services/persistence/`；但 log_config.json 是 settings 唯一直接写的 store
- **不实现 log writer** —— rolling writer 由 `crate::logging_setup` 提供

## 3. 子结构

```
services/settings/
├── api.rs            ⭐ 唯一对外入口
│                      - pub fn load_log_config(&AppHandle) -> Result<LogConfig, String>
│                      - pub fn save_log_config(&AppHandle, &LogConfig) -> Result<(), String>
│                      - pub fn init_logging_reload_handle(&LogConfig) -> ReloadHandle
│                      - pub fn apply_log_config(ReloadHandle, &LogConfig) -> Result<(), String>
├── mod.rs            re-export api.rs
├── log_config.rs     LogConfig struct + 默认值
├── reload.rs         ⭐ EnvFilter reload handle 包装
└── *.test.rs         （如有）defaults / reload 时机单测
```

## 4. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `services/persistence` | settings **直接**调 `persistence::load_json_value(&app, "log_config.json")` 读配置；**直接**调 `persistence::save_json_value(&app, "log_config.json", &value)` 写配置。这是 settings 唯一允许的 infra 直接调用 |
| `services/session` | settings **不依赖** session（session 创建时不读 default shell 等 settings；MVP 由前端传 default 值）|
| `services/tmux` | settings **不依赖** tmux |
| `services/workspace` | settings **不依赖** workspace |
| `crate::logging_setup` | settings **直接**调 `init_logging(&log_dir, &config)` 创建 rolling writer；`cleanup_old_logs(&log_dir, max_bytes)` 清理旧 log |

**关键约束**：

- settings 是 backend 中**唯一**允许直接调 `crate::logging_setup` 的 service（启动时一次性使用）
- settings 是 backend 中**唯一**允许直接调 `tauri_plugin_store`（持久化 log_config.json）的 domain——但未来应该把 IO 也下沉到 `services/persistence/`
- settings 不依赖任何其他 service domain

## 5. 跟 app 的关系

| app module | 怎么用 services/settings |
|---|---|
| `app/shell` | `app/shell/api.rs::initialize` 调 `settings_api::load_log_config(&app)` 读配置 → `settings_api::init_logging_reload_handle(&config)` 创建 handle → `app.manage(handle)` |
| `app/settings` | `app/settings/commands/logging/config.rs::set_log_config` 调 `settings_api::save_log_config` + `settings_api::apply_log_config(reload_handle, &config)` |
| `app/session` | session **不直接**调 settings——default shell 等由前端从 `useSettingsStore` 读后传给 backend |
| `app/terminal` | terminal **不直接**调 settings |

## 6. 这个 domain 的"产品语言"术语

- **LogConfig** —— log 配置：`{ log_level, max_log_files, max_file_size }`
- **log_level** —— `tracing_subscriber::EnvFilter` 的过滤字符串（如 `"info,xsterm_lib=debug"`）
- **max_log_files** —— 保留的最大 log 文件数
- **max_file_size** —— 单个 log 文件最大字节数（触发 rolling）
- **reload handle** —— `Arc<Mutex<reload::Handle<EnvFilter, Registry>>>`，动态改变 filter
- **rolling writer** —— `tracing_appender::rolling::daily` 或 `RollingFileAppender`
- **app log dir** —— `app.path().app_log_dir()` 解析的目录

## 7. 关键设计约束

### 7.1 reload handle 由 settings 创建，由 State 注入

```rust
// services/settings/api.rs
pub fn init_logging_reload_handle(config: &LogConfig) -> Arc<Mutex<ReloadHandle>> {
    let new_filter = EnvFilter::new(&config.log_level);
    let (filter, reload_handle) = reload::Layer::new(new_filter);
    Arc::new(Mutex::new(reload_handle))
}
```

**关键**：

- reload handle 创建在 `app/shell/api.rs::initialize` 启动时
- handle 通过 `app.manage(Arc::new(handle))` 注入 Tauri State
- `app/settings/commands/logging/config.rs::set_log_config` 通过 `State<_, Arc<Mutex<ReloadHandle>>>` 拿到 handle → `handle.reload(new_filter)`

### 7.2 settings 不持有 LogConfig 的内存缓存

每次 `load_log_config` / `save_log_config` 都**读 / 写 disk**——不缓存：

- 理由：log_config 变更不频繁，每次读保证最新值
- 未来如果 settings domain 扩展到全字段，缓存才有意义

### 7.3 reload handle 注入而非由 settings 持有

reload handle 通过 Tauri `State` 注入到 `set_log_config` 命令——settings api 不持有：

- 理由：handle 的生命周期由 Tauri runtime 管理（跟 app 同生命周期）
- settings 只提供 `init_logging_reload_handle` 工厂函数 + `apply_log_config` 应用函数

## 8. v0 → v1 迁移说明

| v0 位置 | v1 位置 | 改动 |
|---|---|---|
| `commands/logging.rs::log_message / get_log_config / set_log_config / get_log_dir`（IPC handler）| 拆分为：service `services/settings/log_config.rs`（data + apply）+ app `app/settings/commands/logging/config.rs`（IPC handler）+ `app/settings/commands/logging/message.rs`（log_message） |
| `commands/logging.rs::set_log_config` 内联 reload handle 操作 | 抽到 `services/settings/api.rs::apply_log_config` |
| `crate::logging_setup.rs`（平铺）| 内部不动，仍是 `crate::logging_setup`（infra-level 工具） |
| `app.manage(Arc::new(reload_handle))` 注入（v0 在 lib.rs 内联） | 移到 `app/shell/api.rs::initialize` |

**关键变化**：

- v0 的 `commands/logging.rs` IPC handler 拆为 service 层（数据/逻辑）+ app 层（IPC）
- reload handle 的创建由 `app/shell/api.rs::initialize` 编排（v0 在 lib.rs 内联）
- reload handle 的应用（`set_log_config`）由 `services/settings/api.rs::apply_log_config` 提供——app 层调用

## 9. 跟 v0 的差异

| 维度 | v0 | v1 |
|---|---|---|
| settings domain | ❌ 不存在（log 在 `commands/logging.rs`，reload handle 在 `lib.rs`）| ✅ 独立 domain `services/settings/` |
| reload handle 位置 | `lib.rs` 内联 + `commands/logging.rs` 直 reload | `app/shell/api.rs::initialize` 创建 + `services/settings/api.rs::apply_log_config` 应用 |
| log_message 归属 | `commands/logging.rs`（横切）| `app/settings/commands/logging/message.rs`（保持横切，归 app/settings）|
| settings 全字段 | 不存在（其他字段都在 frontend）| MVP 仍只管 log_config——未来扩展时加 |
| 与 frontend service 镜像 | ❌ 不存在 | ✅ `services/settings/` ↔ `service/settings/` 名字一致 |