# Domain · Session — 对外接口

> **位置**：`src-tauri/src/domain/session/`
> **唯一进口**：`use crate::domain::session::*;`

## 1. 对外暴露什么

session domain 暴露 4 类符号：

1. **Types**（来自原 `models/session`）——`SessionType / SessionInfo / SessionConfig / LocalSessionConfig / SSHSessionConfig / SessionLoggingConfig / SessionIdSource / SizingMode / DisplayConfig / EnvConfig`
2. **Rules functions**（不可变更新）——`withStatus / applyDisplayConfig / withCapability`
3. **State**（来自原 `services/session`）——`SessionManager` struct + `ActiveSession` enum + 3 种 backend（pty_system / ssh_backend / tmux controller 都通过 `SessionBackend` trait 接入）
4. **Error types**——`SessionError / SessionConfigError / SessionBackendError`（thiserror derive）

外部层（`commands/` / `infra/`）只能调 types / rules / SessionManager public methods——**禁止**读 `SessionManager` 字段直读字段。

## 2. 核心接口：SessionManager

```rust
use std::sync::atomic::AtomicU32;
use std::sync::Arc;
use dashmap::DashMap;
use crate::infrastructure::app_backend::AppBackend;
use crate::infrastructure::pty::PtySystem;
use crate::infrastructure::ssh::SshBackend;
use crate::domain::settings::CapabilityFlags;
use crate::domain::terminal::{TmuxController, TmuxCcConfig, TmuxSessionInit, AttachedTmuxServer};

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
    pub fn resize_pty(&self, session_id: u32, rows: u16, cols: u16) -> Result<(), String>;

    /// resize SSH pty channel（ssh 特定）
    pub fn resize_ssh(&self, session_id: u32, rows: u16, cols: u16) -> Result<(), String>;

    /// 关闭 session + 清理（3 种 backend 都支持）
    pub fn close(&self, session_id: u32) -> Result<(), String>;

    /// 列出所有 session 信息
    pub fn list(&self) -> Vec<SessionInfo>;

    // ============ query ============

    /// 获取单个 session 信息
    pub fn info(&self, session_id: u32) -> Option<SessionInfo>;

    /// 获取单个 session 的 capability flags
    pub fn capabilities(&self, session_id: u32) -> Option<CapabilityFlags>;

    /// 获取 session output 通道（binary frame 起点）
    pub fn output_channel(&self, session_id: u32) -> Option<...>;

    // ============ tmux 代理 ============

    pub async fn create_tmux_pane(&self, controller_id: u32, pane_id: &str, direction: SplitDirection) -> Result<(), String>;
    pub async fn kill_tmux_pane(&self, controller_id: u32, pane_id: &str) -> Result<(), String>;
    pub async fn resize_tmux_pane(&self, controller_id: u32, pane_id: &str, cols: u16, rows: u16) -> Result<(), String>;
    pub async fn capture_tmux_pane(&self, controller_id: u32, pane_id: &str, lines: u32) -> Result<String, String>;
    pub async fn create_tmux_window(&self, controller_id: u32, session_name: &str) -> Result<(window_id, pane_id), String>;
    pub async fn kill_tmux_window(&self, controller_id: u32, window_id: &str) -> Result<(), String>;
    pub async fn rename_tmux_window(&self, controller_id: u32, window_id: &str, new_name: &str) -> Result<(), String>;
    pub fn list_attached_tmux_servers(&self) -> Vec<AttachedTmuxServer>;
    pub fn detach_tmux_controller(&self, controller_id: u32) -> Result<(), String>;
    pub async fn close_tmux_controller(&self, controller_id: u32, kill_server: bool) -> Result<(), String>;
}
```

## 3. Types（来自原 `models/session/types.rs`）

