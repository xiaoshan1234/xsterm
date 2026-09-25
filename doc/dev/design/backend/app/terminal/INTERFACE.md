# Module · App Terminal — 对外接口

> **位置**：`src-tauri/src/app/modules/terminal/api.rs`（落地 `src-tauri/src/commands/terminal.rs`）
> **唯一进口**：`use crate::app::modules::terminal::api::*;`

## 1. 对外暴露什么

terminal module 暴露 **15 个 `#[tauri::command]`**，按 tmux 子系统分 4 类：

- session lifecycle (4)
- pane 操作 (4)
- window 操作 (3)
- server 管理 (4)

无 preferences IPC——见 `RESPONSIBILITY.md` §7。

## 2. 核心接口

### 2.1 tmux session lifecycle

```rust
use crate::infrastructure::app_backend::AppBackend;
use crate::models::session::{TmuxCcConfig, TmuxSessionInit};
use crate::services::session_manager::{SessionManager, AutoAttachOutcome};

// ============ pure functions（被 commands/tmux/session.rs 调用）============

/// 创建 tmux -CC controller
pub async fn create_tmux(
    state: &SessionManager,
    backend: Arc<dyn AppBackend>,
    config: &TmuxCcConfig,
) -> Result<TmuxSessionInit, String>;

/// attach 到已存在 tmux server
pub async fn attach_tmux(
    state: &SessionManager,
    backend: Arc<dyn AppBackend>,
    config: &TmuxCcConfig,
) -> Result<TmuxSessionInit, String>;

/// 探测 tmux server 是否存在
pub async fn probe_tmux_session_exists(
    state: &SessionManager,
    config: &TmuxCcConfig,
) -> Result<bool, String>;

/// 启动时自动 attach 持久化列表
pub async fn auto_attach_tmux_servers(
    state: &SessionManager,
    backend: Arc<dyn AppBackend>,
    servers: &[AttachedTmuxServer],
) -> Vec<AutoAttachOutcome>;

// ============ #[tauri::command] wrappers ============

#[tauri::command]
pub async fn create_tmux_session(
    config: TmuxCcConfig,
    state: State<'_, Arc<SessionManager>>,
    backend: State<'_, Arc<RealAppBackend>>,
    app: AppHandle,
) -> Result<TmuxSessionInit, String>;
// ↑ 成功后触发 settings_api::save_attached_tmux_servers（best-effort）

#[tauri::command]
pub async fn attach_tmux_session(
    config: TmuxCcConfig,
    state: State<'_, Arc<SessionManager>>,
    backend: State<'_, Arc<RealAppBackend>>,
    app: AppHandle,
) -> Result<TmuxSessionInit, String>;
// ↑ 成功后触发 settings_api::save_attached_tmux_servers

#[tauri::command]
pub async fn probe_tmux_session_exists(
    config: TmuxCcConfig,
    state: State<'_, Arc<SessionManager>>,
) -> Result<bool, String>;
// ↑ 前端 Create Session dialog 用来判定 create vs attach

#[tauri::command]
pub async fn auto_attach_tmux_servers(
    state: State<'_, Arc<SessionManager>>,
    backend: State<'_, Arc<RealAppBackend>>,
    app: AppHandle,
) -> Result<Vec<AutoAttachOutcome>, String>;
// ↑ 前端启动时调用一次；servers 来自 settings_api::load_attached_tmux_servers
```

### 2.2 tmux pane 操作

```rust
/// 前端 split-window 时调用 —— parent 是 tmux pane
#[tauri::command]
pub async fn create_tmux_pane(
    controller_id: u32,
    parent_tmux_pane_id: String,
    direction: String,  // "horizontal" | "vertical"
    state: State<'_, Arc<SessionManager>>,
) -> Result<SessionInfo, String>;
// ↑ controller_id + tmux_pane_id 是 server-side identifier（不是 xsterm session id）
// ↑ 返回的 SessionInfo 是新 pane 的 xsterm session id

#[tauri::command]
pub async fn kill_tmux_pane(
    controller_id: u32,
    tmux_pane_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String>;
// ↑ 实际生效靠 controller 发 %pane-exited 事件 → 前端 listener drop Session

#[tauri::command]
pub async fn resize_tmux_pane(
    controller_id: u32,
    tmux_pane_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String>;

#[tauri::command]
pub async fn capture_tmux_pane(
    controller_id: u32,
    tmux_pane_id: String,
    lines: i32,
    state: State<'_, Arc<SessionManager>>,
) -> Result<String, String>;
// ↑ 返回 scrollback 文本
```

### 2.3 tmux window 操作

```rust
#[tauri::command]
pub async fn create_tmux_window(
    controller_id: u32,
    name: Option<String>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<SessionInfo, String>;
// ↑ name=None 让 tmux 选默认名（基于运行命令）

#[tauri::command]
pub async fn kill_tmux_window(
    controller_id: u32,
    tmux_window_id: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String>;

#[tauri::command]
pub async fn rename_tmux_window(
    controller_id: u32,
    tmux_window_id: String,
    new_name: String,
    state: State<'_, Arc<SessionManager>>,
) -> Result<(), String>;
```

### 2.4 tmux server 管理

