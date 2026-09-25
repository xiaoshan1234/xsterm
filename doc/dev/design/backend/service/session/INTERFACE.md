# Service · Session — 对外接口

> **位置**：`src-tauri/src/services/session/api.rs`
> **唯一进口**：`use crate::services::session::*;`

## 1. 对外暴露什么

session domain 暴露 3 类符号：

1. **`SessionManager` struct** —— 中央状态机，app 通过 `State<Arc<SessionManager>>` 注入
2. **`SessionBackend` trait** —— 3 种 backend 实现的抽象接口（pty_system / ssh_backend / tmux controller 都实现类似 trait）
3. **`ActiveSession` enum** —— 3 种 backend 的 trait object 容器（公开，但只在 `services/` 内部使用）

外部 crate（app / infra）只能调 `SessionManager` 的 public methods——**禁止**读字段直读字段。

## 2. 核心接口：SessionManager

```rust
use std::sync::atomic::AtomicU32;
use std::sync::Arc;
use dashmap::DashMap;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::PtySystem;
use crate::infrastructure::ssh::SshBackend;
use crate::models::capabilities::CapabilityFlags;
use crate::models::session::{
    AttachedTmuxServer, LocalSessionConfig, SSHSessionConfig,
    SessionInfo, TmuxCcConfig, TmuxSessionInit,
};
use crate::services::tmux::TmuxController;

/// 中央 session 状态机。所有 session 的注册表 + 生命周期编排。
///
/// 并发模型（Perf 004）：
/// - `sessions` 是 DashMap——单 session 操作无需 Mutex
/// - `next_id` / `next_controller_id` 是 AtomicU32
/// - create / close 是唯一 mutating 入口
pub struct SessionManager {
    pub(crate) sessions: DashMap<u32, Arc<ActiveSession>>,
    pub(crate) session_id_source: Arc<SessionIdSource>,
    pub(crate) pty_system: Box<dyn PtySystem>,
    pub(crate) ssh_backend: Arc<dyn SshBackend>,
    pub(crate) tmux_controllers: DashMap<u32, Arc<TmuxController>>,
    pub(crate) next_controller_id: AtomicU32,
}

impl SessionManager {
    /// 创建新 SessionManager（注入默认 platform backend）
    pub fn new() -> Self;

    // ============ create ============

    /// 创建 local PTY session
    pub fn create_local(
        &self,
        config: LocalSessionConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<SessionInfo, String>;

    /// 创建 SSH session
    pub fn create_ssh(
        &self,
        config: SSHSessionConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<SessionInfo, String>;

    /// 创建 tmux -CC controller + 注册 bootstrap pane
    pub async fn create_tmux(
        &self,
        config: &TmuxCcConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<TmuxSessionInit, String>;

    /// attach 到已存在 tmux server
    pub async fn attach_tmux(
        &self,
        config: &TmuxCcConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<TmuxSessionInit, String>;

    /// 探测 tmux server 是否存在（local + SSH）
    pub async fn probe_tmux_session_exists(
        &self,
        config: &TmuxCcConfig,
    ) -> Result<bool, String>;

    /// 启动时自动 attach 持久化列表中的 server
    pub async fn auto_attach_on_startup(
        &self,
        servers: &[AttachedTmuxServer],
        backend: Arc<dyn AppBackend>,
    ) -> Vec<AutoAttachOutcome>;

    // ============ lifecycle ============

    /// 写入字节到 session（通用入口，3 种 backend 都支持）
    pub fn write(&self, session_id: u32, bytes: &[u8]) -> Result<(), String>;

    /// resize PTY（local 特定）
    pub fn resize_pty_session(
        &self,
        session_id: u32,
        rows: u16,
        cols: u16,
    ) -> Result<(), String>;

    /// resize SSH channel（SSH 特定）
    pub fn resize_ssh_session(
        &self,
        session_id: u32,
        rows: u16,
        cols: u16,
    ) -> Result<(), String>;

    /// resize tmux pane（tmux 特定，server-side id）
    pub async fn resize_tmux_pane(
        &self,
        controller_id: u32,
        tmux_pane_id: &str,
        rows: u16,
        cols: u16,
    ) -> Result<(), String>;

    /// 关闭 session
    pub fn close(&self, session_id: u32) -> Result<(), String>;

    // ============ query ============

    /// 列出所有 active session 元数据
    pub fn list(&self) -> Vec<SessionInfo>;

    /// 通过 id 查询单个 session 信息
    pub fn info(&self, session_id: u32) -> Option<SessionInfo>;

    /// 列出已 attach 的 tmux server（projection of tmux_controllers）
    pub fn list_attached_tmux_servers(&self) -> Vec<AttachedTmuxServer>;

    // ============ tmux pane / window 操作（代理给 controller）============

    /// 创建 tmux pane（split-window）
    pub async fn create_tmux_pane(
        &self,
        controller_id: u32,
        parent_tmux_pane_id: &str,
        direction: &str,
    ) -> Result<SessionInfo, String>;

    /// kill tmux pane
    pub async fn kill_tmux_pane(
        &self,
        controller_id: u32,
        tmux_pane_id: &str,
    ) -> Result<(), String>;

    /// capture scrollback text
    pub async fn capture_tmux_pane(
        &self,
        controller_id: u32,
        tmux_pane_id: &str,
        lines: i32,
    ) -> Result<String, String>;

    /// 创建 tmux window
    pub async fn create_tmux_window(
        &self,
        controller_id: u32,
        name: Option<&str>,
    ) -> Result<SessionInfo, String>;

    /// kill tmux window
    pub async fn kill_tmux_window(
        &self,
        controller_id: u32,
        tmux_window_id: &str,
    ) -> Result<(), String>;

    /// rename tmux window
    pub async fn rename_tmux_window(
        &self,
        controller_id: u32,
        tmux_window_id: &str,
        new_name: &str,
    ) -> Result<(), String>;

    // ============ tmux controller 生命周期 ============

    /// detach controller（保留 tmux server 进程）
    pub fn detach_tmux_controller(&self, controller_id: u32) -> Result<(), String>;

    /// 关闭 controller + kill 关联的所有 pane
    #[allow(dead_code)]  // MVP 由 detach / kill_server 路径触发
    pub fn close_tmux_controller(&self, controller_id: u32) -> Result<(), String>;

    // ============ ssh 特有 ============

    /// 上传文件到 SSH 服务器（paste-image 流程）
    pub fn upload_image(
        &self,
        session_id: u32,
        filename: &str,
        data: Vec<u8>,
    ) -> Result<String, String>;  // 返回远端路径
}
```

