# Service · Workspace — 对外接口

> **位置**：`src-tauri/src/services/workspace/api.rs`
> **唯一进口**：`use crate::services::workspace::*;`
> **MVP 状态**：本 domain 当前**无实现**——本文档描述未来激活时的接口目标

## 1. 对外暴露什么

当前：**无**——`api.rs` 暂未实现。

未来激活时：本 domain 暴露一组 workspace CRUD 函数 + pane tree mutation。

## 2. 核心接口（目标态）

```rust
// 激活时实现的目标接口——非 MVP 范围

use std::sync::Arc;
use dashmap::DashMap;
use crate::models::workspace::{Workspace, Window, PaneNode, PaneId, WindowId, Group};

/// Workspace 中央状态机（预留）
#[allow(dead_code)]
pub struct WorkspaceStore {
    workspaces: DashMap<String, Arc<Workspace>>,  // workspaceId → Workspace
    active_workspace_id: parking_lot::Mutex<Option<String>>,
}

impl WorkspaceStore {
    pub fn new() -> Self;

    // ============ workspace CRUD ============

    pub fn create_workspace(&self, name: String) -> Workspace;
    pub fn rename_workspace(&self, id: &str, name: &str) -> Result<(), String>;
    pub fn delete_workspace(&self, id: &str) -> Result<(), String>;
    pub fn list_workspaces(&self) -> Vec<Workspace>;

    // ============ window CRUD ============

    pub fn create_window(&self, workspace_id: &str) -> Result<Window, String>;
    pub fn close_window(&self, window_id: &WindowId) -> Result<(), String>;
    pub fn focus_window(&self, window_id: &WindowId);

    // ============ pane tree mutation ============

    pub fn split_pane(
        &self,
        pane_id: &PaneId,
        direction: SplitDirection,
        new_session_id: u32,
    ) -> Result<PaneNode, String>;

    pub fn close_pane(&self, pane_id: &PaneId) -> Result<(), String>;

    pub fn move_pane(
        &self,
        pane_id: &PaneId,
        target_parent: &PaneId,
    ) -> Result<(), String>;

    // ============ group CRUD ============

    pub fn create_group(&self, name: String) -> Group;
    pub fn rename_group(&self, group_id: u32, name: &str) -> Result<(), String>;
    pub fn delete_group(&self, group_id: u32) -> Result<(), String>;
    pub fn move_session_to_group(&self, session_id: u32, group_id: u32);

    // ============ 持久化 ============

    pub async fn save(&self, app: &AppHandle) -> Result<(), String>;
    pub async fn load(&self, app: &AppHandle) -> Result<(), String>;
}
```

## 3. 跨 domain 调用接口（目标态）

### 3.1 workspace → session

```rust
// services/workspace/api.rs（未来）
use crate::services::session::SessionManager;

impl WorkspaceStore {
    pub fn split_pane(
        &self,
        pane_id: &PaneId,
        direction: SplitDirection,
        parent_session_id: u32,
        session: &SessionManager,
    ) -> Result<PaneNode, String> {
        // 1. 读 parent_session 判断是否 tmux
        let parent = session.info(parent_session_id)
            .ok_or_else(|| format!("session {parent_session_id} not found"))?;

        // 2. 调 app/terminal/api 创建 tmux pane（如果 parent 是 tmux）
        //    或者 app/session/api 创建 local / ssh session
        //    —— workspace store 不直接调 session create，而是返回新 pane id 给 app 编排
        let new_session_id = /* app 编排 */;

        // 3. 更新 pane tree
        // ...
    }
}
```

**关键**：workspace **不**直接调 `SessionManager::create_*`——由 `app/workspace/api.rs` 编排。这是"service 之间不互相调（除有限组合）"原则。

## 4. 接缝契约

```rust
// src-tauri/src/lib.rs::run() 未来激活时
.manage(Arc::new(WorkspaceStore::new()))
.invoke_handler(app::mod::all_handlers())
```

`all_handlers()` 的 `generate_handler![...]` 列表里加 workspace 的 command（见 `app/workspace/INTERFACE.md` §2 目标态）。

## 5. 不对外暴露

当前 MVP：无任何对外符号。

## 6. api.rs 变更流程

激活后：

1. **新增 workspace IPC 命令** → 加 `app/workspace/commands/*.rs` + 加 `WorkspaceStore::method()` + INTERFACE.md §2 同步
2. **修改命令签名** → 同步更新 `api.rs` + INTERFACE.md §2
3. **删除命令** → 三处一起删除