```rust
/// 列出当前 attach 的 tmux server（projection of SessionManager::tmux_controllers）
#[tauri::command]
pub async fn get_attached_tmux_servers(
    state: State<'_, Arc<SessionManager>>,
) -> Result<Vec<AttachedTmuxServer>, String>;

/// detach controller（保留 tmux server 进程）
#[tauri::command]
pub async fn detach_tmux_controller(
    controller_id: u32,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<(), String>;
// ↑ 成功后触发 settings_api::save_attached_tmux_servers（remove 该 controller）

/// kill tmux server（彻底）
#[tauri::command]
pub async fn kill_server_via_controller(
    controller_id: u32,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<(), String>;

/// 从持久化列表移除（force clear stale entry）
#[tauri::command]
pub async fn unmark_attached_tmux(
    session_name: String,
    socket_name: Option<String>,
    app: AppHandle,
) -> Result<(), String>;
// ↑ 直接写 settings_api::save_attached_tmux_servers，不动 SessionManager
```

## 3. 跨 module 调用的具体实现

### 3.1 terminal → settings（持久化 attached_tmux 列表）

```rust
// commands/tmux/session.rs
use crate::app::modules::settings::api as settings_api;

#[tauri::command]
pub async fn create_tmux_session(
    config: TmuxCcConfig,
    state: State<'_, Arc<SessionManager>>,
    backend: State<'_, Arc<RealAppBackend>>,
    app: AppHandle,
) -> Result<TmuxSessionInit, String> {
    let arc_real: Arc<RealAppBackend> = Arc::clone(backend.inner());
    let dyn_backend: Arc<dyn AppBackend> = arc_real;
    let result = terminal_api::create_tmux(state.inner(), dyn_backend, &config).await;

    if result.is_ok() {
        let servers = state.inner().list_attached_tmux_servers();
        if let Err(e) = settings_api::save_attached_tmux_servers(&app, &servers) {
            tracing::warn!("create_tmux_session: persistence failed: {e}");
        }
    }
    result
}
```

**关键**：

- terminal **不**直接调用 `tauri_plugin_store` —— 必须经过 `settings_api`
- 持久化失败**不**向上传播（best-effort）

### 3.2 terminal ← session（generic dispatcher 路由 tmux）

```rust
// app/session/commands/dispatch.rs
use crate::app::modules::terminal::api as terminal_api;

match config {
    SessionConfig::TmuxCc(tmux) => {
        // 跨 module 调用 —— session 调 terminal
        terminal_api::create_tmux(state.inner(), backend, &tmux).await
    }
    // ...
}
```

## 4. 接缝契约

```typescript
// 前端 app/terminal/api.ts
import { invoke } from "@tauri-apps/api/core";

export async function createTmuxSession(config: TmuxCcConfig) {
  return invoke<TmuxSessionInit>("create_tmux_session", { config });
}

export async function createTmuxPane(
  controllerId: number,
  parentTmuxPaneId: string,
  direction: "horizontal" | "vertical"
) {
  return invoke<SessionInfo>("create_tmux_pane", {
    controllerId,
    parentTmuxPaneId,
    direction,
  });
}
```

**接缝约束**：

- 前端只通过 `invoke()` 调 backend terminal api
- 前端解析 xsterm session id ↔ (controller_id, tmux_pane_id) 在本地完成
- tmux 协议层（`services::tmux_session::*`）由 terminal module 通过 SessionManager 间接访问，前端**不感知**

## 5. 不对外暴露

- `TmuxController` 字段（pane_bindings / window_bindings / etc.）—— 必须通过 SessionManager 访问
- `SessionManager::tmux_controllers` DashMap —— 必须通过 public method
- `services::tmux_session::protocol::ProtocolEvent` —— 已被 `infrastructure::tmux::backend` 包装，不暴露给 app

## 6. api.rs 变更流程

1. **新增 tmux IPC 命令** → 加 `commands/tmux/<sub>.rs` + 加 `#[tauri::command]` wrapper
2. **修改命令签名** → 同步更新 `api.rs` + INTERFACE.md §2 + 前端 `app/terminal/api.ts` 类型
3. **删除 tmux IPC 命令** → 三处一起删除（命令 / api.rs / `all_handlers()` 注册）
4. **新增持久化触发点** → 在 §3.1 同步 + 在 `app/settings/api.rs` 加对应 save 方法
5. **新增跨 module 调用**（如未来 workspace 调 create_tmux_pane）→ 在 §2 加 + 在 §3.2 同步

## 7. 关键设计约束

### 7.1 tmux 标识符约定

所有 tmux pane/window 命令接受 **server-side identifier**（`controller_id` + `tmux_pane_id` / `tmux_window_id`），**不接受 xsterm session id**：

- 理由：前端从 `tmux-pane-added` / `tmux-window-added` 事件已经持有这两个 id 的映射；让 backend 再做一次查找会引入额外复杂度（且容易出 stale bug，见 bug 0009 window_bindings 双写）
- 前端必须做 local-id → server-id 解析后再 invoke

### 7.2 bootstrap pane 的 `is_hidden` 语义

- `create_tmux_session`（new-session 模式）→ bootstrap pane `is_hidden = false`（用户的 working shell）
- `attach_tmux_session`（attach 模式）→ bootstrap pane `is_hidden = true`（tmux control connection，前端不渲染）

### 7.3 attached_tmux.json 是 cache，不是 source of truth

`attached_tmux.json` 持久化的是"启动时尝试 attach 的 server 列表"——运行时 SessionManager 才是 source of truth。`list_attached_tmux_servers()` 始终读 SessionManager，不读 disk。