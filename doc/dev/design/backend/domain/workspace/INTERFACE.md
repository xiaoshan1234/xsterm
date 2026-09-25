# Domain · Workspace — 对外接口

> **位置**：`src-tauri/src/domain/workspace/`
> **唯一进口**：`use crate::domain::workspace::*;`

## 1. 对外暴露什么（目标态）

workspace domain 暴露 3 类符号：

1. **Types**（目标态预留，MVP 不实现）——`Workspace / Window / Group / GroupStore / PaneNode / SplitDirection / PaneBinding`
2. **Rules functions**（paneTree 算法关键路径）——`createLeafPane / createSplitNode / splitPane / closePane / resizePane / movePane / findPaneNode / getLeafPanes`
3. **Error types**（MVP 预留）——`WorkspaceError`

**MVP 状态**：MVP 阶段 backend 不持有 workspace 状态，所有 types + rules 是**目标态设计**——frontend 现在持有 workspace 状态，backend 只在多窗口同步等场景下激活。

## 2. 核心接口：paneTree 算法

```rust
use super::types::*;

pub fn create_leaf_pane(window_id: WindowId, pane_id: PaneId, info: SessionInfo) -> PaneNode;

pub fn create_split_node(
    parent: PaneNode,
    new_pane: PaneNode,
    direction: SplitDirection,
    ratio: f32,
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
) -> Result<(PaneNode, Option<PaneNode>), WorkspaceError>;

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

## 3. Types

```rust
use serde::{Deserialize, Serialize};
use crate::domain::session::SessionInfo;
use crate::domain::settings::SshAuthMethod;
use crate::domain::cross_cutting::{CapabilityFlags, SplitDirection};

// ============ Workspace 树 ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub name: String,
    pub windows: Vec<Window>,
    pub active_window_id: Option<WindowId>,
    pub groups: Vec<Group>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Window {
    pub id: WindowId,
    pub title: String,
    pub root_pane: PaneNode,
    pub session_ids: Vec<u32>,           // 绑定的 session
    pub active_pane_id: Option<PaneId>,
}

// ============ Pane Tree ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PaneNode {
    #[serde(rename = "leaf")]
    Leaf {
        pane_id: PaneId,
        session_id: Option<u32>,
        size: f32,
    },
    #[serde(rename = "split")]
    Split {
        direction: SplitDirection,
        ratio: f32,
        first: Box<PaneNode>,
        second: Box<PaneNode>,
    },
}

// ============ Group ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: GroupId,
    pub name: String,
    pub session_ids: Vec<u32>,
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupStore {
    pub groups: Vec<Group>,
    pub next_group_id: u32,
}

// ============ ID 类型 ============

newtype! { pub struct WorkspaceId(pub String); }
newtype! { pub struct WindowId(pub String); }
newtype! { pub struct PaneId(pub String); }
newtype! { pub struct GroupId(pub String); }
```

## 4. Errors

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("pane not found: {0}")]
    PaneNotFound(String),
    #[error("window not found: {0}")]
    WindowNotFound(String),
    #[error("workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("invalid pane tree structure: {0}")]
    InvalidPaneTree(String),
    #[error("invalid split ratio: {0}")]
    InvalidRatio(f32),
}
```

## 5. 接缝契约

**MVP 阶段**：domain/workspace 不被 commands/workspace 调（commands/workspace 是预留位）。

**目标态调用示例**：

```rust
// commands/workspace/api.rs (目标态)
use crate::domain::workspace::{PaneNode, SplitDirection, WorkspaceError};

pub async fn split_pane_in_window(
    workspace_id: WorkspaceId,
    window_id: WindowId,
    pane_id: PaneId,
    direction: SplitDirection,
    session_info: SessionInfo,
) -> Result<PaneNode, String> {
    let mut tree = load_window_pane_tree(workspace_id, window_id).await?;
    tree = split_pane(&tree, &pane_id, direction, create_leaf_pane(window_id, generate_pane_id(), session_info), 0.5)
        .map_err(|e| e.to_string())?;
    save_window_pane_tree(workspace_id, window_id, &tree).await?;
    Ok(tree)
}
```

## 6. 不对外暴露

- `PaneNode` 内部 Box 字段——通过算法访问（不可变 API）
- `WorkspaceId / WindowId / PaneId / GroupId` 的 String 内部字段——通过 typed accessor
- `tauri` / `tauri-plugin-store` —— workspace MVP 不感知

## 7. api.rs 变更流程

1. **新增 paneTree 算法** → 加 `domain/workspace/rules.rs` 函数 + 100% 测试覆盖 + INTERFACE §2 + frontend model/workspace/rules/paneTree.ts 同步
2. **新增 types 字段** → 加 `domain/workspace/types.rs` 字段 + serde derive + 检查 frontend 类型同步
3. **修改 WorkspaceManager** → ⚠️ 目标态才会发生——MVP 无实现

## 8. 测试

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_leaf_pane_basic() {
        let p = create_leaf_pane("w1".into(), "p1".into(), SessionInfo::default());
        assert!(matches!(p, PaneNode::Leaf { .. }));
    }

    #[test]
    fn split_leaf_creates_split_node() {
        let leaf = create_leaf_pane("w1".into(), "p1".into(), SessionInfo::default());
        let new_leaf = create_leaf_pane("w1".into(), "p2".into(), SessionInfo::default());
        let split = create_split_node(leaf, new_leaf, SplitDirection::Horizontal, 0.5);
        assert!(matches!(split, PaneNode::Split { ratio, .. } if ratio == 0.5));
    }

    #[test]
    fn close_pane_merges_siblings() {
        // 创建 split(leaf1, leaf2) → close leaf1 → 应该返回 leaf2（兄弟合并）
        let tree = create_split_node(
            create_leaf_pane("w1".into(), "p1".into(), SessionInfo::default()),
            create_leaf_pane("w1".into(), "p2".into(), SessionInfo::default()),
            SplitDirection::Horizontal,
            0.5,
        );
        let (new_tree, closed) = close_pane(tree, &"p1".into()).unwrap();
        assert!(matches!(new_tree, PaneNode::Leaf { .. }));
        assert!(closed.is_some());
    }

    // ... 100+ 测试用例覆盖 split / resize / find / edge cases
}
```