# Model · Workspace — 对下依赖

> **位置**：`src-tauri/src/models/workspace/`
> **MVP 状态**：当前只实现 Group / GroupStore,其他预留

## 1. 依赖图

```
models/workspace/
├── types.rs        ────►  models/cross_cutting/types::SplitDirection     (预留——目标态才用)
├── types.rs        ────►  serde::{Serialize, Deserialize}                (MVP 已用)
├── accessor.rs     ────►  (预留——MVP 阶段可空)
└── rules.rs        ────►  (预留——MVP 阶段可空)
```

**关键约束**:
- workspace model **不** import `crate::services::*`
- workspace model **不** import `crate::app::*`
- workspace model **不** import `crate::infrastructure::*`
- workspace model **不** import `tokio` / `tauri`

## 2. models/cross_cutting

| 引用 | 何时 |
|---|---|
| `SplitDirection` enum | 目标态 `PaneNode::Split { direction, ... }` 字段(MVP 不用)|

**约束**:workspace 引用 `models/cross_cutting::*` 的纯类型字段是允许的。

## 3. models/session

**workspace 不引用 session model**——workspace 通过 `PaneNode::Leaf::session_id` 字段间接引用 session id(u32),但这个字段不是 SessionInfo 类型,所以不构成依赖。

**未来**:如果 workspace 的 `PaneNode::Leaf` 加 session 元数据快照(优化渲染),可能引用 `SessionInfo` 字段——这是允许的(纯类型引用)。

## 4. serde / serde_json / thiserror

| 依赖 | 何时使用 |
|---|---|
| `serde::{Serialize, Deserialize}` | `GroupStore / SessionGroup`(MVP 已用);`Workspace / Window / PaneNode`(目标态)|
| `serde_json` | (可选)某些字段 |
| `thiserror` | (目标态)`WorkspaceConfigError` derive |

## 5. std

| 使用 | 何时 |
|---|---|
| `String` / `Vec` / `Option` | 所有 container 字段 |
| `u32` / `u16` | id / 数字字段 |

## 6. 内部依赖关系(目标态)

```
models/workspace/
├── types.rs        ← 被 accessor / rules 引用 + 被 service/workspace 引用
├── accessor.rs     ← 被 service/workspace 引用(app 偶尔也引用)
├── rules.rs        ← 被 service/workspace 引用(状态机 mutation)
└── errors.rs       ← (目标态)被 types.rs 构造器使用
```

**关键约束**:
- accessor / rules **只读** types.rs 的类型,**不写**
- accessor / rules **不** import 其他 domain

## 7. 跨 domain 依赖关系(全局视角)

参考 `models/session/DOWNSTREAM.md` §8——workspace 是 6 个 domain 之一,处于"核心"位置。

```
models/cross_cutting/     ← 最底层(被所有 domain 引用)
       ▲
       │
       ├────►  models/session/        (核心)
       ├────►  models/workspace/      (核心,预留位)
       ├────►  models/tmux/           (派生)
       └────►  models/settings/       (横切)
```

**关键**:
- `models/workspace` 与 `models/session` 互相**不** import 函数——它们的关系是"PaneNode::Leaf::session_id 字段引用"
- `models/workspace` 与 `models/tmux` 互相**不** import——workspace 检测 tmux 由 app/workspace 编排
- `models/workspace` 与 `models/settings` 互相**不** import——layout 由 frontend store 维护

## 8. 设计意图:workspace model 是「frontend paneTree 算法的镜像」

xsterm MVP 的 workspace 状态完全在 frontend store(用 `model/workspace/rules/paneTree.ts` 实现 split / close / resize 算法)。

v1 backend `models/workspace/rules.rs` 是**预留位**——等"多窗口同步"或"server-side persistence"出现时,把 frontend 的 paneTree 算法**镜像**到 backend(Rust)。

**为什么镜像**:
- 前端 paneTree 是 frontend-only(被 ui/workspace 渲染)
- 后端 paneTree 可能是 multi-window sync 的 source of truth
- 两边算法必须**严格一致**——否则跨窗口同步会出 divergence

## 9. v0 → v1 跨调用迁移

| v0 现状 | v1 改法 |
|---|---|
| `models/group.rs::SessionGroup / GroupStore` | `models/workspace/types.rs::SessionGroup / GroupStore` |
| 所有 `use crate::models::group::*` | `use crate::models::workspace::types::*` |
| `commands/persistence.rs::save_groups / load_groups` | `commands/persistence.rs` 不动 + `services/persistence/groups.rs::save_groups_typed / load_groups_typed` |
| `services/persistence/groups.rs` import | `use crate::models::workspace::GroupStore` |

## 10. 不允许的依赖

- ❌ `models/workspace/` → `crate::services::*`(model 是最底层)
- ❌ `models/workspace/` → `crate::app::*`
- ❌ `models/workspace/` → `crate::infrastructure::*`
- ❌ `models/workspace/` → `tokio` / `tauri`
- ❌ `models/workspace/` → `models/session::*` 函数 / trait(纯类型字段引用允许)
- ❌ `models/workspace/` → `models/tmux::*` 函数 / trait
- ❌ `models/workspace/` → `models/settings::*` 函数 / trait

## 11. 依赖变更流程

1. **新增 SessionGroup 字段** → 加 `types.rs::SessionGroup` 字段 + 在 frontend `model/workspace/types.ts` 同步
2. **新增 GroupStore 字段** → 加 `types.rs::GroupStore` 字段 + 在 commands/persistence.rs 同步
3. **激活 workspace 类型** → 加 `types.rs::Workspace / Window / PaneNode` + 在 frontend + service 同步
4. **激活 paneTree 算法** → 加 `rules.rs` 函数 + 100% 测试覆盖 + service/workspace store 调用
5. **新增 IPC 命令**(未来) → 加 `app/workspace/commands/*.rs`