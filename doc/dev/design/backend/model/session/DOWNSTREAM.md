# Model · Session — 对下依赖

> **位置**：`src-tauri/src/models/session/`

## 1. 依赖图

```
models/session/
├── types.rs        ────►  models/cross_cutting/types::*       (CapabilityFlags / SplitDirection / SessionLoggingConfig)
├── types.rs        ────►  models/tmux/types::TmuxCcConfig      (tmux-cc 配置)
├── types.rs        ────►  models/settings/types::*            (SizingMode / DisplayConfig / EnvConfig)
├── types.rs        ────►  serde::{Serialize, Deserialize}
├── accessor.rs     ────►  (self-only: SessionInfo)
├── rules.rs        ────►  (self-only: SessionInfo)
└── errors.rs       ────►  thiserror::Error
```

**关键约束**:
- session model **不** import `crate::services::*`
- session model **不** import `crate::app::*`
- session model **不** import `crate::infrastructure::*`
- session model **不** import `tokio` / `tauri`
- session model **允许** import `serde` / `serde_json` / `thiserror` / `derive_more`(纯派生)
- session model **允许** import `models/cross_cutting::*`(横切)
- session model **允许** import `models/tmux::*` 的**纯类型字段**(TmuxCcConfig)
- session model **允许** import `models/settings::*` 的**纯类型字段**(DisplayConfig 等)

## 2. models/cross_cutting

session types 引用以下 cross-cutting 类型:

| 类型 | 用途 |
|---|---|
| `CapabilityFlags` | `SessionInfo::capabilities` 字段 |
| `SplitDirection` | session split 方向(local / ssh / tmux-cc 都用) |
| `SessionLoggingConfig` | `LocalSessionConfig / SSHSessionConfig` 字段 |

**约束**:
- 引用的是**纯类型字段**——不含逻辑
- 引用 `models/cross_cutting::*` 是允许的(因为 cross_cutting 是最底层)

## 3. models/tmux

session types 引用以下 tmux 类型:

| 类型 | 用途 |
|---|---|
| `TmuxCcConfig` | `SessionConfig::TmuxCc(TmuxCcConfig)` 变体 |

**约束**:
- 只引用 `TmuxCcConfig` struct(纯数据)
- 不引用 `tmux_pane_info()` 等 helper(那是 accessor,迁到 models/tmux/accessor.rs)
- 不引用 controller / bridge 等运行时概念

## 4. models/settings

session types 引用以下 settings 类型:

| 类型 | 用途 |
|---|---|
| `SizingMode` | session 布局模式(在 DisplayConfig 内) |
| `DisplayConfig` | runtime display patch |
| `EnvConfig` | 环境变量配置 |

**约束**:
- 只引用 struct 字段(纯数据)
- 不引用 LogConfig(settings 横切关注点是 settings domain 自己)

## 5. serde / thiserror / derive_more

| 依赖 | 何时使用 |
|---|---|
| `serde::{Serialize, Deserialize}` | 所有跨 IPC 边界的类型 |
| `serde_json::Value` | (可选)某些字段用 Value 序列化 |
| `thiserror::Error` | `SessionConfigError / SessionError` derive |
| `derive_more` | (可选)简化 Display / FromStr impl |

**约束**:只使用"纯派生"性质的 crate——不引入网络 / IO / async 依赖。

## 6. std

| 使用 | 何时 |
|---|---|
| `std::collections::HashMap` | EnvConfig.vars |
| `std::sync::atomic::AtomicU32` | SessionIdSource.next_id |
| `std::sync::Arc` | SessionIdSource.new 返回 Arc<Self> |

## 7. 内部依赖关系

```
models/session/
├── types.rs        ← 被 accessor / rules 引用 + 被 service/session 引用
├── accessor.rs     ← 被 service/session 引用(app 偶尔也引用)
├── rules.rs        ← 被 service/session 引用(状态机 mutation)
└── errors.rs       ← 被 types.rs 构造器使用(返回) + service 知道 typed error
```

**关键约束**:
- accessor / rules **只读** types.rs 的类型,**不写**
- accessor / rules **不** import 其他 domain
- errors **只**被 types.rs 的构造器使用

