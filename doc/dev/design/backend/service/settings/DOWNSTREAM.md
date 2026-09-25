# Service · Settings — 对下依赖

> **位置**：`src-tauri/src/services/settings/`

## 1. 依赖图

```
services/settings/
├── api.rs             ────►  crate::logging_setup::*           (LogConfig type + init_logging 函数)
├── api.rs             ────►  tauri_plugin_store::StoreExt      (读 / 写 log_config.json)
├── api.rs             ────►  tracing_subscriber::reload::*     (ReloadHandle + EnvFilter)
├── api.rs             ────►  tracing_subscriber::EnvFilter     (filter new)
├── api.rs             ────►  tauri::AppHandle                  (app.store(...) 调用)
├── api.rs             ────►  services/persistence/api.rs::*    (未来：log_config.json IO 通过 persistence)
├── log_config.rs      ────►  crate::logging_setup::LogConfig   (类型 re-export)
├── reload.rs          ────►  tracing_subscriber::reload       (handle 类型定义)
└── defaults.rs        ────►  (no deps — pure defaults)
```

## 2. crate::logging_setup

| 调用 | 来源 | 何时 |
|---|---|---|
| `LogConfig` struct | `crate::logging_setup.rs` | settings 类型引用（不复制定义）|
| `init_logging(&log_dir, &config) -> (ReloadHandle, _guard)` | 同上 | `init_logging_reload_handle` 内部 |

**约束**：

- settings 是 backend 中**唯一**允许直接 import `crate::logging_setup::*` 的 service（启动一次性使用）
- app/shell 不直接 import logging_setup——通过 `settings_api::init_logging_reload_handle` 间接
- 未来如果 `LogConfig` 类型移到 settings/log_config.rs，logging_setup 只保留 `init_logging` 函数

## 3. tauri-plugin-store

| 调用 | 来源 | 何时 |
|---|---|---|
| `app.store("log_config.json")` | `tauri_plugin_store::StoreExt` | `load_log_config` / `save_log_config` 内部 |
| `store.get("config")` | 同上 | 读 |
| `store.set("config", value)` | 同上 | 写 |
| `store.save()` | 同上 | flush |

**约束**：

- settings 是 backend 中**唯一**允许直接 import `tauri_plugin_store` 的 service（log_config.json 是 settings 唯一直接写的 store）
- 其他 service（如 persistence）应该统一通过 `services/persistence/api.rs` 间接调 store
- v0 的 `commands/persistence.rs` + `commands/logging.rs` 都直调 store——v1 把 store 调用集中到 `services/persistence/` + `services/settings/` 两处

## 4. tracing-subscriber

| 调用 | 来源 | 何时 |
|---|---|---|
| `reload::Handle<EnvFilter, Registry>` | `tracing_subscriber::reload` | `ReloadHandle` type alias |
| `reload::Layer::new(filter)` | 同上 | `init_logging_reload_handle` 内部 |
| `EnvFilter::new(&config.log_level)` | `tracing_subscriber::EnvFilter` | `apply_log_config` 内部构造新 filter |
| `handle.reload(new_filter)` | 同上 | `apply_log_config` 实际 reload |

**约束**：

- reload handle 由 `crate::logging_setup::init_logging` 创建——settings 不自己创建
- settings 只提供 `apply_log_config(handle, &config)` 包装 reload 调用
- settings 不直接 import `tracing_subscriber::Registry`（除非重新设计 reload handle 类型）

## 5. tauri

| 调用 | 来源 | 何时 |
|---|---|---|
| `tauri::AppHandle` | `tauri` crate | `load_log_config(&app)` / `save_log_config(&app, &config)` 签名 |

**约束**：settings 调 store 必须拿 AppHandle（`tauri_plugin_store::StoreExt` 是 AppHandle 的 extension trait）。

## 6. services/persistence（未来）

如果把 `log_config.json` IO 也下沉到 `services/persistence/`：

