# Service · Persistence — 对下依赖

> **位置**：`src-tauri/src/services/persistence/`

## 1. 依赖图

```
services/persistence/
├── api.rs             ────►  tauri_plugin_store::StoreExt       (唯一允许直接 import 的地方)
├── api.rs             ────►  tauri::AppHandle                    (store 调用需要)
├── api.rs             ────►  serde_json                          (Value 序列化)
├── sessions.rs        ────►  models/session::SessionInfo        (typed wrapper)
├── groups.rs          ────►  models/group::GroupStore            (typed wrapper)
├── attached_tmux.rs   ────►  models/session::AttachedTmuxServer  (typed wrapper)
└── errors.rs          ────►  thiserror                           (PersistenceError)
```

**关键约束**：

- persistence **不** import 其他 service（横切 domain，最底层）
- persistence **不** import `crate::logging_setup`（logging_setup 是 settings 关注）
- persistence **只** import models（pure data types）+ infra（tauri-plugin-store）+ serde_json + thiserror

## 2. tauri-plugin-store

| 调用 | 来源 | 何时 |
|---|---|---|
| `tauri_plugin_store::StoreExt` | `tauri_plugin_store` crate | persistence **唯一**允许直接 import |
| `app.store(file)` | 同上 | `save_json_value` / `load_json_value` / `delete_json_value` 内部 |
| `store.set(key, value)` | 同上 | 写 |
| `store.get(key) -> Option<Value>` | 同上 | 读 |
| `store.delete(key)` | 同上 | 删除 |
| `store.save()` | 同上 | flush |
| `store.has_key(key) -> bool` | 同上 | utility |

**约束**：

- persistence 是 backend 中**唯一**允许直接 import `tauri_plugin_store` 的 service
- MVP 例外：`services/settings/api.rs` 直调 store（log_config.json）——下个 PR 改
- v3 的 `commands/persistence.rs` + `commands/logging.rs` + `commands/session.rs::create_tmux_session`（save_attached_tmux_servers_impl）都直调 store——v4 集中到 persistence

## 3. tauri

| 调用 | 来源 | 何时 |
|---|---|---|
| `tauri::AppHandle` | `tauri` crate | `save_json_value(&app, ...)` / `load_json_value(&app, ...)` 签名 |

**约束**：`tauri_plugin_store::StoreExt` 是 `AppHandle` 的 extension trait——必须 import `tauri::AppHandle`。

## 4. serde_json

| 调用 | 来源 | 何时 |
|---|---|---|
| `serde_json::Value` | `serde_json` crate | generic JSON wrapper 的 value 类型 |
| `serde_json::to_value` | 同上 | typed wrapper 序列化 |
| `serde_json::from_value` | 同上 | typed wrapper 反序列化 |

## 5. models

| 读取 | 来源 |
|---|---|
| `SessionInfo` | `models/session.rs` |
| `AttachedTmuxServer` | `models/session.rs` |
| `GroupStore` | `models/group.rs` |

**约束**：models 是纯数据类型——persistence 可自由 import。typed wrapper 持有这些类型做 JSON 序列化 / 反序列化。

## 6. thiserror

| 调用 | 来源 | 何时 |
|---|---|---|
| `#[derive(thiserror::Error)]` | `thiserror` crate | `PersistenceError` enum |
| `#[from] std::io::Error` | std | 自动 From impl |
| `#[from] serde_json::Error` | serde_json | 自动 From impl |

**关键**：persistence 是 backend 中**第二个**引入 typed error 的 service（第一个是 tmux）。

## 7. 内部依赖关系

```
services/persistence/
├── api.rs             ← 公共 API 入口（generic JSON wrapper）
├── errors.rs          ← PersistenceError（被 api / sessions / groups / attached_tmux 全部使用）
├── sessions.rs        ← typed wrapper（调用 api + serde_json::to/from_value）
├── groups.rs          ← typed wrapper（同上）
├── attached_tmux.rs   ← typed wrapper（同上）
└── mod.rs             ← re-export + From<PersistenceError> for String
```

**关键约束**：

- typed wrapper 文件（sessions / groups / attached_tmux）只 import `api.rs` 的 generic wrapper——**不**直接 import tauri-plugin-store
- typed wrapper 文件只 import models 的纯数据类型——**不** import 其他 service

