# Model · Workspace — 职责

> **位置**：`src-tauri/src/models/workspace/`
> **类型**：⭐ 核心 domain — 但 MVP 预留位(backend 无 workspace 状态)
> **Frontend 对应**：[`../../../frontend/model/workspace/RESPONSIBILITY.md`](../../../frontend/model/workspace/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么(目标态)

workspace model 定义 **主视图的所有数据形态**——workspace 树、window 列表、pane tree、group。

承担 4 类职责(目标态):

1. **workspace 树类型**——`Workspace / Window / WorkspaceStore`
2. **pane tree 类型**——`PaneNode`(split / leaf)
3. **group 类型**——`Group / GroupStore`(从 v0 `models/group.rs` 迁入)
4. **paneTree 算法**——纯函数规则(`createLeafPane / splitPane / closePane / resizePane / movePane`)——**关键路径,100% 覆盖**

## 2. MVP 状态

**MVP 当前无 backend workspace 状态**:

- workspace / window / pane tree / group **完全在 frontend store**(Zustand)
- backend `services/workspace/` 是预留位(见 `doc/dev/design/backend/service/workspace/RESPONSIBILITY.md`)
- 因此 `models/workspace/` 同样是预留位——空目录 + 3 份 README 占位
- **唯一的现状 MVP 数据**:`Group / GroupStore`(在 `models/group.rs`)—— backend 的 `commands/persistence.rs::save_groups / load_groups` IPC 需要它们

## 3. 子结构(目标态)

```
models/workspace/
├── mod.rs               re-export types / accessor / rules
├── types.rs             Workspace / Window / PaneNode / Group / GroupStore / SplitDirection
├── accessor.rs          findPaneNode / getLeafPanes / getWindowsByWorkspace
└── rules.rs             createWindow / createLeafPane / splitPane / closePane / movePane / resizePane
```

**关键**:MVP 阶段 `types.rs` 只实现 `Group / GroupStore`(从 v0 迁入);其他类型预留位等 workspace domain 激活。

## 4. v0 → v1 拆分映射

| v0 位置 | v1 位置 | 改动 |
|---|---|---|
| `models/group.rs::SessionGroup / GroupStore` | `models/workspace/types.rs` | 迁入——group 是 workspace 子集 |

**v0 `models/group.rs` 的 18 行内容**全部迁到 `models/workspace/types.rs::Group / GroupStore`。

## 5. 跟其他 model domain 的关系

| domain | 关系 |
|---|---|
| `models/session` | session 持有反向引用 `workspaceId / windowId / paneId`(**纯类型字段**——来自本 domain)|
| `models/tmux` | workspace pane split 检测 tmux 时引用 `models/tmux::types::SessionType::TmuxCc`(纯类型字段)|
| `models/settings` | workspace **不依赖** settings(layout 由 frontend store) |
| `models/cross_cutting` | workspace 引用 `SplitDirection`(来自 cross_cutting) |

**关键约束**:
- workspace model **不** import 其他 domain 的**函数 / trait**(纯类型字段允许)
- workspace model **不** import `services/*` / `app/*` / `infrastructure/*`

## 6. 跟 service / app 的关系

| 层 | 怎么用 models/workspace |
|---|---|
| `services/workspace` (预留) | workspace store 持有 `Workspace / Window / PaneNode` 作为 value 类型 |
| `app/workspace` (预留) | `Workspace` / `GroupStore` 作为 IPC 入参 / 返回类型 |
| `commands/persistence.rs` (MVP) | `load_groups / save_groups` 接收 `GroupStore` 作为 IPC 类型 |

**关键**:MVP 阶段 `commands/persistence.rs` 已经用 `GroupStore`——v1 把它迁到 `models/workspace/types.rs`。

## 7. 这个 domain 的"产品语言"术语

- **workspace** —— 一组 windows + 侧栏配置
- **window** —— workspace 内的标签页
- **pane** —— window 内的分屏节点(leaf 或 split)
- **pane tree** —— pane 的嵌套结构
- **group** —— workspace 内的 session 分组(`SessionGroup { id, name, session_ids, is_collapsed }`)
- **GroupStore** —— 持久化的 group 列表 + next_group_id 分配器
- **active workspace / window / pane** —— 当前聚焦

## 8. 关键设计约束(目标态)

### 8.1 paneTree 算法必须 100% 测试覆盖

```rust
// models/workspace/rules.rs(目标态)
pub fn split_pane(
    pane_id: &PaneId,
    direction: SplitDirection,
    pane_tree: &PaneTree,
    new_session_id: u32,
) -> PaneTree {
    // 纯函数:返回新 pane tree,旧对象不变
}

pub fn close_pane(pane_id: &PaneId, pane_tree: &PaneTree) -> PaneTree {
    // 纯函数
}
```

**为什么 100%**:paneTree 是 xsterm 关键路径——split / close / resize / drag 都基于它。model 出 bug = 全 app 出 bug。

### 8.2 group 是 workspace 的子集(不是独立 domain)

跟 frontend 一致——group 并入 workspace。

**理由**:group 的生命周期跟 workspace 绑定,跨 workspace 不共享 group。独立成 model 是过度切分。

### 8.3 types.rs 必须 Serialize + Deserialize

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupStore {
    pub groups: Vec<SessionGroup>,
    pub next_group_id: u32,
}
```

### 8.4 构造器返回 Result<Self, ConfigError>

未来 workspace 字段加多后,构造器必须返回 `Result<Self, WorkspaceConfigError>`(typed error)。

## 9. MVP 触发激活场景

满足**任一**条件时,workspace domain 从占位升级为实装:

| 条件 | 说明 |
|---|---|
| 多窗口同步 | 两个 Tauri window 共享 pane 树——backend 必须持有 source of truth |
| Server-side persistence | workspace 状态写到 `workspace.json` 而非 frontend store |
| Workspace 导入导出 | 整组 workspace 打包成 tarball |
| Workspace 模板 | 用户保存 workspace 模板供后续复用 |

## 10. 强制约束(可机械校验)

```bash
# models/workspace 不 import service / app / infra
grep -rn 'use crate::\(services\|app\|infrastructure\)' src-tauri/src/models/workspace/
# 必须为空

# models/workspace 不 import tokio / tauri
grep -rn 'use \(tokio\|tauri\)' src-tauri/src/models/workspace/
# 必须为空
```

## 11. 跟 v0 的差异

| 维度 | v0 | v1 |
|---|---|---|
| domain 存在 | ❌ 无(group 在 `models/group.rs` 平铺) | ✅ 子目录预留位 |
| group 归属 | `models/group.rs` 平铺(18 行) | `models/workspace/types.rs` |
| workspace / window / pane 类型 | ❌ 不存在 | 预留位等激活 |
| paneTree 算法 | ❌ 不存在(在 frontend `model/workspace/rules/paneTree.ts`) | 预留位等激活 |
| 与 frontend model 镜像 | ❌ 不存在 | ✅ `models/workspace/` ↔ `model/workspace/` |

## 12. 依赖变更流程

激活后:

1. **新增 Workspace / Window / PaneNode 类型** → 加 `types.rs` struct + §2 + frontend `model/workspace/types.ts` 同步
2. **新增 paneTree 算法** → 加 `rules.rs` 函数 + 100% 测试覆盖 + service/workspace store 调用
3. **新增 IPC 命令**(未来) → 加 `app/workspace/commands/*.rs` + 在 `app/workspace/INTERFACE.md` 同步