# Model · Workspace — 对外接口

> **位置**：`src-tauri/src/models/workspace/`
> **唯一进口**：`use crate::models::workspace::*;`
> **MVP 状态**：本 domain 当前**只实现 Group / GroupStore**——其他类型预留位等激活

## 1. 对外暴露什么

workspace domain 暴露 3 类符号:

1. **Types**——`Group / GroupStore`(MVP);`Workspace / Window / PaneNode / PaneTree`(预留)
2. **Accessor functions**(MVP 阶段预留)
3. **Rules functions**(MVP 阶段预留)

## 2. 核心接口

### 2.1 MVP 类型(MVP 已实现)

```rust
// models/workspace/types.rs(MVP 阶段)
use serde::{Deserialize, Serialize};

/// 用户自定义的 session 分组(侧边栏)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionGroup {
    pub id: u32,
    pub name: String,
    pub session_ids: Vec<u32>,
    #[serde(rename = "collapsed")]
    pub is_collapsed: bool,
}

/// 持久化的 group 存储(包含 next_id 分配器)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupStore {
    pub groups: Vec<SessionGroup>,
    pub next_group_id: u32,
}

impl Default for GroupStore {
    fn default() -> Self {
        Self { groups: vec![], next_group_id: 1 }
    }
}
```

### 2.2 目标态类型(预留位,等 workspace domain 激活)

```rust
// 激活时实现的目标接口——非 MVP 范围

pub struct Workspace {
    pub id: WorkspaceId,           // = String (UUID)
    pub name: String,
    pub window_ids: Vec<WindowId>,
    pub active_window_id: Option<WindowId>,
    pub sidebar_width: Option<i32>,
}

pub struct Window {
    pub id: WindowId,              // = String (UUID)
    pub workspace_id: WorkspaceId,
    pub pane_tree: PaneNode,
    pub active_pane_id: Option<PaneId>,
    pub title: String,
}

pub enum PaneNode {
    Leaf { id: PaneId, session_id: u32, parent_split: Option<Box<SplitNode>> },
    Split { direction: SplitDirection, children: Vec<PaneNode>, parent_split: Option<Box<SplitNode>> },
}

// PaneId / WindowId / WorkspaceId 是 newtype
pub struct PaneId(String);
pub struct WindowId(String);
pub struct WorkspaceId(String);

pub type PaneTree = PaneNode;  // PaneNode 是递归的
```

### 2.3 MVP Accessor functions

```rust
// models/workspace/accessor.rs(MVP 阶段——可为空)
```

### 2.4 MVP Rules functions

```rust
// models/workspace/rules.rs(MVP 阶段——可为空)
```

### 2.5 目标态 Accessor + Rules(预留位)

```rust
// 激活时实现的目标接口

// accessor
pub fn find_pane_node(tree: &PaneTree, pane_id: &PaneId) -> Option<&PaneNode>;
pub fn get_leaf_panes(tree: &PaneTree) -> Vec<&PaneNode>;
pub fn get_windows_by_workspace(windows: &[Window], workspace_id: &WorkspaceId) -> Vec<&Window>;

// rules(纯函数,不可变,返回新对象)
pub fn create_window(workspace: &Workspace, new_window: Window) -> Workspace;
pub fn close_window(workspace: &Workspace, window_id: &WindowId) -> Workspace;
pub fn split_pane(
    tree: &PaneTree,
    pane_id: &PaneId,
    direction: SplitDirection,
    new_session_id: u32,
) -> PaneTree;
pub fn close_pane(tree: &PaneTree, pane_id: &PaneId) -> PaneTree;
pub fn move_pane(tree: &PaneTree, pane_id: &PaneId, target_parent: &PaneId) -> PaneTree;
pub fn resize_pane(tree: &PaneTree, pane_id: &PaneId, rows: u16, cols: u16) -> PaneTree;
pub fn add_group(store: &GroupStore, name: String) -> GroupStore;
pub fn move_session_to_group(store: &GroupStore, group_id: u32, session_id: u32) -> GroupStore;
```

## 3. 跨 domain 类型引用(MVP)

```rust
// models/workspace/types.rs
use crate::models::cross_cutting::types::SplitDirection;  // 预留——目标态才用

// MVP 阶段 types.rs 不引用 cross_cutting(只引用 serde)
```

## 4. 接缝契约(MVP)

```rust
// commands/persistence.rs(MVP 现状,v4 改为 app/settings/commands/persistence/groups.rs)
use crate::models::workspace::GroupStore;

#[tauri::command]
pub async fn save_groups(store_data: GroupStore, app: AppHandle) -> Result<(), String> {
    // ...
}

#[tauri::command]
pub async fn load_groups(app: AppHandle) -> Result<GroupStore, String> {
    // ...
}
```

**关键**:MVP 阶段 `commands/persistence.rs` 已经用 `GroupStore`——v4 把它迁到 `models/workspace/types.rs::GroupStore`。

## 5. 强制约束(可机械校验)

```bash
# models/workspace 不 import service / app / infra
grep -rn 'use crate::\(services\|app\|infrastructure\)' src-tauri/src/models/workspace/
# 必须为空

# models/workspace 不 import tokio / tauri
grep -rn 'use \(tokio\|tauri\)' src-tauri/src/models/workspace/
# 必须为空
```

## 6. api.rs 变更流程

激活后:

1. **新增 Workspace 字段** → 加 `types.rs::Workspace` 字段 + §2.2 + 在 frontend `model/workspace/types.ts` 同步
2. **新增 paneTree 算法** → 加 `rules.rs` 函数 + 100% 测试覆盖
3. **新增 IPC 命令**(未来) → 加 `app/workspace/commands/*.rs` + 在 `app/workspace/INTERFACE.md` 同步

## 7. 错误传播约定(MVP)

MVP 阶段 `GroupStore` 不引入 typed error——是简单数据结构,不需要校验。激活后构造器返回 `Result<Self, WorkspaceConfigError>`。