## 3. 关键 trait：SessionBackend

```rust
/// 抽象 backend 接口。3 种实现（LocalSession / SshSession / TmuxPaneHandle）
/// 都实现该 trait——SessionManager 通过 trait object 统一调度。
pub trait SessionBackend {
    /// 返回 session 元数据快照
    fn get_session_info(&self) -> &SessionInfo;

    /// 返回 capability flags（paste / resize / tmux / 等）
    fn get_capabilities(&self) -> &CapabilityFlags;

    /// 写入字节到 backend（PTY master / SSH channel / tmux send-keys）
    fn write(&self, bytes: &[u8]) -> Result<(), String>;

    /// resize backend（TIOCSWINSZ / SSH window-change / tmux resize-pane）
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String>;

    /// 关闭 backend（消耗 self）
    fn close(self: Box<Self>) -> Result<(), String>;
}
```

## 4. 关键类型：ActiveSession

```rust
/// 3 种 backend 的 trait object 容器。SessionManager 通过 enum 持有。
pub(crate) enum ActiveSession {
    Pty(Box<dyn SessionBackend + Send>),
    Ssh(Box<SshSession>),
    Tmux(Box<TmuxPaneHandle>),
}

impl ActiveSession {
    /// Borrow 底层 backend（trait object）
    fn get_backend(&self) -> &(dyn SessionBackend + '_);

    /// Consume variant，返回 owned boxed backend
    fn into_backend(self) -> Box<dyn SessionBackend + Send>;

    /// 构建完整 SessionInfo（含 capabilities）
    fn to_session_info(&self) -> SessionInfo;

    /// 如果是 tmux pane，返回 controller_id
    fn get_tmux_controller_id(&self) -> Option<u32>;
}
```

