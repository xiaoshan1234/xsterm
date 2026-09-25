# Model · Settings — 对下依赖

> **位置**：`src-tauri/src/models/settings/`

## 1. 依赖图

```
models/settings/
├── types.rs        ────►  models/session/types::{LocalSessionConfig, SSHSessionConfig}  (SavedSessionConfigKind 变体)
├── types.rs        ────►  models/tmux/types::TmuxCcConfig                              (SavedSessionConfigKind 变体)
├── types.rs        ────►  serde::{Serialize, Deserialize}
├── types.rs        ────►  crate::logging_setup::LogConfig                              (re-export)
├── accessor.rs     ────►  (self-only: DisplayConfig / LogConfig)
├── rules.rs        ────►  (self-only: DisplayConfig / LogConfig)
└── errors.rs       ────►  thiserror::Error
```

**关键约束**:
- settings model **不** import `crate::services::*`
- settings model **不** import `crate::app::*`
- settings model **不** import `crate::infrastructure::*`
- settings model **不** import `tokio` / `tauri`
- settings model **允许** import `models/session::types::*`(纯类型字段引用)
- settings model **允许** import `models/tmux::types::*`(纯类型字段引用)

## 2. models/session

settings types 引用以下 session 类型:

| 类型 | 用途 |
|---|---|
| `LocalSessionConfig` | `SavedSessionConfigKind::Local(LocalSessionConfig)` 变体 |
| `SSHSessionConfig` | `SavedSessionConfigKind::Ssh(SSHSessionConfig)` 变体 |

**约束**:只引用 struct 字段(纯数据),不引用函数 / trait。

## 3. models/tmux

settings types 引用以下 tmux 类型:

| 类型 | 用途 |
|---|---|
| `TmuxCcConfig` | `SavedSessionConfigKind::TmuxCc(TmuxCcConfig)` 变体 |

**约束**:只引用 struct 字段(纯数据)。

## 4. models/cross_cutting

settings **不依赖** cross_cutting——settings 是横切 domain 之一,与其他 domain 平级。

## 5. crate::logging_setup

| 调用 | 来源 | 何时 |
|---|---|---|
| `LogConfig` struct | `crate::logging_setup.rs` | settings **re-export** 当前定义在此处的 `LogConfig`(未来可迁) |
| `cleanup_old_logs` / `init_logging` 函数 | 同上 | 间接——通过 `services/settings/api.rs` 调用 |

**约束**:
- `LogConfig` 当前定义在 `crate::logging_setup.rs`——这是 infra-level 工具模块
- settings model **不直接 import** `crate::logging_setup::*`(只通过 `pub use crate::logging_setup::LogConfig;` re-export)
- `init_logging / cleanup_old_logs` 等函数**不是** settings model 的依赖——它们是 `services/settings/api.rs` 的依赖

## 6. serde / serde_json / thiserror

| 依赖 | 何时使用 |
|---|---|
| `serde::{Serialize, Deserialize}` | 所有跨 IPC 边界的类型 |
| `serde_json::Value` | (可选)某些字段 |
| `thiserror::Error` | `SettingsError` derive |

## 7. std

| 使用 | 何时 |
|---|---|
| `String` / `Vec` / `Option` | 所有 container 字段 |
| `HashMap` | EnvConfig.vars |
| `u32` / `u64` / `u16` | id / 数字字段 |

## 8. 内部依赖关系

```
models/settings/
├── types.rs        ← 被 accessor / rules 引用 + 被 service/settings + service/session + service/tmux 引用
├── accessor.rs     ← 被 service/settings 引用
├── rules.rs        ← 被 service/settings 引用(校验)
└── errors.rs       ← 被 types.rs 构造器 + rules.rs validate_* 使用
```

**关键约束**:
- accessor / rules **只读** types.rs 的类型,**不写**
- accessor / rules **不** import 其他 domain 的函数

## 9. 跨 domain 依赖关系(全局视角)