```rust
// services/settings/api.rs（未来）
use crate::services::persistence as persistence_api;

pub fn load_log_config(app: &AppHandle) -> Result<LogConfig, String> {
    let value = persistence_api::load_json_value(app, "log_config.json", "config")?;
    serde_json::from_value(value).map_err(|e| e.to_string())
}

pub fn save_log_config(app: &AppHandle, config: &LogConfig) -> Result<(), String> {
    let value = serde_json::to_value(config).map_err(|e| e.to_string())?;
    persistence_api::save_json_value(app, "log_config.json", "config", &value)
}
```

**当前状态**：MVP 保持 settings 直接调 tauri-plugin_store；下一个 PR 移到 persistence。

## 7. 设计意图：settings 是「log config 的 service 边界」

v0 的反模式：

- `commands/logging.rs::set_log_config` 直接 `tracing_subscriber::reload::Handle::reload(new_filter)`——app 层直接动 reload handle
- `lib.rs::run().setup(|app| { ... cleanup_old_logs(...) ... init_logging(...) ... app.manage(Arc::new(reload_handle)) ... })`——30 行内联块混了 logging + binary output channel

v1 的边界：

- settings api 提供 `apply_log_config(handle, &config)` 包装 reload——app 不直接动 handle
- settings api 提供 `init_logging_reload_handle(&log_dir, &config)` 工厂——app/shell 不直接调 logging_setup
- reload handle 的生命周期管理集中在 settings domain

## 8. v0 → v1 跨调用迁移

| v0 现状 | v1 改法 |
|---|---|
| `lib.rs::run().setup(\|app\| { ... init_logging + cleanup_old_logs ... })` | `app/shell/api.rs::initialize(app)` 调 `settings_api::load_log_config` + `crate::logging_setup::cleanup_old_logs` + `settings_api::init_logging_reload_handle` |
| `commands/logging.rs::set_log_config` 内联 `handle.reload(new_filter)` | `app/settings/commands/logging/config.rs::set_log_config` 调 `settings_api::apply_log_config(state.inner(), &config)` |
| `commands/logging.rs::get_log_config` 直读 store | `app/settings/commands/logging/config.rs::get_log_config` 调 `settings_api::load_log_config` |
| `commands/logging.rs::get_log_dir` 直读 `app.path().app_log_dir()` | `app/settings/commands/logging/config.rs::get_log_dir` 调 `settings_api::get_log_dir` |
| `commands/logging.rs::log_message` 直 `tracing::*!` | 不变（属于 app/settings 横切，service 不暴露）|

## 9. 不允许的依赖

- ❌ `services/settings/` → `services/session::*`（settings 不知道 session）
- ❌ `services/settings/` → `services/tmux::*`（同上）
- ❌ `services/settings/` → `services/workspace::*`（同上）
- ❌ `services/settings/` → `app::*`（service 不知道 IPC）
- ❌ `services/settings/` → `services/persistence::*` 直调（应当用 persistence 公开 API；MVP 暂时直接调 store，下个 PR 改）
- ❌ `services/settings/api.rs` → `crate::logging_setup::*` 的 `init_logging` 之外（只暴露 LogConfig 类型 + init_logging 函数）
- ❌ 其他 service → `crate::logging_setup::*` 直接 import（必须经过 settings_api）

## 11. 依赖变更流程

1. **新增 LogConfig 字段** → 加 `crate::logging_setup::LogConfig` 字段 + §2 + frontend `service/settings/types.ts` 同步
2. **新增 log_config.json 字段**（migration）→ 加 `save_log_config` 写入 + 老 config 兼容逻辑
3. **修改 reload 时机** → 在 `apply_log_config` 改 reload 调用——保留现有 filter 状态
4. **迁移 log_config.json IO 到 persistence** → 加 `services/persistence::save_json_value` 公开函数 + settings 改为调 persistence
5. **删除 settings 字段** → ⚠️ breaking——migration 处理老 disk 数据