**关键**：`SshSession` 是具体类型（不是 `dyn SessionBackend`），因为 `get_ssh_config()` 需要读 `SSHSessionConfig`（trait 不暴露）。但 trait 方法仍可调用——通过 deref coercion。

## 5. 跨 domain 调用接口

### 5.1 session → tmux（持 controller Arc，不读字段）

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
        // 调 controller 公开方法（不读字段）
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

**关键**：bug 0009 的根因（`create_tmux` 直读 `window_bindings` HashMap）在 v1 通过 trait 边界彻底避免——session 只调 controller 的公开方法。

### 5.2 session → infra（trait object）

```rust
// services/session/manager.rs
pub struct SessionManager {
    pty_system: Box<dyn PtySystem>,
    ssh_backend: Arc<dyn SshBackend>,
    // ...
}

impl SessionManager {
    pub fn create_local(
        &self,
        config: LocalSessionConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<SessionInfo, String> {
        let id = self.allocate_session_id();
        let session = create_local_session(
            self.pty_system.as_ref(),  // ← trait object dispatch
            config,
            backend,
            id,
        )?;
        Ok(self.insert_session(id, ActiveSession::Pty(Box::new(session))))
    }
}
```

## 6. 接缝契约

```rust
// app/session/api.rs（v1 backend app 设计）
use crate::services::session::SessionManager;
use tauri::State;

#[tauri::command]
pub async fn create_local_session(
    config: LocalSessionConfig,
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {
    let backend: Arc<dyn AppBackend> = Arc::new(RealAppBackend::new(app));
    session_api::create_local(state.inner(), backend, config)
}
```

**接缝约束**：

- app 通过 `#[tauri::command]` 注入 `State<Arc<SessionManager>>`
- app **不** import `services::session::*` 字段——只通过 `SessionManager` public methods
- service **不** import `app::*`——service 不知道 IPC 存在
- service **不** import `infrastructure::*` 的具体实现——只通过 trait object

## 7. 不对外暴露

- `ActiveSession` enum 字段（只在 `services/` 内部使用）
- `SessionIdSource::next_id` AtomicU32（不暴露 atomic op）
- `tmux_controllers` DashMap（通过 `list_attached_tmux_servers` 等方法访问）
- `pty_system` / `ssh_backend`（只通过 create_* 方法间接使用）

## 8. api.rs 变更流程

1. **新增 public method** → 加 `manager.rs` 方法 + 更新 INTERFACE.md §2
2. **新增 backend trait method** → 加 `SessionBackend` trait 方法 + 3 个 backend 实现 + 更新 §3
3. **修改方法签名** → 同步更新 §2 + app 调用方 + frontend `service/session/api.ts`
4. **删除方法** → 从 manager + app + frontend 三处一起删除
5. **新增 field 直读** → **禁止**！如确有必要，加 public method

## 9. 错误传播约定

`SessionManager` 的方法返回 `Result<T, String>`（不是 typed error）——理由：

- v0 现状：`String` 错误简单直接，前端能显示
- 未来迁移：`SessionError`（thiserror derive）+ `From<SessionError> for String` 在 `service/session/mod.rs` 根级
- 不引入 `tauri::Error`（避免 service 依赖 tauri）

详见 `app/session/DOWNSTREAM.md` 的"统一错误类型"段。