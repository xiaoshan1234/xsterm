# Model · Tmux — 对下依赖

> **位置**：`src-tauri/src/models/tmux/`

## 1. 依赖图

```
models/tmux/
├── types.rs        ────►  models/session/types::{SessionInfo, SessionType}    (字段引用)
├── types.rs        ────►  models/settings/types::EnvConfig                    (字段引用)
├── types.rs        ────►  serde::{Serialize, Deserialize}
├── accessor.rs     ────►  models/session/types::SessionInfo                   (返回类型)
├── accessor.rs     ────►  models/session/types::SessionType                   (构造)
├── accessor.rs     ────►  models/cross_cutting/types::CapabilityFlags         (构造)
└── errors.rs       ────►  thiserror::Error                                    (预留)
```

**关键约束**:
- tmux model **不** import `crate::services::*`
- tmux model **不** import `crate::app::*`
- tmux model **不** import `crate::infrastructure::*`
- tmux model **不** import `tokio` / `tauri`
- tmux model **允许** import `models/session::types::*`(纯类型字段引用)
- tmux model **允许** import `models/settings::types::*`(纯类型字段引用)
- tmux model **允许** import `models/cross_cutting::types::*`(纯类型字段引用)

## 2. models/session

tmux types 引用以下 session 类型:

| 类型 | 用途 |
|---|---|
| `SessionInfo` | `TmuxSessionInit::session` 字段;`tmux_pane_info()` 返回类型 |
| `SessionType` | `SessionInfo.session_type` 字段构造 |

**约束**:
- 引用的是**纯类型字段**——不含逻辑
- tmux **不** import session model 的函数(除 `tmux_pane_info` 内部需要构造 `SessionInfo`)
- `accessor.rs::tmux_pane_info()` 是**唯一**允许在 tmux domain 内构造 `SessionInfo` 的位置

## 3. models/settings

tmux types 引用以下 settings 类型:

| 类型 | 用途 |
|---|---|
| `EnvConfig` | `TmuxCcConfig.env_config` 字段 |

**约束**:只引用 EnvConfig struct 字段(纯数据)。

## 4. models/cross_cutting

tmux types 引用以下 cross-cutting 类型:

| 类型 | 用途 |
|---|---|
| `CapabilityFlags` | `SessionInfo::capabilities` 字段(MVP 由 `CapabilityFlags::for_tmux()` 构造)|

**约束**:只引用 CapabilityFlags 类型字段(纯数据)。

## 5. serde / serde_json / thiserror

| 依赖 | 何时使用 |
|---|---|
| `serde::{Serialize, Deserialize}` | 所有跨 IPC 边界的类型 |
| `serde_json::Value` | (可选)某些字段 |
| `thiserror::Error` | `TmuxConfigError` derive(预留) |

## 6. 内部依赖关系

```
models/tmux/
├── types.rs        ← 被 accessor / rules 引用 + 被 service/tmux / service/session 引用
├── accessor.rs     ← 被 service/session 引用(tmux_pane_info)
├── rules.rs        ← (预留——目标态 paneTree 算法可能与 tmux 关联)
└── errors.rs       ← (预留)被 types.rs 构造器使用
```

**关键约束**:
- accessor / types **不** import `models/tmux::*` 以外的函数

## 7. 跨 domain 依赖关系(全局视角)

```
models/cross_cutting/     ← 最底层
       ▲
       │
       ├────►  models/session/        (核心)
       ├────►  models/workspace/      (核心,预留)
       ├────►  models/tmux/           (派生) ← 本 domain
       └────►  models/settings/       (横切)
```

**关键**:
- `models/tmux` 通过 `tmux_pane_info()` 反向依赖 `models/session::SessionInfo`(纯类型构造)
- `models/tmux` 通过 `EnvConfig` 字段引用 `models/settings`(纯类型字段)
- 这是允许的——纯类型引用不是"互相调"

## 8. 设计意图:tmux model 是「tmux 协议层 + controller 的 data shape 投影」

v0 反模式:`models/session.rs` 内含 8 个 tmux 专属类型 + `tmux_pane_info()` helper——1670 行单文件。

v1 边界:
- tmux model 是**独立派生 domain**——与 frontend `model/tmux/` 镜像
- `tmux_pane_info()` 是 tmux domain **唯一**允许构造 `SessionInfo` 的位置——bug 0009 防御
- 跨 service / app / infra 调用通过公开类型(不是字段直读)

## 9. v0 → v1 跨调用迁移

| v0 位置 | v1 改法 |
|---|---|
| `models/session.rs::TmuxCcConfig`(line 291)| `models/tmux/types.rs::TmuxCcConfig` |
| `models/session.rs::AttachedTmuxServer`(line 258)| `models/tmux/types.rs::AttachedTmuxServer` |
| `models/session.rs::tmux_pane_info()`(line 418)| `models/tmux/accessor.rs::tmux_pane_info` |
| `models/session.rs::TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit`(line 481-532)| `models/tmux/types.rs` |
| 所有 `use crate::models::session::TmuxCcConfig` | `use crate::models::tmux::types::TmuxCcConfig` |
| 所有 `use crate::models::session::AttachedTmuxServer` | `use crate::models::tmux::types::AttachedTmuxServer` |
| 所有 `use crate::models::session::tmux_pane_info` | `use crate::models::tmux::accessor::tmux_pane_info` |

## 10. 不允许的依赖

- ❌ `models/tmux/` → `crate::services::*`(model 是最底层)
- ❌ `models/tmux/` → `crate::app::*`
- ❌ `models/tmux/` → `crate::infrastructure::*`
- ❌ `models/tmux/` → `tokio` / `tauri`
- ❌ `models/tmux/types.rs` → `models/session` 的函数(只引用 SessionInfo / SessionType 类型)
- ❌ `models/tmux/` → `models/workspace::*`(workspace 是预留位)
- ❌ `models/tmux/` → `models/settings` 的函数(只引用 EnvConfig 类型)

## 11. 依赖变更流程

1. **新增 TmuxCcConfig 字段** → 加 `types.rs::TmuxCcConfig` 字段 + INTERFACE.md §2.1 + 在 frontend `model/tmux/types.ts` 同步
2. **新增 tmux pane helper** → 加 `accessor.rs` 函数 + INTERFACE.md §2.2
3. **新增 Error 变体** → 加 `errors.rs` 变体(预留)+ INTERFACE.md §2.3
4. **修改 tmux 协议常量**(port / 行数) → 在 types.rs 调整 + 在 service/tmux/wire.rs 同步
5. **迁移类型到 tmux**(从 session 迁入) → 加新 struct + 从 session 删除 → cargo check 全仓