```rust
use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicU32;
use std::sync::Arc;

// ============ Session 类型标识 ============

/// session 类型枚举（local PTY / ssh / tmux-cc）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SessionType {
    #[serde(rename = "local")]
    Local { shell: String, cwd: String },

    #[serde(rename = "ssh")]
    Ssh { host: String, port: u16, user: String },

    #[serde(rename = "tmux-cc")]
    TmuxCc {
        controller_id: u32,
        pane_id: String,
        session_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        socket_name: Option<String>,
    },
}

// ============ Session 状态 ============

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Connecting,
    Running,
    Closing,
    Closed,
    Error,
}

// ============ Session 元数据 ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: u32,
    pub name: String,
    pub session_type: SessionType,
    pub status: SessionStatus,
    pub started_at: u64,            // millis since epoch
    pub display: Option<DisplayConfig>,
    pub sizing: SizingMode,
}

// ============ Session 配置 ============

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionConfig {
    #[serde(rename = "local")]
    Local(LocalSessionConfig),
    #[serde(rename = "ssh")]
    Ssh(SSHSessionConfig),
    #[serde(rename = "tmux")]
    Tmux(TmuxCcConfig),  // 来自 domain/terminal
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSessionConfig {
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub env: Option<Vec<(String, String)>>,
    pub args: Option<Vec<String>>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SSHSessionConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_method: SshAuthMethod,
    pub cols: u16,
    pub rows: u16,
}

// ============ Session 持久化配置 ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedSessionConfig {
    pub id: String,           // UUID
    pub name: String,
    pub config: SessionConfig,
    pub created_at: u64,
    pub last_used_at: Option<u64>,
    pub version: u32,         // schema 版本
}

// ============ Session logging 配置 ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionLoggingConfig {
    pub enabled: bool,
    pub dir: PathBuf,
    pub max_file_size: u64,
    pub max_files: u32,
    pub level: String,
}

// ============ Session Display / Sizing ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayConfig {
    pub font_family: String,
    pub font_size: u16,
    pub theme_id: String,
    pub cursor_blink: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SizingMode {
    Auto,        // 根据 pane 大小自动
    Fixed { cols: u16, rows: u16 },
}

// ============ Session id 分配器 ============

#[derive(Debug)]
pub struct SessionIdSource {
    next_id: AtomicU32,
}

impl SessionIdSource {
    pub fn new(start: u32) -> Self;
    pub fn allocate(&self) -> u32;
    pub fn current(&self) -> u32;
}
```

## 4. Rules（来自原 `models/session/rules.rs`）

```rust
use super::types::*;

// ============ 不可变更新 ============

pub fn with_status(session: &SessionInfo, status: SessionStatus) -> SessionInfo;

pub fn apply_display_config(
    session: &SessionInfo,
    patch: &DisplayConfigPatch,
) -> SessionInfo;

pub fn with_capability(
    session: &SessionInfo,
    flags: CapabilityFlags,
) -> SessionInfo;

pub fn with_started_at(
    session: &SessionInfo,
    started_at: u64,
) -> SessionInfo;

// ============ 类型守卫 ============

pub fn is_terminal_session(session: &SessionInfo) -> bool;
pub fn is_attached_session(session: &SessionInfo) -> bool;
```

## 5. SessionBackend trait

```rust
/// session 抽象接口（3 种 backend 都实现）
#[async_trait]
pub trait SessionBackend: Send + Sync {
    fn info(&self) -> SessionInfo;
    fn capabilities(&self) -> CapabilityFlags;
    fn write(&self, bytes: &[u8]) -> Result<(), SessionError>;
    fn resize(&self, rows: u16, cols: u16) -> Result<(), SessionError>;
    async fn close(&mut self) -> Result<(), SessionError>;
    /// session output 通道（binary frame 起点，归 session 模块）
    fn output_channel(&self) -> tokio::sync::mpsc::Receiver<Vec<u8>>;
}

/// ActiveSession：3 种 backend 的 trait object 容器
pub enum ActiveSession {
    Pty(Box<dyn SessionBackend + Send>),
    Ssh(Box<dyn SessionBackend + Send>),
    Tmux(Box<dyn SessionBackend + Send>),
}
```

## 6. Errors

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("session not found: {0}")]
    NotFound(u32),
    #[error("session already closed")]
    AlreadyClosed,
    #[error("pty error: {0}")]
    Pty(String),
    #[error("ssh error: {0}")]
    Ssh(String),
    #[error("tmux error: {0}")]
    Tmux(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("backend not supported: {0}")]
    BackendNotSupported(String),
}

#[derive(Debug, Error)]
pub enum SessionConfigError {
    #[error("invalid ssh config: {0}")]
    InvalidSshConfig(String),
    #[error("invalid shell: {0}")]
    InvalidShell(String),
}
```

## 7. 接缝契约

```rust
// commands/session/api.rs
use crate::domain::session::{SessionManager, SessionInfo, LocalSessionConfig, ...};
use std::sync::Arc;

