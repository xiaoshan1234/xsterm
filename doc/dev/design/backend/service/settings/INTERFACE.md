# Service · Settings — 对外接口

> **位置**：`src-tauri/src/services/settings/api.rs`
> **唯一进口**：`use crate::services::settings::*;`

## 1. 对外暴露什么

settings domain 暴露 5 类符号：

1. **`LogConfig` struct** —— log 配置数据结构（来自 `crate::logging_setup::LogConfig`）
2. **`init_logging_reload_handle(&LogConfig)` 工厂函数** —— 创建 `Arc<Mutex<ReloadHandle>>`
3. **`apply_log_config(&ReloadHandle, &LogConfig)` 函数** —— 应用新 log config + reload filter
4. **`load_log_config(&AppHandle)` / `save_log_config(&AppHandle, &LogConfig)`** —— log_config.json 读写
5. **`get_log_dir(&AppHandle) -> PathBuf`** —— 解析 log 目录

## 2. 核心接口

```rust
use crate::logging_setup::LogConfig;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tracing_subscriber::{reload, EnvFilter, Registry};

/// LogConfig 的 reload handle 类型别名
pub type ReloadHandle = reload::Handle<EnvFilter, Registry>;

/// 默认 LogConfig（fallback 当 log_config.json 不存在或损坏时）
pub fn default_log_config() -> LogConfig;

// ============ log_config.json 持久化 ============

/// 从 disk 读 LogConfig（每次读 disk，无缓存）
pub fn load_log_config(app: &AppHandle) -> Result<LogConfig, String>;

/// 写 LogConfig 到 disk（每次写 disk）
pub fn save_log_config(app: &AppHandle, config: &LogConfig) -> Result<(), String>;

/// 解析 app log 目录（`app.path().app_log_dir()` 的 wrapper）
pub fn get_log_dir(app: &AppHandle) -> PathBuf;

// ============ rolling writer 初始化 ============

/// 初始化 rolling file writer + 返回 reload handle
/// （委托给 `crate::logging_setup::init_logging`）
pub fn init_logging_reload_handle(
    log_dir: &Path,
    config: &LogConfig,
) -> (Arc<Mutex<ReloadHandle>>, Box<dyn std::any::Any + Send>);

// ============ reload 应用 ============

/// 应用新 LogConfig——reload EnvFilter（保留现有 rolling writer）
pub fn apply_log_config(
    handle: &Mutex<ReloadHandle>,
    config: &LogConfig,
) -> Result<(), String>;
```

## 3. 跟 app 的接缝

### 3.1 app/shell → settings（启动序列）

```rust
// app/shell/api.rs（v1）
use crate::services::settings as settings_api;
use crate::logging_setup::cleanup_old_logs;

pub fn initialize(app: &mut tauri::App) -> Result<(), String> {
    let log_dir = app
        .handle()
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    // 1. 读 log config
    let config = settings_api::load_log_config(&app.handle())?;

    // 2. 清理旧 log
    cleanup_old_logs(&log_dir, config.max_file_size * config.max_log_files as u64);

    // 3. 初始化 rolling writer + reload handle
    let (reload_handle, _guard) =
        settings_api::init_logging_reload_handle(&log_dir, &config);

    // 4. 注入 Tauri State（set_log_config 会拿到 handle）
    app.manage(reload_handle);

    tracing::info!("Application starting, log dir: {:?}", log_dir);
    Ok(())
}
```

### 3.2 app/settings → settings（运行时修改 log config）

```rust
// app/settings/commands/logging/config.rs
use crate::services::settings as settings_api;
use tauri::State;

#[tauri::command]
pub async fn set_log_config(
    config: LogConfig,
    app: AppHandle,
    state: State<'_, Arc<Mutex<settings_api::ReloadHandle>>>,
) -> Result<(), String> {
    // 1. 持久化到 disk
    settings_api::save_log_config(&app, &config)?;

    // 2. 应用新 config（reload EnvFilter）
    settings_api::apply_log_config(state.inner(), &config)?;

    Ok(())
}
```

## 4. 跟 frontend 的镜像

```typescript
// frontend service/settings/api.ts
export async function setLogConfig(config: LogConfig) {
  return invoke<void>("set_log_config", { config });
}

// ↑ frontend 调 backend app/settings/commands/logging/config.rs::set_log_config
// ↑ backend 调 services/settings/api.rs::save_log_config + apply_log_config
```

