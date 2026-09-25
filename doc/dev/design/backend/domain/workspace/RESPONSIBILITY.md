# Domain · Workspace — 职责

> **位置**：`src-tauri/src/domain/workspace/`
> **类型**：⭐ 核心 domain — 但 MVP 预留位（backend 无 workspace 状态）
> **Frontend 对应**：[`../../../frontend/service/workspace/RESPONSIBILITY.md`](../../../frontend/service/workspace/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么（目标态）

workspace domain 持有**主视图的所有数据**——workspace 树、window 列表、pane tree、group。paneTree 算法是关键路径，必须 100% 测试覆盖。

承担 4 类职责（目标态）：

1. **workspace 树类型** —— `Workspace / Window / WorkspaceStore`
2. **pane tree 类型** —— `PaneNode`（split / leaf）
3. **group 类型** —— `Group / GroupStore`（前端直存，backend 只持有类型）
4. **paneTree 算法** —— 纯函数规则（`createLeafPane / splitPane / closePane / resizePane / movePane`）

"workspace 状态机"（原 `services/workspace/`）和"workspace 类型 + 算法"（原 `models/workspace/`）分两个目录——合并为 `domain/workspace/`。

## 2. MVP 状态

**MVP 当前无 backend workspace 状态**：

- workspace / window / pane tree / group **完全在 frontend store**（Zustand）
- backend `commands/workspace/` 也是预留位（见 `doc/dev/design/backend/commands/workspace/RESPONSIBILITY.md`）
- 因此 `domain/workspace/` 同样是预留位——空目录 + 3 份 README 占位
- **唯一的现状 MVP 数据**：`Group / GroupStore` —— **砍掉 backend IPC `save_groups / load_groups`，frontend `service/persistence/groups.ts` 直存 `infra/store`**（类型保留供 JSON 序列化目标）

## 3. 这个 domain **不**负责什么

- **不持有运行时状态** —— MVP backend 无状态，frontend 持有
- **不调 IPC** —— MVP 无 commands/workspace/<command>.rs
- **不存 session 元数据** —— 归 `domain/session/`
- **不存 settings 字段** —— 归各归属 module（CapabilityFlags/SizingMode 等 → session，SplitDirection → workspace，LogConfig → persistence）
- **不存 tmux pane 信息** —— 归 `domain/terminal/`

## 4. 子结构（目标态）

```
domain/workspace/
├── types.rs              # Workspace / Window / Group / GroupStore / PaneNode / SplitDirection / PaneBinding
├── rules.rs              # paneTree 算法（createLeafPane / createSplitNode / splitPane / closePane / resizePane）
├── state.rs              # WorkspaceManager（目标态预留，MVP 无实现）
├── errors.rs             # WorkspaceError（thiserror，MVP 预留）
└── *.test.rs             # paneTree 算法必须 100% 覆盖（关键路径）
```

** 文件迁移**：

| 位置 | 位置 |
|—|—|
| `services/workspace/`（预留位，3 份 README） | `domain/workspace/state.rs`（预留）+ `errors.rs` |
| `models/workspace/types.rs` | `domain/workspace/types.rs` |
| `models/workspace/rules.rs`（paneTree 算法） | `domain/workspace/rules.rs` |
| `models/workspace/accessor.rs` | **删除**——纯查询合并到 rules |
| `models/group.rs::Group / GroupStore` | `domain/workspace/types.rs::Group / GroupStore`（group 是 workspace 子集） |

## 5. paneTree 算法（关键路径）

```rust
// rules.rs
use super::types::*;

pub fn create_leaf_pane(window_id: WindowId, pane_id: PaneId, info: SessionInfo) -> PaneNode;

pub fn create_split_node(
    parent: PaneNode,
    new_pane: PaneNode,
    direction: SplitDirection,
    ratio: f32,             // 0.0 - 1.0
) -> PaneNode;

pub fn split_pane(
    tree: &PaneNode,
    pane_id: &PaneId,
    direction: SplitDirection,
    new_pane: PaneNode,
    ratio: f32,
) -> Result<PaneNode, WorkspaceError>;

pub fn close_pane(
    tree: PaneNode,
    pane_id: &PaneId,
) -> Result<(PaneNode, Option<PaneNode>), WorkspaceError>;  // (新树, 被关闭的 pane)

pub fn resize_pane(
    tree: &PaneNode,
    pane_id: &PaneId,
    new_ratio: f32,
) -> Result<PaneNode, WorkspaceError>;

pub fn move_pane(
    tree: PaneNode,
    pane_id: &PaneId,
    target: WindowId,
) -> Result<PaneNode, WorkspaceError>;

pub fn find_pane_node<'a>(tree: &'a PaneNode, pane_id: &PaneId) -> Option<&'a PaneNode>;

pub fn get_leaf_panes(tree: &PaneNode) -> Vec<&PaneNode>;
```

**关键**：

- 所有 paneTree 函数都是**纯函数**——接受 `PaneNode`，返回新 `PaneNode`，**不修改输入**
- 100% 测试覆盖（关键路径，bug 防御）
- PaneNode 是递归 enum（split 内部包含两个 PaneNode）——算法用栈/递归处理

## 6. 跟其他 domain 的关系

| domain | 关系 |
|—|—|
| `domain/session` | workspace 持有 `Vec<SessionId>` 反向引用（纯类型字段）——不调 session manager |
| `domain/terminal` | workspace pane 可指向 tmux pane（`tmux_pane_id: Option<String>` 字段） |
| （已删除——见各归属 domain）| MVP 不调；目标态下 workspace 可能读 settings（如默认 sidebar 宽度） |
| `domain/persistence` | MVP 不调；目标态下可能 backend 持有 workspace 状态（多窗口同步） |

## 7. 跟 commands 的关系

| commands module | 怎么用 domain/workspace |
|—|—|
| `commands/workspace` | 目标态调 `WorkspaceManager::split_pane` / `close_pane` 等——MVP 预留 |
| `commands/shell` | 启动时可能调 `load_last_workspace` —— MVP 不调 |
| `commands/session` | 间接：session 创建后调 `workspace.api::openSession(session_id, pane_id)` 装到 pane |

**关键**：MVP 全部不调——frontend 持有 workspace 状态。

## 10. 关键设计约束

### 10.1 paneTree 算法 100% 测试覆盖

paneTree 是 xsterm 关键路径（split / close / resize / drag 都基于它）——任何修改必须 100% 测试覆盖（参见 `domain/workspace/rules.test.ts` 模板）。

### 10.2 PaneNode 是不可变递归 enum

```rust
pub enum PaneNode {
    Leaf {
        pane_id: PaneId,
        session_id: Option<u32>,
        size: f32,             // 0.0 - 1.0 相对比例
    },
    Split {
        direction: SplitDirection,
        ratio: f32,            // 左/上 pane 占的比例
        first: Box<PaneNode>,
        second: Box<PaneNode>,
    },
}
```

**关键**：所有 mutation 函数返回新 `PaneNode`，旧对象可丢弃（不可变 + zustand store 触发 re-render）。

## 11. 跟 frontend service 的职责分叉

| 维度 | frontend service/workspace | backend domain/workspace（MVP 预留） |
|—|—|—|
| 类型定义 | TS interface | Rust serde struct |
| 状态机 | zustand store（workspace tree + pane tree + group store 都在 frontend） | MVP 无；目标态有 Arc<Mutex> |
| paneTree 算法 | frontend `model/workspace/rules/paneTree.ts` | backend `domain/workspace/rules.rs`（纯函数） |
| IPC 桥 | 不需要（frontend 自己持有状态） | 目标态 backend emit 变更 |

**MVP 阶段**：frontend 持有所有 workspace 状态，backend 0 状态。**backend 仅持有类型 + 算法供未来多窗口同步使用**。

## 12. 跨 module 协调（目标态）

```
commands/session ──► commands/workspace  (openSession 装到 pane)
commands/terminal ──► commands/workspace (tmux pane attach 到 workspace pane)
commands/shell ─────► commands/workspace (loadLastWorkspace)
```

MVP 不调（frontend 编排 workspace 状态）。