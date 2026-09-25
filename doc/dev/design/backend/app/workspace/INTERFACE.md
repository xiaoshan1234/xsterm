# Module · App Workspace — 对外接口

> **位置**：`src-tauri/src/app/modules/workspace/api.rs`
> **唯一进口**：`use crate::app::modules::workspace::api::*;`
> **MVP 状态**：本 module 当前**无 IPC 命令**——本文档描述未来激活时的接口目标

## 1. 对外暴露什么

当前：**无**——`api.rs` 暂未实现。

未来激活时：本 module 暴露一组 `#[tauri::command]` 包装的 workspace CRUD 函数。

## 2. 核心接口（目标态）

```rust
// 激活时实现的目标接口——非 MVP 范围

// pane tree
#[tauri::command]
pub async fn split_pane(
    pane_id: String,
    direction: SplitDirection,
    session_id: u32,
    state: State<'_, Arc<SessionManager>>,
    workspace: State<'_, Arc<WorkspaceStore>>,
) -> Result<PaneNode, String>;

#[tauri::command]
pub async fn close_pane(
    pane_id: String,
    state: State<'_, Arc<SessionManager>>,
    workspace: State<'_, Arc<WorkspaceStore>>,
) -> Result<(), String>;

#[tauri::command]
pub async fn focus_pane(pane_id: String, workspace: State<'_, Arc<WorkspaceStore>>) -> Result<(), String>;

#[tauri::command]
pub async fn move_pane(pane_id: String, target_parent: String, workspace: State<'_, Arc<WorkspaceStore>>) -> Result<(), String>;

// window
#[tauri::command]
pub async fn new_window(state: State<'_, Arc<WorkspaceStore>>) -> Result<WindowId, String>;

#[tauri::command]
pub async fn close_window(window_id: WindowId, state: State<'_, Arc<WorkspaceStore>>) -> Result<(), String>;

#[tauri::command]
pub async fn focus_window(window_id: WindowId, state: State<'_, Arc<WorkspaceStore>>) -> Result<(), String>;

// group
#[tauri::command]
pub async fn create_group(name: String, state: State<'_, Arc<GroupStore>>) -> Result<GroupId, String>;

#[tauri::command]
pub async fn rename_group(group_id: GroupId, name: String, state: State<'_, Arc<GroupStore>>) -> Result<(), String>;

#[tauri::command]
pub async fn delete_group(group_id: GroupId, state: State<'_, Arc<GroupStore>>) -> Result<(), String>;
```

## 3. 跨 module 调用的具体实现（目标态）

```rust
// commands/workspace/tree/split.rs
use crate::app::modules::session::api as session_api;
use crate::app::modules::terminal::api as terminal_api;

#[tauri::command]
pub async fn split_pane(
    pane_id: String,
    direction: SplitDirection,
    parent_session_id: u32,
    state: State<'_, Arc<SessionManager>>,
) -> Result<PaneNode, String> {
    // 1. 读 parent_session 判断是否 tmux
    let parent = state.list().iter().find(|s| s.id == parent_session_id)
        .ok_or_else(|| format!("session {parent_session_id} not found"))?;
    
    let new_session_id = match &parent.session_type {
        SessionType::TmuxCc { .. } => {
            // 调 terminal api
            terminal_api::create_tmux_pane(parent.tmux_controller_id.unwrap(), ..., direction).await?
        }
        _ => {
            // 调 session api
            session_api::create_local_only(LocalSessionConfig { ... }).await?.session_id
        }
    };
    
    // 2. 更新 workspace store
    let mut workspace = state.workspace.lock().await;
    workspace.split(pane_id, direction, new_session_id)
}
```

**关键**：

- workspace **不**直接调 `services/session_manager::create_tmux_pane`——只调 `app/terminal/api::create_tmux_pane`
- workspace 通过 api 边界实现跨 module 编排（与前端 `app/workspace/api.ts` 同构）

## 4. 接缝契约

```rust
// src-tauri/src/lib.rs::run() 未来激活时
.invoke_handler(app::mod::all_handlers())
```

`all_handlers()` 的 `generate_handler![...]` 列表里加 workspace 的 command。

## 5. 不对外暴露

当前 MVP：无任何 IPC 命令。

## 6. api.rs 变更流程

激活后：

1. **新增 workspace IPC 命令** → 加 `commands/<domain>.rs` + 在 `api.rs` 加 wrapper
2. **修改命令签名** → 同步更新 `api.rs` + INTERFACE.md §2
3. **删除命令** → 从 `commands/<domain>.rs` + `api.rs` + `all_handlers()` 一起删除