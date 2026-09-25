# Service · Tmux — 对外接口

> **位置**：`src-tauri/src/services/tmux/`（落地 `mod.rs`）
> **唯一进口**：`use crate::services::tmux::*;` 或精确 `use crate::services::tmux::TmuxController;`

## 1. 对外暴露什么

tmux domain 暴露 4 类符号：

1. **`TmuxController` struct** —— 每个 tmux -CC 子进程对应一个 controller 实例
2. **`TmuxError` enum** —— thiserror 派生错误（用于协议层 + controller 内部）
3. **`spawn_create` / `spawn_attach` 构造函数** —— 创建 controller 的入口
4. **controller 公开方法**——send_keys / resize_pane / capture_pane / split-window / kill-pane / unbind_pane / detach / await_first_pane / take_initial_state / 等

**关键**：`TmuxController` 的字段（`pane_bindings` / `window_bindings` / `initial_state` / `dispatch_task` / `child`）**不对外暴露**——只能通过公开方法访问（bug 0009 防御）。

## 2. 核心接口：TmuxController

```rust
use std::sync::Arc;
use tokio::sync::oneshot;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::ssh::SshBackend;
use crate::models::session::{TmuxCcConfig, TmuxSessionInit};

/// tmux -CC control mode controller。每个 controller 持 1 个 `tmux -CC` 子进程。
///
/// 设计要点：
/// - controller 由 `TmuxController::spawn_create` 创建（拆自 v0 controller/spawn.rs）
/// - controller 由 `SessionManager::tmux_controllers` DashMap 持有
/// - controller 内部 HashMap 通过 `pub(super)` 可见性限制外部访问
/// - 跨 domain 调用必须走公开方法（bug 0009 防御）
pub struct TmuxController {
    pub(super) controller_id: u32,
    pub(super) pane_bindings: HashMap<String, u32>,  // tmux_pane_id → xsterm_session_id
    pub(super) window_bindings: HashMap<String, String>,  // tmux_window_id → xsterm_window_id
    pub(super) initial_state_ready: Arc<tokio::sync::Notify>,
    pub(super) initial_windows: parking_lot::Mutex<Option<Vec<TmuxWindow>>>,
    pub(super) initial_panes: parking_lot::Mutex<Option<Vec<TmuxPane>>>,
    pub(super) dispatch_task: tokio::task::JoinHandle<()>,
    pub(super) command_tx: mpsc::UnboundedSender<TaggedCommand>,
    pub(super) child: Box<dyn Child + Send + Sync>,
    pub(super) stdin_writer: ...
    // ...
}

impl TmuxController {
    // ============ constructor ============

    /// 创建新的 tmux -CC controller（new-session 或 attach 由 config 决定）
    pub fn spawn_create(
        config: &TmuxCcConfig,
        backend: Arc<dyn AppBackend>,
        ssh_backend: &dyn SshBackend,
        controller_id: u32,
        session_id_allocator: Arc<dyn Fn() -> u32 + Send + Sync>,
    ) -> Result<Arc<Self>, String>;

    // ============ 公开方法（session manager 调用）============

    /// 返回 controller 唯一 id
    pub fn controller_id(&self) -> u32;

    /// 返回当前 attach 的 tmux session name（用于 list_attached_tmux_servers projection）
    pub fn session_name(&self) -> Option<String>;

    /// 等待第一个 pane bootstrap 完成
    pub async fn await_first_pane(&self) -> Result<(u32, String), TmuxError>;
    // ↑ 返回 (xsterm_session_id, tmux_pane_id)

    /// 等待初始 list-windows + list-panes 完成
    pub async fn take_initial_state(&self) -> Result<(Vec<TmuxWindow>, Vec<TmuxPane>), TmuxError>;

    /// 通过 tmux pane id 查 xsterm session id
    pub fn xsterm_session_id_for_pane(&self, tmux_pane_id: &str) -> Option<u32>;

    /// 通过 tmux pane id 查 tmux window id（bug 0009 修复路径：暴露公开方法）
    pub fn tmux_window_id_for_pane(&self, tmux_pane_id: &str) -> Option<String>;

    /// 通过 tmux window id 查 xsterm window id
    pub fn xsterm_window_id_for_window(&self, tmux_window_id: &str) -> Option<String>;

    /// 发送按键到 tmux pane（TmuxPaneHandle::write 调用）
    pub fn send_keys(&self, pane_id: &str, bytes: &[u8]) -> Result<(), TmuxError>;

    /// resize tmux pane
    pub fn resize_pane(&self, pane_id: &str, rows: u16, cols: u16) -> Result<(), TmuxError>;

    /// 取消 pane binding（close pane 时调用）
    pub fn unbind_pane(&self, pane_id: &str) -> Result<(), TmuxError>;

    /// capture scrollback 文本
    pub async fn capture_pane(&self, pane_id: &str, lines: i32) -> Result<String, TmuxError>;

    /// 主动 detach controller（保留 tmux server）
    pub fn detach(&self) -> Result<(), TmuxError>;

    /// 关闭 controller + 子进程
    pub fn close(&self) -> Result<(), TmuxError>;

    /// 通过 tmux 控件发命令（11 个用户面向 command）
    pub async fn split_window(&self, parent_pane: &str, direction: &str) -> Result<String, TmuxError>;
    pub async fn kill_pane(&self, pane_id: &str) -> Result<(), TmuxError>;
    pub async fn new_window(&self, name: Option<&str>) -> Result<String, TmuxError>;
    pub async fn kill_window(&self, window_id: &str) -> Result<(), TmuxError>;
    pub async fn rename_window(&self, window_id: &str, new_name: &str) -> Result<(), TmuxError>;
    pub async fn list_windows(&self) -> Result<Vec<TmuxWindow>, TmuxError>;
    pub async fn list_panes(&self, window_id: &str) -> Result<Vec<TmuxPane>, TmuxError>;
    pub fn send_command_raw(&self, cmd: TaggedCommand) -> Result<(), TmuxError>;
}
```