```
models/cross_cutting/     ← 最底层
       ▲
       │
       ├────►  models/session/        (核心)
       ├────►  models/workspace/      (核心,预留)
       ├────►  models/tmux/           (派生)
       └────►  models/settings/       (横切) ← 本 domain
```

**关键**:
- `models/settings` 与 `models/session` / `models/tmux` 的关系是"SavedSessionConfigKind 变体引用"——纯类型字段
- `models/settings` **不** import `models/cross_cutting::*`——平级横切 domain

## 10. 设计意图:settings model 是「settings 字段的纯数据镜像」

v3 反模式:`models/session.rs` 内含 5 个 settings 字段类型——1670 行单文件。

v4 边界:
- settings model 是**独立横切 domain**——与 frontend `model/settings/` 镜像
- saved config 是**版本化的**(`SavedSessionConfigV1`)——支持未来 schema migration
- `LogConfig` 暂留 `crate::logging_setup`(logging_setup 是核心依赖)——未来 settings 扩展时再迁

## 11. v3 → v4 跨调用迁移

| v3 位置 | v4 改法 |
|---|---|
| `models/session.rs::SizingMode`(line 590)| `models/settings/types.rs::SizingMode` |
| `models/session.rs::DisplayConfig`(line 600)| `models/settings/types.rs::DisplayConfig` |
| `models/session.rs::EnvConfig`(line 671)| `models/settings/types.rs::EnvConfig` |
| `models/session.rs::SavedSessionConfigV1`(line 710)| `models/settings/types.rs::SavedSessionConfigV1` |
| `models/session.rs::SavedSessionConfigKind`(line 729)| `models/settings/types.rs::SavedSessionConfigKind` |
| `crate::logging_setup::LogConfig` | 保留(未来可迁到 settings/types.rs) |
| 所有 `use crate::models::session::DisplayConfig` | `use crate::models::settings::types::DisplayConfig` |
| 所有 `use crate::models::session::EnvConfig` | `use crate::models::settings::types::EnvConfig` |
| 所有 `use crate::models::session::SizingMode` | `use crate::models::settings::types::SizingMode` |
| 所有 `use crate::models::session::SavedSessionConfigV1` | `use crate::models::settings::types::SavedSessionConfigV1` |
| 所有 `use crate::models::session::SavedSessionConfigKind` | `use crate::models::settings::types::SavedSessionConfigKind` |

## 12. 不允许的依赖

- ❌ `models/settings/` → `crate::services::*`(model 是最底层)
- ❌ `models/settings/` → `crate::app::*`
- ❌ `models/settings/` → `crate::infrastructure::*`
- ❌ `models/settings/` → `tokio` / `tauri`
- ❌ `models/settings/` → `crate::logging_setup::*` 的 `init_logging / cleanup_old_logs`(那是 service 关注)
- ❌ `models/settings/types.rs` → `models/session` 的函数(只引用 LocalSessionConfig / SSHSessionConfig 类型)
- ❌ `models/settings/types.rs` → `models/tmux` 的函数(只引用 TmuxCcConfig 类型)
- ❌ `models/settings/` → `models/workspace::*`(workspace 是预留位)

## 13. 依赖变更流程

1. **新增 DisplayConfig 字段** → 加 `types.rs::DisplayConfig` 字段 + INTERFACE.md §2.1 + frontend `model/settings/types.ts` 同步
2. **新增 SettingsError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.4 + 检查所有 `?` 调用方
3. **新增 accessor function** → 加 `accessor.rs` 函数 + INTERFACE.md §2.2
4. **新增 rules function** → 加 `rules.rs` 函数 + INTERFACE.md §2.3
5. **修改 saved config schema**(v2) → 加 `SavedSessionConfigV2` + `migrate_v1_to_v2()` helper + INTERFACE.md §2.1 + frontend 同步
6. **迁移 LogConfig 到 settings**(未来) → 加 `types.rs::LogConfig` + 从 `crate::logging_setup` 删 + INTERFACE.md §2.1 + service/settings 同步