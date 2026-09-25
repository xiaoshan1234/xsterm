# Model · Cross-Cutting — 对下依赖

> **位置**：`src-tauri/src/models/cross_cutting/`

## 1. 依赖图

```
models/cross_cutting/
├── types.rs        ────►  serde::{Serialize, Deserialize}        (纯派生)
├── types.rs        ────►  std                                  (基础类型)
├── helpers.rs      ────►  std::time::{SystemTime, UNIX_EPOCH}   (system time 读取)
├── helpers.rs      ────►  std                                  (string formatting)
├── ids.rs          ────►  std::sync::atomic::{AtomicU32, Ordering}  (预留)
└── constants.rs    ────►  (no deps — pure constants)             (预留)
```

**关键约束**:
- cross-cutting **不** import `crate::models::{session,workspace,tmux,settings}` 的**任何东西**(最底层)
- cross-cutting **不** import `crate::services::*`
- cross-cutting **不** import `crate::app::*`
- cross-cutting **不** import `crate::infrastructure::*`
- cross-cutting **不** import `tokio` / `tauri`
- cross-cutting **只** import `serde` / `std`(纯基础 + 派生)

## 2. serde / serde_json / thiserror

| 依赖 | 何时使用 |
|---|---|
| `serde::{Serialize, Deserialize}` | 所有跨 IPC 边界的类型 |
| `serde_json` | (可选)某些字段 |
| `thiserror::Error` | (预留)cross-cutting 引入 typed error 时 |

**约束**:只使用"纯派生"性质的 crate。

## 3. std

| 使用 | 何时 |
|---|---|
| `std::time::{SystemTime, UNIX_EPOCH}` | `build_remote_image_path()` 内部 |
| `std::sync::atomic::{AtomicU32, Ordering}` | (预留)`ids.rs` 内部 |
| `String` / `Vec` / `Option` / `HashMap` | 类型字段 |
| `bool` / `u32` / `u64` / `usize` | 数字字段 |

## 4. 内部依赖关系

```
models/cross_cutting/
├── types.rs        ← 被所有 model domain 引用 + 被 service / app / infra 引用
├── helpers.rs      ← 被 service(ssh / session) + infrastructure(ssh) 引用
├── ids.rs          ← (预留)被 service 引用
└── constants.rs    ← (预留)被 service / app 引用
```

**关键约束**:
- types / helpers **不** import 其他 model domain(最底层)
- types / helpers **不** import service / app / infrastructure

## 5. 跨 domain 依赖关系(全局视角)

```
models/cross_cutting/     ← 最底层(被所有 domain 引用) ← 本 domain
       ▲
       │
       ├────►  models/session/        (核心)
       ├────►  models/workspace/      (核心,预留)
       ├────►  models/tmux/           (派生)
       └────►  models/settings/       (横切)
```

**关键**:
- cross-cutting 是**唯一**被所有 5 个 domain 引用的 layer
- cross-cutting 是**唯一**不引用任何其他 model domain 的 layer
- cross-cutting 与 settings 都是"横切"——但 cross-cutting 是最底层(被引用),settings 是平级(互相不引用)

## 6. 设计意图:cross-cutting 是「backend model 的最底层边界」

xsterm backend 的 `models/` 分为 5 业务 + 1 横切(共 6 domain)。

**cross-cutting 的特殊性**:
- 是**唯一**被其他 5 个 domain 引用的 layer
- 是**唯一**不引用任何其他 model domain 的 layer
- 是 backend model 的**最底层边界**——任何想"通用化"的纯类型 / 算法都进这里

**为什么 helpers 也在 model 而不是 service**:
- `build_remote_image_path()` 是**纯函数**——输入 filename,输出 path,无 IO 无状态
- `tmux_probe_quote()` 是**纯函数**——输入 string,输出 quoted string
- service 是"持有状态 + 编排"——pure function 应在 model

**为什么 CapabilityFlags 在 model**:
- 是**纯数据**(5 个 bool 字段)
- 3 种 backend(local / ssh / tmux)都用同一 struct
- 是 backend session 跨 IPC 边界的元数据

## 7. v0 → v1 跨调用迁移