## 3. 关键 trait / 类型

### 3.1 TmuxError

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TmuxError {
    #[error("tmux controller {0} is not registered")]
    ControllerNotFound(u32),

    #[error("tmux pane {0} is not bound")]
    PaneNotBound(String),

    #[error("tmux window {0} is not bound")]
    WindowNotBound(String),

    #[error("tmux child process exited unexpectedly")]
    ChildExited,

    #[error("tmux command timed out after {0:?}")]
    Timeout(Duration),

    #[error("tmux protocol error: {0}")]
    Protocol(String),

    #[error("tmux SSH backend error: {0}")]
    Ssh(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

// 在 services/tmux/mod.rs 根级
impl From<TmuxError> for String {
    fn from(e: TmuxError) -> Self { e.to_string() }
}
```

**关键**：`From<TmuxError> for String` 在 `services/tmux/mod.rs` 根级实现——避免每个调用方 `map_err(|e| e.to_string())`。

### 3.2 TaggedCommand（协议层命令）

```rust
// services/tmux/protocol/command.rs（v0 已有）
pub struct TaggedCommand {
    pub id: CommandId,
    pub kind: CommandKind,
    pub waiter: Option<oneshot::Sender<ProtocolEvent>>,
    pub timeout: Duration,
}

pub enum CommandKind {
    SendKeys { pane_id: String, bytes: Vec<u8> },
    SplitWindow { parent_pane: String, direction: String },
    KillPane { pane_id: String },
    NewWindow { name: Option<String> },
    KillWindow { window_id: String },
    RenameWindow { window_id: String, new_name: String },
    ResizePane { pane_id: String, rows: u16, cols: u16 },
    ListWindows,
    ListPanes { window_id: String },
    CapturePane { pane_id: String, lines: i32 },
    DetachClient { session_name: String },
}
```

### 3.3 ProtocolEvent（解析后事件）

```rust
// services/tmux/protocol/events.rs（v0 已有 30+ 变体）
pub enum ProtocolEvent {
    WindowAdded { window_id: String, name: String },
    WindowClosed { window_id: String },
    WindowRenamed { window_id: String, name: String },
    PaneAdded { window_id: String, pane_id: String },
    PaneRemoved { pane_id: String },
    PaneExited { pane_id: String, exit_status: i32 },
    Output { pane_id: String, bytes: Vec<u8> },
    SessionAttached { session_name: String },
    SessionDetached,
    Begin { command_id: CommandId },
    End { command_id: CommandId, data: Vec<String> },
    Error { command_id: CommandId, message: String },
    // ... 30+ 变体
}
```

### 3.4 TmuxBridge（事件推送）

```rust
// services/tmux/bridge.rs（v0 在 bridge/mod.rs）
pub struct TmuxBridge {
    app: AppHandle,
}

impl TmuxBridge {
    pub fn new(app: AppHandle) -> Self;

    /// 把 ProtocolEvent 转换为 Tauri 事件并 emit
    pub fn dispatch_event(&self, event: ProtocolEvent) -> Result<(), TmuxError>;

    /// 注册 pane 出现时 emit `tmux-pane-added` 等
    pub fn emit_session_output(&self, pane_id: &str, bytes: Vec<u8>) -> Result<(), String>;
    // ...
}
```

## 4. 跨 domain 调用接口

### 4.1 session → tmux（调 controller 公开方法）

```rust
// services/session/backends/tmux_pane.rs
use crate::services::tmux::TmuxController;

pub struct TmuxPaneHandle {
    pub controller: Arc<TmuxController>,
    pub tmux_pane_id: String,
    pub info: SessionInfo,
    pub capabilities: CapabilityFlags,
}

impl SessionBackend for TmuxPaneHandle {
    fn write(&self, bytes: &[u8]) -> Result<(), String> {
        self.controller
            .send_keys(&self.tmux_pane_id, bytes)
            .map_err(|e| e.to_string())
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.controller
            .resize_pane(&self.tmux_pane_id, rows, cols)
            .map_err(|e| e.to_string())
    }

    fn close(self: Box<Self>) -> Result<(), String> {
        self.controller
            .unbind_pane(&self.tmux_pane_id)
            .map_err(|e| e.to_string())
    }
}
```

### 4.2 session manager → controller（spawn + lifecycle）

```rust
// services/session/manager.rs
use crate::services::tmux::TmuxController;

impl SessionManager {
    pub async fn create_tmux(
        &self,
        config: &TmuxCcConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<TmuxSessionInit, String> {
        let controller_id = self.allocate_controller_id();
        let session_id_allocator =
            SessionIdSource::shared_allocator(&self.session_id_source);

        let controller = TmuxController::spawn_create(
            config,
            backend,
            self.ssh_backend.as_ref(),
            controller_id,
            session_id_allocator,
        )?;

        let (session_id, tmux_pane_id) = controller.await_first_pane().await?;
        let (initial_windows, initial_panes) = controller.take_initial_state().await?;

        // bug 0009 修复：用 controller.tmux_window_id_for_pane() 公开方法
        // 而非 controller.window_bindings[...] 字段直读
        let tmux_window_id = controller.tmux_window_id_for_pane(&tmux_pane_id);

        // 注册 controller 到 manager
        self.tmux_controllers.insert(controller_id, Arc::clone(&controller));

        // ... 构建 TmuxSessionInit 返回
    }
}
```

**关键对比 v0**：

```rust
// v0（bug 0009）
let tmux_window_id = self.tmux_controllers
    .get(&controller_id).unwrap()
    .window_bindings  // ← 字段直读
    .iter()
    .find(|(pane_id, _)| pane_id == &tmux_pane_id)
    .map(|(_, window_id)| window_id.clone());

// v1（修复）
let tmux_window_id = controller.tmux_window_id_for_pane(&tmux_pane_id);  // ← 公开方法
```

## 5. 接缝契约

```rust
// services/session/manager.rs（v1）
use crate::services::tmux::{TmuxController, TmuxError};

// session manager 注入 controller Arc
fn insert_session(&self, id: u32, backend: ActiveSession) -> SessionInfo;
```

**接缝约束**：

- session 调 controller **只通过** `TmuxController` 的公开方法
- session **不** import `services::tmux::controller::TmuxController` 的字段
- session **不** import `services::tmux::bridge::*`（bridge 是 controller 内部）
- session **不** import `services::tmux::protocol::*`（protocol 是纯函数层）

## 6. 不对外暴露

- `TmuxController` 的字段：`pane_bindings` / `window_bindings` / `initial_state_*` / `dispatch_task` / `command_tx` / `child` / `stdin_writer`
- `dispatch.rs` 的 `dispatch_event` 内部逻辑
- `bridge.rs` 的 `dispatch_event` 内部逻辑
- `protocol/*` 的 parse 函数（只被 controller 内部使用）

## 7. api.rs 变更流程

1. **新增 controller 公开方法** → 加 `controller/mod.rs` 方法 + 在 INTERFACE.md §2 同步
2. **新增 ProtocolEvent 变体** → 加 `protocol/events.rs` 变体 + 更新 bridge 转换 + 在 §3.3 同步
3. **新增 CommandKind** → 加 `protocol/command.rs` 变体 + controller 实现 + wire.rs 序列化
4. **修改公开方法签名** → ⚠️ breaking——检查所有调用方（session manager / backends/tmux_pane）
5. **字段可见性调整**（从 pub(super) → pub 或反向）→ ⚠️ breaking——bug 0009 防御边界

## 8. 错误传播约定

- `TmuxController` 方法返回 `Result<T, TmuxError>`
- 在 `services/tmux/mod.rs` 根级实现 `From<TmuxError> for String`
- 调用方（session manager）通过 `?` 运算符自动转换

不引入 `tauri::Error`——service 不依赖 tauri。