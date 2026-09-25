# Domain · Terminal — 对外接口

> **位置**：`src-tauri/src/domain/terminal/`
> **唯一进口**：`use crate::domain::terminal::*;`

## 1. 对外暴露什么

terminal domain 暴露 5 类符号：

1. **Types**（来自原 `models/tmux`）——`TmuxCcConfig / TmuxSessionInit / TmuxWindowInit / TmuxPaneInit / TmuxControlWindowInit / AttachedTmuxServer`
2. **Rules functions**（纯 helper）——`tmux_pane_info()`
3. **State**（来自原 `services/tmux/controller/mod.rs`）——`TmuxController` struct + 内部 state
4. **API**（**新增**——强制唯一入口）——`create_controller / attach_to_controller / send_keys_to_pane / ...`
5. **Error types**——`TmuxError`（thiserror derive）

外部调用（`commands/` / `domain/session`）**只**通过 `domain/terminal/api.rs` —— 禁止直接 import `controller/mod.rs` 或 controller 内部字段。

## 2. 核心接口：TmuxController 公开方法

```rust
use std::sync::Arc;
use crate::infra::tauri::AppBackend;
use crate::infra::tmux::TmuxBackend;
use crate::domain::session::SessionIdSource;
use crate::domain::terminal::*;

/// tmux -CC controller 状态机（独立成 state.rs，impl 在 controller/）
pub struct TmuxController {
    pub(crate) controller_id: u32,
    pub(crate) session_name: String,
    pub(crate) pane_bindings: HashMap<String, u32>,         // tmux pane id → xsterm session id
    pub(crate) window_bindings: HashMap<String, String>,    // tmux window id → xsterm window id
    pub(crate) initial_state: Option<TmuxInitialState>,
    pub(crate) dispatch_task: JoinHandle<()>,
    pub(crate) tmux_backend: Box<dyn TmuxBackend>,
    pub(crate) app_backend: Arc<dyn AppBackend>,
    pub(crate) id_allocator: Arc<SessionIdSource>,
    pub(crate) router_state: RouterState,
}

impl TmuxController {
    pub fn controller_id(&self) -> u32;
    pub fn session_name(&self) -> &str;
    pub fn tmux_window_id_for_pane(&self, pane_id: &str) -> Option<String>;
    pub fn send_keys(&self, pane_id: &str, bytes: &[u8]) -> Result<(), TmuxError>;
    pub fn resize_pane(&self, pane_id: &str, cols: u16, rows: u16) -> Result<(), TmuxError>;
    pub fn capture_pane(&self, pane_id: &str, lines: u32) -> Result<String, TmuxError>;
    pub fn detach(&self) -> Result<(), TmuxError>;
    pub fn close(&mut self, kill_server: bool) -> Result<(), TmuxError>;
    pub fn await_first_pane(&mut self) -> Result<(), TmuxError>;
    pub fn take_initial_state(&mut self) -> Option<TmuxInitialState>;
}
```

## 3. 核心 API（新增统一入口）

```rust
// domain/terminal/api.rs
use std::sync::Arc;
use crate::infra::tauri::AppBackend;
use crate::infra::tmux::TmuxBackend;
use crate::domain::session::SessionIdSource;
use crate::domain::terminal::*;

/// 创建新 tmux controller（local / ssh 两种 backend）
pub async fn create_controller(
    config: &TmuxCcConfig,
    tmux_backend: Box<dyn TmuxBackend>,
    app_backend: Arc<dyn AppBackend>,
    id_allocator: Arc<SessionIdSource>,
) -> Result<(Arc<TmuxController>, TmuxSessionInit), TmuxError>;

/// attach 到已存在 tmux server
pub async fn attach_to_controller(
    server_name: &str,
    tmux_backend: Box<dyn TmuxBackend>,
    app_backend: Arc<dyn AppBackend>,
    id_allocator: Arc<SessionIdSource>,
) -> Result<(Arc<TmuxController>, TmuxSessionInit), TmuxError>;

/// 探测 tmux server 是否存在
pub async fn probe_tmux_session_exists(
    config: &TmuxCcConfig,
    tmux_backend: &dyn TmuxBackend,
) -> Result<bool, TmuxError>;

/// 通过 controller handle 执行 tmux command（封装 Arc 借用）
pub async fn send_keys_to_pane(
    controller: &TmuxController,
    pane_id: &str,
    bytes: &[u8],
) -> Result<(), TmuxError>;

pub async fn resize_pane(
    controller: &TmuxController,
    pane_id: &str,
    cols: u16, rows: u16,
) -> Result<(), TmuxError>;

pub async fn capture_pane(
    controller: &TmuxController,
    pane_id: &str,
    lines: u32,
) -> Result<String, TmuxError>;

pub async fn split_pane(
    controller: &TmuxController,
    pane_id: &str,
    direction: SplitDirection,
) -> Result<(), TmuxError>;

pub async fn kill_pane(
    controller: &TmuxController,
    pane_id: &str,
) -> Result<(), TmuxError>;

pub async fn create_window(
    controller: &TmuxController,
    session_name: &str,
) -> Result<(String, String), TmuxError>;  // (window_id, pane_id)

pub async fn kill_window(
    controller: &TmuxController,
    window_id: &str,
) -> Result<(), TmuxError>;

pub async fn rename_window(
    controller: &TmuxController,
    window_id: &str,
    new_name: &str,
) -> Result<(), TmuxError>;

pub fn list_attached_servers() -> Vec<AttachedTmuxServer>;

pub async fn detach_controller(controller: &TmuxController) -> Result<(), TmuxError>;
pub async fn kill_server(controller: &TmuxController) -> Result<(), TmuxError>;
```