| v0 位置 | v1 改法 |
|---|---|
| `models/capabilities.rs::CapabilityFlags`(整个文件) | `models/cross_cutting/types.rs::CapabilityFlags` |
| `models/capabilities.rs::for_local() / for_ssh() / for_tmux()` | `models/cross_cutting/types.rs` 同名 |
| `models/session.rs::SplitDirection`(line 222)| `models/cross_cutting/types.rs::SplitDirection` |
| `models/session.rs::SessionLoggingConfig`(line 564)| `models/cross_cutting/types.rs::SessionLoggingConfig` |
| `models/session.rs::build_remote_image_path()`(line 1516)| `models/cross_cutting/helpers.rs::build_remote_image_path` |
| `services/tmux_session/controller/mod.rs::tmux_probe_quote()` | `models/cross_cutting/helpers.rs::tmux_probe_quote`(pure helper 应在 model)|
| 所有 `use crate::models::session::SplitDirection` | `use crate::models::cross_cutting::types::SplitDirection` |
| 所有 `use crate::models::session::SessionLoggingConfig` | `use crate::models::cross_cutting::types::SessionLoggingConfig` |
| 所有 `use crate::models::capabilities::CapabilityFlags` | `use crate::models::cross_cutting::types::CapabilityFlags` |
| 所有 `use crate::models::session::build_remote_image_path` | `use crate::models::cross_cutting::helpers::build_remote_image_path` |
| `commands/session.rs::MAX_WRITE_PAYLOAD_BYTES`(line 17)| 预留→ `models/cross_cutting/constants.rs::MAX_WRITE_PAYLOAD_BYTES`(未来) |

## 8. 不允许的依赖

- ❌ `models/cross_cutting/` → `crate::models::session::*`(最底层)
- ❌ `models/cross_cutting/` → `crate::models::workspace::*`
- ❌ `models/cross_cutting/` → `crate::models::tmux::*`
- ❌ `models/cross_cutting/` → `crate::models::settings::*`
- ❌ `models/cross_cutting/` → `crate::services::*`
- ❌ `models/cross_cutting/` → `crate::app::*`
- ❌ `models/cross_cutting/` → `crate::infrastructure::*`
- ❌ `models/cross_cutting/` → `tokio` / `tauri`
- ❌ `models/cross_cutting/` → `crate::logging_setup::*`(`LogConfig` 是 settings 关注,不归 cross-cutting)

## 9. 依赖变更流程

1. **新增 CapabilityFlags 字段** → 加 `types.rs` 字段 + INTERFACE.md §2.1 + frontend `model/cross-cutting/types.ts` 同步
2. **新增 helper function** → 加 `helpers.rs` 函数 + INTERFACE.md §2.2 + 加纯函数测试
3. **新增 SplitDirection 变体** → 加 `types.rs` 变体 + `as_tmux_arg()` 更新 + 检查所有 `match SplitDirection` 调用方
4. **从其他 domain 迁入类型** → 加新 struct + 旧 domain 删 → cargo check 全仓
5. **新增常量**(未来) → 加 `constants.rs` 常量 + 在 service / app / infra 引用 + INTERFACE.md §2.4

## 10. 强制约束(可机械校验)

```bash
# cross-cutting 不 import 其他 model domain
grep -rn 'use crate::models::\(session\|workspace\|tmux\|settings\)::' src-tauri/src/models/cross_cutting/
# 必须为空

# cross-cutting 不 import service / app / infra
grep -rn 'use crate::\(services\|app\|infrastructure\)' src-tauri/src/models/cross_cutting/
# 必须为空

# cross-cutting 不 import tokio / tauri
grep -rn 'use \(tokio\|tauri\)' src-tauri/src/models/cross_cutting/
# 必须为空
```

## 11. 跟其他 domain 的关系总览

| from \ to | session | workspace | tmux | settings | cross_cutting |
|---|---|---|---|---|---|
| **session** | self | ❌(纯类型字段引用 workspaceId 允许,但 workspace 预留) | ✅(TmuxCcConfig 字段) | ✅(DisplayConfig 字段) | ✅(SplitDirection / CapabilityFlags / SessionLoggingConfig)|
| **workspace** | ❌(预留) | self | ❌ | ❌ | ✅(SplitDirection)|
| **tmux** | ✅(SessionInfo / SessionType 返回) | ❌ | self | ✅(EnvConfig 字段) | ✅(CapabilityFlags) |
| **settings** | ✅(SavedSessionConfigKind 变体) | ❌ | ✅(SavedSessionConfigKind 变体) | self | ❌ |
| **cross_cutting** | ❌ | ❌ | ❌ | ❌ | self |

**关键观察**:
- cross_cutting 是**唯一被所有 4 个业务 domain 引用的 layer**
- settings 与 cross_cutting **互相不引用**(平级横切 domain)
- session / tmux / settings 通过**纯类型字段引用**互相联系(含 model/session 是 tmux 的反向引用入口)
- workspace 是预留位——MVP 无内部