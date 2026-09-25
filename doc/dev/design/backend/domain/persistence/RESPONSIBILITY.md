# Domain · Persistence — 职责

> **位置**：`src-tauri/src/domain/persistence/`
> **类型**：⭐ 横切 domain（backend-only 持久化业务 wrapper）
> **被调用方**：`domain/terminal`（attached_tmux 写入触发）、`domain/persistence`（log_config 读写——合并）
> **Frontend 对应**：[`../../../frontend/service/persistence/RESPONSIBILITY.md`](../../../frontend/service/persistence/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么

persistence domain 持有 **backend 必须自己持久化**的状态——只覆盖 frontend 直存做不到的场景。

承担 2 类职责：

1. **进程级状态持久化** —— `attached_tmux.json`（tmux controller Arc 注册表在 backend 进程里，shutdown 时必须 backend 自己持久化）
2. **runtime reload 持久化** —— `log_config.json`（改了要 reload tracing subscriber，ReloadHandle 是 backend）

**明确不做**：saved session configs（`sessions.json`）和 saved groups（`groups.json`）—— frontend-only 配置，TS 直存 `tauri-plugin-store`。

## 2. 为什么只持久化这 2 类

| store 文件 | 内容 | 触发方 | 为什么 backend 持久化 |
|--|--|--|--|
| `attached_tmux.json` | 已 attach 的 tmux server list（controller Arc 注册表） | shutdown 时 backend 写、启动时 backend 读 | **进程级状态**：tmux controller Arc + SSH channel 都在 backend 进程里，frontend 只有镜像 |
| `log_config.json` | log 配置 + ReloadHandle | backend `domain/persistence::log_config` 写、`commands/shell::initialize` 读 | **runtime reload**：改完要 reload `tracing` subscriber，ReloadHandle 是 backend 的 `tracing` runtime 句柄，frontend 没法 reload |
| ~~`sessions.json`~~ | ~~saved session configs~~ | ~~frontend UI 改~~ | **frontend-only**：纯配置数据，无 backend 状态关联；走 `infra/store` 直存 |
| ~~`groups.json`~~ | ~~saved group store~~ | ~~frontend UI 改~~ | **frontend-only**：纯配置数据，无 backend 状态关联；走 `infra/store` 直存 |

**决策依据**：MVP 是单机单用户 desktop app——纯 frontend 配置不需要 backend 转发层。**backend persistence 只做 backend 自己的事**。

## 3. 这个 domain **不**负责什么

- **不存 frontend-only 配置**（sessions / groups）—— frontend 自己存
- **不解释 schema 细节**——只搬运 typed T ↔ JSON value
- **不渲染 UI**——backend 无 UI
- **不编排跨 domain 业务**——业务编排在 commands
- **不迁移 schema**（MVP）——MVP 假设 store 文件兼容；schema migration 是未来扩展

## 4. 子结构

```rust
domain/persistence/
├── api.rs                ⭐ 唯一对外入口
│                          - save_json_value / load_json_value / delete_json_value
│                          - load_or_default<T>（JSON → typed value，default fallback）
│                          - store_exists（检查文件是否被持久化）
├── mod.rs                re-export api.rs
├── attached_tmux.rs     attached_tmux.json 的 typed wrapper（load_/save_attached_tmux_typed）
└── errors.rs             PersistenceError（thiserror derive）
```

**砍掉的子模块**：

- ~~`sessions.rs`~~ —— sessions.json 改 frontend 直存
- ~~`groups.rs`~~ —— groups.json 改 frontend 直存

**为什么 attached_tmux 留 typed wrapper**：typed wrapper 集中 `serde_json::from_value` 错误处理 + 隐藏 store key 字面量。

## 5. 跟其他 domain 的关系

| domain | 关系 |
|--|--|
| `domain/terminal` | terminal **不直接**调 persistence——由 `commands/terminal/api.rs` 触发（避免 terminal 持有 IO 依赖） |
| （已删除——见各归属 domain）| settings **直接**调 persistence 读 / 写 `log_config.json`（settings 是 log_config 唯一持有者） |
| `infra/tauri::tauri-plugin-store` | persistence 是 backend 中**唯一**允许直接 import `tauri_plugin_store` 的 service |

**关键约束**：

- persistence 是**横切 domain**——被 terminal + settings 用
- persistence **不依赖**其他 service
- 其他 service **不直接**调 `tauri_plugin_store`——必须经过 `persistence_api::*`

## 6. 跟 commands 的关系

| commands module | 怎么用 domain/persistence |
|--|--|
| `commands/terminal` | `commands/terminal/api.rs::save_attached_tmux_servers` 调 `persistence_api::save_attached_tmux_typed(&app, &servers)`（shutdown 时） |
| `commands/terminal` | `commands/terminal/api.rs::auto_attach_tmux_servers` 调 `persistence_api::load_attached_tmux_typed(&app)`（启动时） |
| （已删除——attached_tmux→terminal，log→shell）| `commands/shell/commands/logging/config.rs::set_log_config` 调 `services/settings/api.rs::save_log_config` → `persistence_api::save_json_value(&app, "log_config.json", "config", &value)` |
| `commands/shell` | `commands/shell/api.rs::initialize` 调 `services/settings/api.rs::load_log_config` → `persistence_api::load_json_value(&app, "log_config.json", "config")` |

**frontend 不调 persistence IPC**：frontend 不通过 backend IPC 存 sessions / groups / attached_tmux——frontend 自己用 `tauri-plugin-store`（sessions/groups）或后端直接持久化（attached_tmux，frontend 不需要管）。

## 7. 这个 domain 的"产品语言"术语

- **store** —— tauri-plugin-store 的一个文件（如 `attached_tmux.json`）
- **store key** —— 文件内的字段名（如 `"servers"` / `"config"`）
- **JSON value** —— `serde_json::Value`，泛型 JSON 容器
- **typed wrapper** —— typed T ↔ JSON value 的转换（避免每个调用方都 `serde_json::from_value`）
- **load_or_default** —— 文件不存在 / 损坏时返回 `T::default()`
- **migration** —— schema 升级时的数据转换函数（未来）

## 8. 关键设计约束

### 8.1 persistence 是 backend 中**唯一**直接 import tauri-plugin-store 的 service

```rust
// domain/persistence/api.rs
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

### 8.2 typed wrapper 跟 generic JSON value wrapper 共存

```rust
// generic（settings 用）
pub fn save_json_value(app: &AppHandle, file: &str, key: &str, value: &serde_json::Value) -> Result<(), String>;

// typed（attached_tmux 用）
pub fn save_attached_tmux_typed(app: &AppHandle, servers: &[AttachedTmuxServer]) -> Result<(), String> {
    let value = serde_json::to_value(servers).map_err(|e| e.to_string())?;
    save_json_value(app, ATTACHED_TMUX_FILE, ATTACHED_TMUX_KEY, &value)
}
```

**关键**：

- typed wrapper 是 generic wrapper 的 thin layer——只是 JSON 序列化 / 反序列化
- typed wrapper 提供类型安全 + 集中 `serde_json::from_value` 错误处理
- generic wrapper 给 settings / log_config 等自定义 store 用

### 8.3 store key 字面量集中在 typed wrapper 文件中

```rust
// domain/persistence/attached_tmux.rs
pub const ATTACHED_TMUX_FILE: &str = "attached_tmux.json";
pub const ATTACHED_TMUX_KEY: &str = "servers";

pub fn save_attached_tmux_typed(app: &AppHandle, servers: &[AttachedTmuxServer]) -> Result<(), String> {
    let value = serde_json::to_value(servers).map_err(|e| e.to_string())?;
    save_json_value(app, ATTACHED_TMUX_FILE, ATTACHED_TMUX_KEY, &value)
}

pub fn load_attached_tmux_typed(app: &AppHandle) -> Result<Vec<AttachedTmuxServer>, String> {
    let value = load_json_value(app, ATTACHED_TMUX_FILE, ATTACHED_TMUX_KEY)?
        .ok_or_else(|| "attached_tmux.json key missing".to_string())?;
    serde_json::from_value(value).map_err(|e| e.to_string())
}
```

**关键**：文件路径 + store key 字面量集中在 typed wrapper 文件的 const——避免散落在 commands / app 模块。

## 9. 砍掉的 backend 持久化职责

| 旧职责 | 新位置 | 改动理由 |
|--|--|--|
| `services/persistence/sessions.rs` | frontend `service/persistence/sessions.ts`（TS 直存 `tauri-plugin-store`）| sessions.json 是 frontend-only 配置，无 backend 状态关联，backend 转发是冗余 |
| `services/persistence/groups.rs` | frontend `service/persistence/groups.ts` | groups.json 同上 |
| `app/settings/commands/persistence/sessions.rs::save_sessions` `load_sessions` | ❌ 删除 | frontend 不调 backend IPC 存 saved sessions |
| `app/settings/commands/persistence/groups.rs::save_groups` `load_groups` | ❌ 删除 | frontend 不调 backend IPC 存 saved groups |
| `app/settings/api.rs::save_session_config` `load_session_configs` | ❌ 删除 | 同上 |

**backend-only 持久化**：

- `domain/persistence/attached_tmux.rs` —— tmux controller Arc 进程级状态
- `domain/persistence/api.rs::save_json_value` + `domain/persistence/api.rs::save_log_config` —— log_config runtime reload

## 11. MVP 范围之外（未来扩展）

| 功能 | 触发条件 |
|--|--|
| Schema migration 注册表 | store 字段类型变化（如 `AttachedTmuxServer` 加字段） |
| Store 损坏自动 fallback + 备份 | store 文件 corrupt 但不能丢数据 |
| 加密 store | 用户的 saved tmux config 含 SSH key 等敏感信息 |
| Store 缓存 + 失效策略 | 频繁读 store 导致 IO 性能问题 |
（已删除——workspace 状态完全 frontend 持有）

## 12. 跟 frontend service 的职责分叉

| 维度 | frontend service/persistence | backend domain/persistence |
|--|--|--|
| 类型定义 | TS interface + TS 类型 | Rust struct + serde derive |
| 状态机 | zustand store（前端持有镜像） | **MVP 无**；目标态仅持有 attached_tmux 持久化引用 |
| 持久化 store | frontend `infra/store` 直存 sessions/groups/settings | backend `infra/tauri::tauri-plugin-store` 直存 attached_tmux/log_config |
| 跨 module 协调 | 通过 `service/persistence` 调用 | 通过 `commands/` 触发 |
| 跨域广播 | settings 字段变化 broadcast | backend **不广播**（仅 log_config reload handle 内部用） |

frontend 和 backend persistence **职责分叉**——frontend 直存 frontend-only 配置（sessions/groups/settings）；backend 直存 backend-only 配置（attached_tmux + log_config）。两边持久化**不重叠**。