## 4. Types

```rust
use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicU32;

// ============ tmux-cc 配置 ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TmuxCcConfig {
    #[serde(rename = "local")]
    Local {
        session_name: String,
        socket_name: Option<String>,
    },
    #[serde(rename = "ssh")]
    Ssh {
        host: String,
        port: u16,
        user: String,
        session_name: String,
        ssh_auth: SshAuthMethod,
    },
}

// ============ tmux 初始化返回 ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmuxSessionInit {
    pub controller_id: u32,
    pub session_name: String,
    pub windows: Vec<TmuxWindowInit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmuxWindowInit {
    pub window_id: String,
    pub panes: Vec<TmuxPaneInit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmuxPaneInit {
    pub pane_id: String,
    pub title: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TmuxControlWindowInit {
    pub window_id: String,
    pub control_pane_id: String,
}

// ============ tmux 持久化 ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachedTmuxServer {
    pub name: String,
    pub pid: u32,
    pub last_attached_at: u64,
    pub backend: TmuxBackendKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TmuxBackendKind {
    Local,
    Ssh,
}

// ============ tmux initial state（dispatch task 累积）============

#[derive(Debug, Clone)]
pub struct TmuxInitialState {
    pub windows: Vec<TmuxWindowInit>,
    pub control_window: Option<TmuxControlWindowInit>,
}
```

## 5. Rules functions

```rust
// rules.rs
use super::types::*;
use crate::domain::session::SessionInfo;

/// 构造 SessionInfo（用于 tmux pane → SessionInfo 投影）
pub fn tmux_pane_info(
    pane_id: &str,
    session_id: u32,
    controller_id: u32,
    title: &str,
) -> SessionInfo;
```

## 6. Errors

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TmuxError {
    #[error("handshake failed: {0}")]
    HandshakeFailed(String),
    #[error("parse failed: {0}")]
    ParseFailed(String),
    #[error("router closed")]
    RouterClosed,
    #[error("controller not found: {0}")]
    ControllerNotFound(u32),
    #[error("pane not found: {0}")]
    PaneNotFound(String),
    #[error("window not found: {0}")]
    WindowNotFound(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}
```

## 7. 接缝契约

```rust
// commands/terminal/api.rs
use crate::domain::terminal::{create_controller, send_keys_to_pane, ...};
use crate::domain::session::SessionManager;

pub async fn create_tmux_session(
    state: &Arc<SessionManager>,
    config: &TmuxCcConfig,
    app_backend: Arc<dyn AppBackend>,
) -> Result<TmuxSessionInit, String> {
    state.create_tmux(config, app_backend).await
}

pub async fn create_tmux_pane(
    state: &Arc<SessionManager>,
    controller_id: u32,
    pane_id: &str,
    direction: SplitDirection,
) -> Result<(), String> {
    state.create_tmux_pane(controller_id, pane_id, direction).await
}
```

**接缝约束**：

- commands 通过 `domain/session::SessionManager` 调 tmux 操作（**不**直接 import `domain/terminal::*`）
- `domain/session::SessionManager` 内部通过 `domain/terminal::api::*` 调 TmuxController（强制走 api 入口）
- `domain/terminal::api.rs` 是**唯一**对外入口（**禁止** import `controller/*` 内部字段）

## 8. 不对外暴露

- `TmuxController` 字段（`pane_bindings / window_bindings / initial_state / dispatch_task`）——只能通过 public method 访问
- `dispatch_task` 内部逻辑——通过 spawn_*_task 在 controller/mod.rs 内管理
- `bridge.rs::TmuxBridge` 内部——通过 `TmuxController::emit_*` 公开方法触发
- `protocol/*` 内部（octal codec / CommandKind）——通过 `TmuxBackend` trait 抽象
- `tauri` / `tauri-plugin-store` —— terminal 不感知

## 9. api.rs 变更流程

1. **新增 tmux controller method** → 加 `domain/terminal/state.rs` + `controller/*.rs` + INTERFACE §2/§3 + 检查所有调用方
2. **新增 typed wrapper** → 加 `domain/terminal/types.rs` 类型 + serde derive + 检查 IPC payload
3. **修改 TmuxController public method** → ⚠️ breaking——所有 `domain/session` 调用方更新
4. **修改 ProtocolEvent** → ⚠️ breaking——frontend `service/tmux` 订阅事件类型同步更新
5. **修改 bridge emit 逻辑** → 影响 frontend 事件订阅——可能破坏 frontend 状态

## 10. 错误传播约定

- `Result<T, TmuxError>` 内部返回
- `Result<T, String>` 跨 `commands` 边界（统一 `String`）
- `TmuxError` 通过 `From<TmuxError> for String` 在 `domain/terminal/errors.rs` 根级实现
- 调用方通过 `?` + `From` 自动转换