/// 纯函数入口：创建 local session（被 commands/local/create.rs::create_local_session 调用）
pub async fn create_local(
    state: &Arc<SessionManager>,
    backend: Arc<dyn AppBackend>,
    config: LocalSessionConfig,
) -> Result<SessionInfo, String> {
    state.create_local(config, backend).await
}
```

**接缝约束**：

- `domain/session/api.rs` 是**纯 Rust 函数**（async OK，但**不**接收 `State<AppHandle>`）
- commands 的 `#[tauri::command]` wrapper 只做参数提取 + 调 `api.rs`
- 跨 commands module 调用**只**通过 `domain/session/api.rs`

## 8. 跨域调用接口（来自原 service/session §3）

### 8.1 settings → session（default 值注入）

```rust
// commands/session/api.rs
use crate::domain::settings::SettingsService;
use crate::domain::session::LocalSessionConfig;

pub async fn create_local_with_defaults(
    state: &Arc<SessionManager>,
    backend: Arc<dyn AppBackend>,
    mut config: LocalSessionConfig,
) -> Result<SessionInfo, String> {
    // settings 是横切，由 commands 层注入 default 值
    let settings = SettingsService::get().await;
    config.shell = config.shell.or(Some(settings.default_shell));
    config.cwd = config.cwd.or(settings.default_cwd);
    state.create_local(config, backend).await
}
```

### 8.2 terminal → session（tmux controller 注册）

```rust
// commands/terminal/api.rs
use crate::domain::session::SessionManager;
use crate::domain::terminal::{TmuxController, TmuxCcConfig};

pub async fn create_tmux(
    state: &Arc<SessionManager>,
    config: &TmuxCcConfig,
    backend: Arc<dyn AppBackend>,
) -> Result<TmuxSessionInit, String> {
    state.create_tmux(config, backend).await
}
```

### 8.3 commands/shell → session（auto_attach 启动）

```rust
// commands/shell/api.rs
use crate::domain::session::SessionManager;
use crate::domain::terminal::attached_tmux::load_attached_tmux_typed;
use crate::infrastructure::app_backend::AppBackend;

pub async fn initialize(app: &AppHandle, services: &Services) -> Result<(), String> {
    let backend: Arc<dyn AppBackend> = Arc::new(RealAppBackend::new(app.clone()));
    let servers = load_attached_tmux_typed(app)?;
    let outcomes = services.session.auto_attach_on_startup(&servers, backend).await;
    // log outcomes...
    Ok(())
}
```

## 9. 不对外暴露

- `SessionManager` 字段（`sessions / session_id_source / pty_system / ssh_backend / tmux_controllers`）——只能通过 public method 访问
- `ActiveSession` 内部 3 种 variant —— 只能通过 `SessionBackend` trait 调度
- `SessionIdSource::next_id`（AtomicU32）—— 只能通过 `allocate()` 访问
- `tauri_plugin_store` —— session **不**直接持久化（由 commands/<module>/api 触发：attached_tmux→terminal，log→shell）

## 10. api.rs 变更流程

1. **新增 SessionManager method** → 加 `domain/session/state.rs` 方法 + 更新 §2 签名 + 检查所有 commands 调用方
2. **新增 typed wrapper** → 加 `domain/session/types.rs` 类型 + serde derive + 检查 IPC payload
3. **新增 rule** → 加 `domain/session/rules.rs` 函数 + 更新 INTERFACE §4
4. **修改 SessionManager method 签名** → ⚠️ breaking——检查所有 commands 调用方 + frontend service 类型
5. **修改 SessionBackend trait** → ⚠️ breaking——3 种 backend impl 全部更新 + INTERFACE §5

## 11. 错误传播约定

- `Result<T, SessionError>` 作为内部返回（SessionError 内部使用）
- `Result<T, String>` 作为跨模块边界返回（commands 边界统一 `String`）
- `SessionError` 通过 `From<SessionError> for String` 在 `domain/session/errors.rs` 根级实现
- 调用方通过 `?` 运算符 + `From` 自动转换

## 12. 测试

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mockall::predicate::*;

    #[test]
    fn create_local_assigns_sequential_id() {
        let mgr = SessionManager::new();
        let s1 = mgr.create_local(LocalSessionConfig::default(), mock_backend()).unwrap();
        let s2 = mgr.create_local(LocalSessionConfig::default(), mock_backend()).unwrap();
        assert_eq!(s2.id, s1.id + 1);
    }

    #[test]
    fn write_to_closed_session_errors() {
        let mgr = SessionManager::new();
        let id = mgr.create_local(...).unwrap().id;
        mgr.close(id).unwrap();
        let r = mgr.write(id, b"x");
        assert!(matches!(r, Err(SessionError::AlreadyClosed)));
    }
}
```