## 5. 关键设计决策

### 5.1 LogConfig 暂留在 `crate::logging_setup`

`LogConfig` struct 当前定义在 `src-tauri/src/logging_setup.rs`——infra-level 工具模块。settings 重新 export 它（**不**复制定义）：

- 理由：`LogConfig` 是纯数据结构，logging_setup 是 infra 工具
- 未来迁移：如果 settings domain 扩展到全字段，把 `LogConfig` 移到 `services/settings/log_config.rs`；logging_setup 只保留 rolling writer 初始化

### 5.2 reload handle 由 settings 创建，由 Tauri State 持有

```rust
// 创建：app/shell/api.rs::initialize
let (handle, _guard) = settings_api::init_logging_reload_handle(&log_dir, &config);
app.manage(handle);

// 持有：app.settings 的 `set_log_config` 命令
state: State<'_, Arc<Mutex<ReloadHandle>>>,

// 应用：services/settings/api.rs::apply_log_config
pub fn apply_log_config(
    handle: &Mutex<ReloadHandle>,
    config: &LogConfig,
) -> Result<(), String> {
    let new_filter = EnvFilter::new(&config.log_level);
    handle.lock().map_err(|e| e.to_string())?.reload(new_filter).map_err(|e| e.to_string())
}
```

**关键**：handle 的生命周期由 Tauri runtime 管理——`std::mem::forget(_guard)` 保持 rolling writer 存活。

### 5.3 settings 不实现 log_message（属于 app 横切）

`log_message` 是 frontend → backend 的 fire-and-forget IPC——把前端日志转发到 `tracing::*!`。它**逻辑上**属于 logging 横切关注点，不是 settings tab 流程。

**v1 决策**：保留在 `app/settings/commands/logging/message.rs`（因为 app/settings 已经有 logging 子目录）——但 **service 层不暴露**。

未来如果需要"log_message 写入自己的 ring buffer 供 frontend 订阅"——再把 `log_message` 的处理逻辑下沉到 service。

## 6. 接缝契约

```rust
// services/settings/api.rs 是唯一对外入口
// app shell / app settings / app terminal 调 settings_api::*
// 不允许直接 import services/settings/{log_config, reload}.rs 内部
```

**接缝约束**：

- `app/shell/api.rs` 通过 `settings_api::load_log_config` / `init_logging_reload_handle` 调 settings
- `app/settings/commands/logging/config.rs` 通过 `settings_api::save_log_config` / `apply_log_config` 调 settings
- 其他 app module 不调 settings（session / terminal 不需要 log config）

## 7. 不对外暴露

- `crate::logging_setup::*` 的内部函数（除 `LogConfig` 类型 + `init_logging`）
- rolling writer 的具体类型（`Box<dyn std::any::Any + Send>`）
- `EnvFilter::new()` 的调用细节（封装在 `apply_log_config`）

## 8. api.rs 变更流程

1. **新增 LogConfig 字段** → 加 `crate::logging_setup::LogConfig` 字段 + 更新 §2 + 在 frontend `service/settings/types.ts` 同步
2. **新增 log_config.json 字段** → 加 `save_log_config` 写入逻辑 + migration 处理
3. **修改 reload 时机** → 在 `apply_log_config` 改 reload 调用——注意是否破坏现有 filter 状态
4. **删除 settings 字段** → ⚠️ breaking——可能影响 disk 上 log_config.json 的 migration

## 9. 错误传播约定

- 所有公共方法返回 `Result<T, String>`（不引入 typed error）
- 错误来源：`tauri_plugin_store` IO 错误 / `serde_json` 解析错误 / `reload::Handle::reload` 错误
- 错误通过 `.map_err(|e| e.to_string())` 转换——未来可统一为 `SettingsError`

## 10. MVP 范围之外（未来扩展）

| 功能 | 触发条件 |
|---|---|
| 全 settings 字段持久化 | backend 需要读 defaultShell / defaultSshUser 等 |
| settings schema migration | settings 字段类型变化（如 LogConfig 字段重命名）|
| LogConfig 内存缓存 | log_config 变更频繁（不切实际——目前不实现）|
| settings import/export | 用户备份 / 恢复配置 |