## 8. 跨 domain 依赖

| domain | persistence 对其依赖 |
|---|---|
| `services/session` | ❌ 不依赖 |
| `services/tmux` | ❌ 不依赖 |
| `services/settings` | ❌ 不依赖（settings 调用 persistence；persistence 不知道 settings 存在）|
| `services/workspace` | ❌ 不依赖 |
| `services/persistence` | （自身）|
| `tauri-plugin-store` | ✅ 依赖 |
| `serde_json` | ✅ 依赖 |
| `thiserror` | ✅ 依赖 |
| `models/*` | ✅ 依赖 |

## 9. 设计意图：persistence 是「backend 持久化的单一入口」

v3 反模式：

- `commands/persistence.rs` 直调 store
- `commands/logging.rs::set_log_config` 直调 store
- `commands/session.rs::create_tmux_session` 内联调 `commands/persistence::save_attached_tmux_servers_impl`（pub(crate) helper）

→ **store 调用散在 4+ 文件**。任何持久化策略变更（如加 encryption）要改 4 处。

v4 边界：

- persistence api 是 backend 中**唯一**直接 import `tauri_plugin_store` 的地方
- 其他 service / app 通过 `persistence_api::*` 调 store
- typed wrapper 提供类型安全 + 集中序列化错误
- generic JSON wrapper 提供灵活性（settings 等自定义 store）

## 10. v3 → v4 跨调用迁移

| v3 现状 | v4 改法 |
|---|---|
| `commands/persistence.rs::save_sessions` 直接 `app.store(...).set(...).save()` | `app/settings/commands/persistence/sessions.rs::save_sessions`（IPC handler）→ `services/persistence/sessions.rs::save_sessions_typed` → `services/persistence/api.rs::save_json_value` |
| `commands/persistence.rs::save_attached_tmux_servers_impl`（pub(crate) helper）| 升级为 `services/persistence/attached_tmux.rs::save_attached_tmux_typed` 公开函数 |
| `commands/session.rs::create_tmux_session` 内联调 `crate::commands::persistence::save_attached_tmux_servers_impl` | `app/terminal/commands/tmux/session.rs::create_tmux_session` 调 `services/persistence/attached_tmux.rs::save_attached_tmux_typed` |
| `commands/logging.rs::set_log_config` 直调 store | `app/settings/commands/logging/config.rs::set_log_config`（IPC handler）→ `services/settings/api.rs::save_log_config` → `services/persistence/api.rs::save_json_value`（下个 PR）|
| `commands/logging.rs::get_log_config` 直调 store | 同上 |
| v3 散在 4+ 文件的 store 调用 | 集中在 `services/persistence/api.rs` + typed wrapper |

## 11. 不允许的依赖

- ❌ `services/persistence/` → 其他 service（persistence 是最底层）
- ❌ `services/persistence/` → `app::*`（service 不知道 IPC）
- ❌ 其他 service → `tauri_plugin_store` 直接 import（必须经过 persistence_api）
- ❌ 其他 service → `services/persistence/{sessions,groups,attached_tmux}.rs` 内部 typed wrapper（必须通过 api）
- ❌ `services/persistence/api.rs` → `services/persistence/{sessions,groups,attached_tmux}.rs` 反向依赖（api 是底层，typed wrapper 依赖 api）
- ❌ `services/persistence/*` → `crate::logging_setup::*`（logging 是 settings 关注）

## 12. 依赖变更流程

1. **新增 typed wrapper**（如未来加 `workspace.json`）→ 加 `services/persistence/workspace.rs` + 在 §2.2 同步 + store file / key const + app 调用方 + frontend 类型
2. **修改 typed wrapper 签名** → ⚠️ breaking——检查所有 app + frontend 调用方
3. **修改 store file name** → ⚠️ breaking——老 store 文件丢失，需要 migration
4. **迁移 store key** → ⚠️ breaking——migration 处理
5. **新增 schema migration** → 加 `services/persistence/migrations.rs` + 注册表 + 在 §7 / §8.1 同步
6. **删除 typed wrapper** → 从 persistence + app + frontend 同步删除