## 8. 跨 domain 依赖关系(全局视角)

```
models/cross_cutting/     ← 最底层(被所有 domain 引用)
       ▲
       │
       ├────►  models/session/        (核心 domain,被 service/session 引用)
       ├────►  models/workspace/      (核心 domain,预留位)
       ├────►  models/tmux/           (派生 domain,被 service/tmux 引用)
       └────►  models/settings/       (横切 domain,被 service/settings 引用)
```

**关键**:
- `models/cross_cutting` 是唯一允许被其他 domain 引用的(横切关注点)
- `models/session` / `models/tmux` / `models/settings` **不互相 import**——它们的引用关系是"types 字段引用"(纯类型不含逻辑)
- `models/workspace` 是预留位——未来激活

## 9. 设计意图:session model 是「backend 数据形状的 70%」

xsterm backend 的 70% 数据形态都在 `models/session/`:
- session 是核心
- tmux-cc 是 session 的变体
- settings 字段是 session 的可选配置
- cross-cutting 类型是 session 必备的( capability flags / split direction )

**这是为什么 session model 的字段最多、最复杂**——其他 domain 都在 session 周围围绕。

## 10. v0 → v1 跨调用迁移

| v0 位置 | v1 改法 |
|---|---|
| `models/session.rs::SessionIdSource`(line 21)| `models/session/types.rs::SessionIdSource`(domain 内部)|
| `models/session.rs::SplitDirection`(line 222)| `models/cross_cutting/types.rs::SplitDirection` |
| `models/session.rs::AttachedTmuxServer`(line 258)| `models/tmux/types.rs::AttachedTmuxServer` |
| `models/session.rs::TmuxCcConfig`(line 291)| `models/tmux/types.rs::TmuxCcConfig` |
| `models/session.rs::tmux_pane_info()`(line 418)| `models/tmux/accessor.rs::tmux_pane_info` |
| `models/session.rs::TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit`(line 481-532)| `models/tmux/types.rs` |
| `models/session.rs::SizingMode / DisplayConfig / EnvConfig`(line 590-671)| `models/settings/types.rs` |
| `models/session.rs::SavedSessionConfigV1 / SavedSessionConfigKind`(line 710-729)| `models/settings/types.rs` |
| `models/session.rs::build_remote_image_path()`(line 1516)| `models/cross_cutting/helpers.rs::build_remote_image_path` |
| 所有 `use crate::models::session::TmuxCcConfig` | `use crate::models::tmux::types::TmuxCcConfig` |
| 所有 `use crate::models::session::SplitDirection` | `use crate::models::cross_cutting::types::SplitDirection` |

## 11. 不允许的依赖

- ❌ `models/session/` → `crate::services::*`(model 是最底层)
- ❌ `models/session/` → `crate::app::*`
- ❌ `models/session/` → `crate::infrastructure::*`
- ❌ `models/session/` → `tokio` / `tauri`
- ❌ `models/session/accessor.rs` → `models/session/rules.rs`(accessor 是纯查询,不依赖 mutation)
- ❌ `models/session/` → `models/workspace::*`(workspace 是预留位,无内部)
- ❌ `models/session/types.rs` → `models/tmux/accessor.rs`(只引用纯类型字段,不引用函数)
- ❌ `models/session/types.rs` → `models/settings/accessor.rs`(同上)

## 12. 依赖变更流程

1. **新增 SessionInfo 字段** → 加 `types.rs::SessionInfo` 字段 + INTERFACE.md §2.1 + 在 frontend `model/session/types.ts` 同步
2. **新增构造器** → 加 `impl XxxConfig { try_new() }` + INTERFACE.md §3 + 新 SessionConfigError 变体(如有)
3. **新增 accessor function** → 加 `accessor.rs` 函数 + INTERFACE.md §2.2
4. **新增 rules function** → 加 `rules.rs` 函数 + INTERFACE.md §2.3
5. **新增 Error 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.4 + 检查所有 `?` 调用方
6. **迁移类型到其他 domain** → 在新 domain 加 struct + 从 session 删除 → 在本 README §10 同步 + cargo check 全仓