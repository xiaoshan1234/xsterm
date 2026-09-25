# Service · Persistence — 职责

> **位置**：`src-tauri/src/services/persistence/`
> **类型**：⭐ 横切 domain（tauri-plugin-store 业务 wrapper，被所有 domain 用）
> **被调用方**：`app/session`、`app/terminal`、`app/settings`、`app/workspace`（未来）
> **Frontend 对应**：[`../../../frontend/service/persistence/RESPONSIBILITY.md`](../../../frontend/service/persistence/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么

persistence domain 持有 **tauri-plugin-store 的所有 IO**——backend 的物理持久化层。

承担 4 类职责：

1. **store 句柄管理**——lazy 加载 + 缓存（key → store 实例）
2. **JSON value CRUD**——`load_json_value(&app, file, key) -> serde_json::Value` / `save_json_value` / `delete_json_value`
3. **schema migration**——store 文件版本升级时迁移老数据（未来扩展）
4. **错误处理**——IO 错误 / 损坏文件 / 版本不匹配

## 2. MVP 范围

**MVP 持久化的 store 文件**：

| 文件 | 内容 | 触发方 |
|---|---|---|
| `sessions.json` | 已保存的 session config list | `app/session/api.rs::save_session_config` |
| `groups.json` | 已保存的 group store | `app/workspace/api.rs::save_groups`（未来）|
| `attached_tmux.json` | 已 attach 的 tmux server list | `app/terminal/api.rs::save_attached_tmux_servers` |
| `log_config.json` | log 配置 | `services/settings/api.rs::save_log_config` |

## 3. 这个 domain **不**负责什么

- **不存具体业务数据**——不解释 sessions / groups / settings 的 schema；只搬运 JSON value
- **不渲染 UI**——backend 无 UI
- **不编排跨 domain 业务**——业务编排在 app
- **不实现 cache 失效策略**——MVP 不缓存
- **不迁移 schema**——MVP 假设 store 文件兼容

## 4. 子结构

```
services/persistence/
├── api.rs            ⭐ 唯一对外入口
│                      - load_json_value / save_json_value / delete_json_value
│                      - load_or_default<T>（JSON → typed value，default fallback）
│                      - store_exists（检查文件是否被持久化）
├── mod.rs            re-export api.rs
├── sessions.rs       sessions.json 的 typed wrapper（load_sessions_typed / save_sessions_typed）
├── groups.rs         groups.json 的 typed wrapper
├── attached_tmux.rs  attached_tmux.json 的 typed wrapper
└── errors.rs         PersistenceError（thiserror derive）
```

**关键**：MVP 的 typed wrapper 跟 generic JSON value wrapper **共存**——typed wrapper 提供类型安全（避免每个调用方都 `serde_json::from_value`），generic wrapper 提供灵活性（settings / log_config 等自定义 store）。

## 5. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `services/session` | session **不直接**调 persistence——由 `app/session/api.rs` 触发（避免 session 持有 IO 依赖）|
| `services/tmux` | tmux **不直接**调 persistence——由 `app/terminal/api.rs` 触发 |
| `services/settings` | settings **直接**调 persistence 读 / 写 `log_config.json`（settings 是 log_config 唯一持有者）|
| `services/workspace` | workspace **不直接**调 persistence——未来由 `app/workspace/api.rs` 触发 |
| `tauri-plugin-store` | persistence 是 backend 中**唯一**允许直接 import `tauri_plugin_store` 的 service |

**关键约束**：

- persistence 是**横切 domain**——被所有 domain 用
- persistence **不依赖**其他 service
- 其他 service **不直接**调 `tauri_plugin_store`——必须经过 `services/persistence/api.rs`（settings 是 MVP 例外，下个 PR 改）

## 6. 跟 app 的关系

| app module | 怎么用 services/persistence |
|---|---|
| `app/session` | `app/session/api.rs::save_session_config` 调 `persistence_api::save_sessions_typed(&app, &sessions)` |
| `app/terminal` | `app/terminal/api.rs::save_attached_tmux_servers` 调 `persistence_api::save_attached_tmux_typed(&app, &servers)` |
| `app/settings` | `app/settings/commands/persistence/sessions.rs::save_sessions`（IPC handler）调 `persistence_api::save_sessions_typed`——IPC 暴露给 frontend |
| `app/workspace` | 未来 `app/workspace/api.rs::save_workspace_state` 调 `persistence_api::save_workspace_typed` |
| `app/shell` | shell **不直接**调 persistence——`load_log_config` 由 settings 处理 |

**关键**：app module 通过 `app/<module>/api.rs` 调 persistence——`#[tauri::command]` wrapper 不直接 import persistence。

## 7. 这个 domain 的"产品语言"术语

- **store** —— tauri-plugin-store 的一个文件（如 `sessions.json`）
- **store key** —— 文件内的字段名（如 `"sessions"` / `"groups"` / `"servers"` / `"config"`）
- **JSON value** —— `serde_json::Value`，泛型 JSON 容器
- **typed wrapper** —— typed T ↔ JSON value 的转换（避免每个调用方都 `serde_json::from_value`）
- **load_or_default** —— 文件不存在 / 损坏时返回 `T::default()`
- **migration** —— schema 升级时的数据转换函数（未来）

## 8. 关键设计约束

### 8.1 persistence 是 backend 中**唯一**直接 import tauri-plugin-store 的 service

```rust
// services/persistence/api.rs
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

pub fn save_json_value(
    app: &AppHandle,
    file: &str,
    key: &str,
    value: &serde_json::Value,
) -> Result<(), String> {
    let store = app.store(file).map_err(|e| e.to_string())?;
    store.set(key, value.clone());
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}
```

**约束**：

- 其他 service **禁止** import `tauri_plugin_store`——必须经过 `persistence_api::*`
- MVP 例外：`services/settings/api.rs` 直调 store（log_config.json）；下个 PR 改
- v3 的 `commands/persistence.rs` + `commands/logging.rs` 都直调 store——v4 集中到 `services/persistence/`（settings 直调是过渡）

### 8.2 typed wrapper 跟 generic JSON value wrapper 共存

```rust
// generic（settings 用）
pub fn save_json_value(app: &AppHandle, file: &str, key: &str, value: &serde_json::Value) -> Result<(), String>;

// typed（session / terminal / groups 用）
pub fn save_sessions_typed(app: &AppHandle, sessions: &[SessionInfo]) -> Result<(), String> {
    let value = serde_json::to_value(sessions).map_err(|e| e.to_string())?;
    save_json_value(app, "sessions.json", "sessions", &value)
}
```

**关键**：

- typed wrapper 是 generic wrapper 的 thin layer——只是 JSON 序列化 / 反序列化
- typed wrapper 提供类型安全 + 集中 `serde_json::from_value` 错误处理
- generic wrapper 给 settings / log_config 等自定义 store 用

### 8.3 store key 字面量集中在 typed wrapper 文件中

```rust
// services/persistence/sessions.rs
const SESSIONS_FILE: &str = "sessions.json";
const SESSIONS_KEY: &str = "sessions";

pub fn save_sessions_typed(app: &AppHandle, sessions: &[SessionInfo]) -> Result<(), String> {
    let value = serde_json::to_value(sessions).map_err(|e| e.to_string())?;
    save_json_value(app, SESSIONS_FILE, SESSIONS_KEY, &value)
}

pub fn load_sessions_typed(app: &AppHandle) -> Result<Vec<SessionInfo>, String> {
    let value = load_json_value(app, SESSIONS_FILE, SESSIONS_KEY)?
        .ok_or_else(|| "sessions.json key missing".to_string())?;
    serde_json::from_value(value).map_err(|e| e.to_string())
}
```

**关键**：文件路径 + store key 字面量集中在 typed wrapper 文件的 const——避免散落在 commands / app 模块。

## 9. v3 → v4 迁移说明

| v3 位置 | v4 位置 | 改动 |
|---|---|---|
| `commands/persistence.rs::save_sessions / load_sessions / save_groups / load_groups / save_attached_tmux_servers / load_attached_tmux_servers` | 拆分为：service `services/persistence/{sessions,groups,attached_tmux}.rs` + app `app/settings/commands/persistence/{sessions,groups,attached_tmux}.rs` |
| `commands/persistence.rs::save_attached_tmux_servers_impl`（pub(crate) sync helper，被 commands/session 内联调）| 升级为 `services/persistence/attached_tmux.rs::save_attached_tmux_typed` 公开函数 |
| `commands/logging.rs::set_log_config` 内联 `store.set / store.save` | 拆分为：service `services/settings/api.rs::save_log_config` + app `app/settings/commands/logging/config.rs::set_log_config`（IPC wrapper）|
| `lib.rs::run()` 内联 `app.manage(Arc::new(reload_handle))` | 抽到 `app/shell/api.rs::initialize` |

## 10. 跟 v3 的差异

| 维度 | v3 | v4 |
|---|---|---|
| persistence domain | ❌ 不存在（store 调用散在 commands/session / commands/persistence / commands/logging） | ✅ 独立 domain `services/persistence/` |
| store 调用集中度 | 散在 3+ 文件 | 集中在 `services/persistence/api.rs`（+ settings MVP 例外） |
| typed wrapper | 不存在（每个 IPC handler 自己 `serde_json::from_value`） | typed wrapper 文件 + generic JSON wrapper |
| `save_attached_tmux_servers_impl` | pub(crate) sync helper | 公开 `services/persistence::save_attached_tmux_typed` |
| 与 frontend service 镜像 | ❌ 不存在 | ✅ `services/persistence/` ↔ `service/persistence/` 名字一致 |

## 11. MVP 范围之外（未来扩展）

| 功能 | 触发条件 |
|---|---|
| Schema migration 注册表 | store 字段类型变化（如 `SessionInfo` 加字段） |
| Store 损坏自动 fallback + 备份 | store 文件 corrupt 但不能丢数据 |
| 加密 store | 用户的 saved config 含敏感信息 |
| Store 缓存 + 失效策略 | 频繁读 store 导致 IO 性能问题 |