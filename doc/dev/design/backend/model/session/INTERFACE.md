# Model · Session — 对外接口

> **位置**：`src-tauri/src/models/session/`
> **唯一进口**：`use crate::models::session::*;` 或精确 `use crate::models::session::types::SessionInfo;`

## 1. 对外暴露什么

session domain 暴露 4 类符号:

1. **Types**——`SessionType / SessionInfo / SessionConfig / LocalSessionConfig / SSHSessionConfig / SessionLoggingConfig / SessionIdSource / SizingMode / DisplayConfig / EnvConfig`
2. **Accessor functions**——纯查询 helper
3. **Rules functions**——不可变更新 helper
4. **Error types**——`SessionConfigError / SessionError`(thiserror derive)

外部层(service / app / infra)只能调 types / accessor / rules——**禁止**调内部细节。

## 2. 核心接口

### 2.1 Types

```rust
use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicU32;
use std::sync::Arc;

// ============ Session 类型标识 ============

/// session 类型枚举(local PTY / ssh / tmux-cc)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SessionType {
    #[serde(rename = "local")]
    Local { shell: String, cwd: String },

    #[serde(rename = "ssh")]
    Ssh {
        host: String,
        port: u16,
        user: String,
    },

    #[serde(rename = "tmux-cc")]
    TmuxCc {
        controller_id: u32,
        pane_id: String,
        session_name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        socket_name: Option<String>,
    },
}

// ============ Session 元数据(IPC 序列化)============

/// session 运行时元数据(IPC 边界类型)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: u32,
    pub name: String,
    pub session_type: SessionType,
    pub is_connected: bool,
    pub capabilities: CapabilityFlags,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tmux_pane_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tmux_controller_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tmux_window_id: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_hidden: bool,
}

// ============ Session 配置(dispatcher enum)============

/// session 创建的统一入口(enum 分发到 3 种 backend)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionConfig {
    #[serde(rename = "local")]
    Local(LocalSessionConfig),

    #[serde(rename = "ssh")]
    Ssh(SSHSessionConfig),

    #[serde(rename = "tmux-cc")]
    TmuxCc(TmuxCcConfig),  // ← 引用 models/tmux/types::TmuxCcConfig
}

// ============ Local PTY 配置 ============

pub struct LocalSessionConfig {
    pub shell: String,
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_config: Option<EnvConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_config: Option<DisplayConfig>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub should_save: bool,
    // ...
}

// ============ SSH 配置 ============

pub struct SSHSessionConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_method: Option<SshAuthMethod>,
    // ...
}

// ============ Session id 分配器 ============

/// 全局共享的 session id 分配器(Arc + AtomicU32)
pub struct SessionIdSource {
    next_id: AtomicU32,
}

impl SessionIdSource {
    pub fn new(start: u32) -> Arc<Self>;
    pub fn allocate(&self) -> u32;
    pub(crate) fn shared_allocator(self: &Arc<Self>) -> Arc<dyn Fn() -> u32 + Send + Sync>;
}

// ============ 日志配置 ============

pub struct SessionLoggingConfig {
    pub enabled: bool,
    pub log_path: Option<String>,
    pub max_file_size: Option<u64>,
}

// ============ Display config(运行时可调)============

pub enum SizingMode { Fit, Fixed }

pub struct DisplayConfig {
    pub font_family: String,
    pub font_size: u16,
    pub theme_id: String,
    // ...
}

pub struct EnvConfig {
    pub vars: HashMap<String, String>,
}
```

### 2.2 Accessor functions

```rust
/// 按 id 查单个 session
pub fn find_by_id(sessions: &[SessionInfo], id: u32) -> Option<&SessionInfo>;

/// 按 type 过滤 session
pub fn filter_by_type(sessions: &[SessionInfo], session_type_filter: SessionTypeFilter) -> Vec<SessionInfo> {
    sessions.iter()
        .filter(|s| matches_session_type(&s.session_type, &session_type_filter))
        .cloned()
        .collect()
}

/// 列出所有 tmux session
pub fn list_tmux_sessions(sessions: &[SessionInfo]) -> Vec<&SessionInfo> {
    sessions.iter().filter(|s| matches!(s.session_type, SessionType::TmuxCc { .. })).collect()
}

/// 检查 session 是否 alive
pub fn is_alive(session: &SessionInfo) -> bool {
    session.is_connected
}
```

### 2.3 Rules functions(不可变更新)

```rust
/// 设置 session 状态(返回新对象)
pub fn with_status(session: &SessionInfo, is_connected: bool) -> SessionInfo {
    SessionInfo { is_connected, ..session.clone() }
}

/// 应用 display config patch(返回新对象)
pub fn apply_display_config(session: &SessionInfo, patch: &DisplayConfig) -> SessionInfo {
    // 注意:MVP backend 不实际应用 display config(由 frontend store 维护)
    // 这里只是 helper,返回新对象供 service 测试 / 序列化用
    SessionInfo { ..session.clone() }
}

/// 设置 tmux pane / window id(用于 binding 更新,bug 0009 防御)
pub fn with_tmux_binding(
    session: &SessionInfo,
    pane_id: Option<String>,
    window_id: Option<String>,
) -> SessionInfo {
    SessionInfo {
        tmux_pane_id: pane_id,
        tmux_window_id: window_id,
        ..session.clone()
    }
}

/// 设置 hidden 标志(bootstrap pane 隐藏)
pub fn with_hidden(session: &SessionInfo, is_hidden: bool) -> SessionInfo {
    SessionInfo { is_hidden, ..session.clone() }
}
```

### 2.4 Error types

```rust
// models/session/errors.rs
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SessionConfigError {
    #[error("local session shell command is empty")]
    EmptyShell,

    #[error("local session cwd is empty")]
    EmptyCwd,

    #[error("ssh host is empty")]
    EmptySshHost,

    #[error("ssh port {0} is out of range")]
    InvalidSshPort(u16),

    #[error("ssh username is empty")]
    EmptySshUser,

    #[error("invalid env var name: {0}")]
    InvalidEnvVarName(String),

    #[error("invalid display config: {0}")]
    InvalidDisplayConfig(String),
}

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("session {0} not found")]
    NotFound(u32),

    #[error("session {0} is not registered in tmux controller {1}")]
    NotInTmuxController(u32, u32),

    #[error("payload too large: {actual} bytes (max {max})")]
    PayloadTooLarge { actual: usize, max: usize },
}

// 在 models/session/mod.rs 根级
impl From<SessionError> for String {
    fn from(e: SessionError) -> Self { e.to_string() }
}
```

## 3. 构造器(带校验)

```rust
impl LocalSessionConfig {
    pub fn try_new(shell: impl Into<String>, cwd: impl Into<String>) -> Result<Self, SessionConfigError> {
        let shell = shell.into();
        let cwd = cwd.into();
        if shell.is_empty() { return Err(SessionConfigError::EmptyShell); }
        if cwd.is_empty() { return Err(SessionConfigError::EmptyCwd); }
        Ok(Self {
            shell,
            cwd,
            env_config: None,
            display_config: None,
            should_save: false,
        })
    }
}

impl SSHSessionConfig {
    pub fn try_new(host: impl Into<String>, port: u16, user: impl Into<String>) -> Result<Self, SessionConfigError> {
        let host = host.into();
        let user = user.into();
        if host.is_empty() { return Err(SessionConfigError::EmptySshHost); }
        if port == 0 { return Err(SessionConfigError::InvalidSshPort(port)); }
        if user.is_empty() { return Err(SessionConfigError::EmptySshUser); }
        Ok(Self {
            host,
            port,
            user,
            auth_method: None,
        })
    }
}
```

## 4. 跨 domain 类型引用

session domain 引用以下其他 domain 的**纯类型字段**(纯类型不含逻辑):

```rust
// models/session/types.rs
use crate::models::cross_cutting::types::{CapabilityFlags, SplitDirection, SessionLoggingConfig};  // 跨域纯类型
use crate::models::tmux::types::TmuxCcConfig;  // tmux 专属配置
use crate::models::settings::types::{SizingMode, DisplayConfig, EnvConfig};  // settings 字段
```

**关键**:
- 引用**纯类型字段**是允许的(因为类型本身不含业务逻辑)
- 引用**函数 / trait** 是禁止的(那是 service / infra 的关注)
- `models/cross-cutting` 是唯一允许被其他 domain 引用的(因为它是横切关注点)

## 5. 接缝契约

```rust
// services/session/manager.rs
use crate::models::session::{SessionInfo, SessionConfig, LocalSessionConfig, SSHSessionConfig, SessionIdSource};

impl SessionManager {
    pub fn create_local(
        &self,
        config: LocalSessionConfig,  // ← models/session 类型
        backend: Arc<dyn AppBackend>,
    ) -> Result<SessionInfo, String> {  // ← models/session 类型
        // ...
    }
}
```

```rust
// app/session/api.rs
use crate::models::session::{LocalSessionConfig, SessionInfo};

#[tauri::command]
pub async fn create_local_session(
    config: LocalSessionConfig,  // ← IPC 反序列化
    state: State<'_, Arc<SessionManager>>,
    app: AppHandle,
) -> Result<SessionInfo, String> {  // ← IPC 序列化
    // ...
}
```

**接缝约束**:
- service / app / infra 都 import `models/session::*` 作为参数 / 返回类型
- 禁止 import `models/session` 的**内部**(子模块文件)
- 禁止 `models/session` import `services/*` 或 `app/*`

## 6. 不对外暴露

- `SessionIdSource::next_id` AtomicU32(只通过 `allocate()` 间接访问)
- 构造器内部的校验逻辑(只通过 `try_new()` 暴露)
- `_is_false` 等 serde helper(serde 内部使用)

## 7. api.rs 变更流程

1. **新增 SessionInfo 字段** → 加 `types.rs::SessionInfo` 字段 + 更新 §2.1 + 在 frontend `model/session/types.ts` 同步
2. **新增构造器** → 加 `impl LocalSessionConfig { try_new() }` + 同步 §3
3. **新增 accessor function** → 加 `accessor.rs` 函数 + 更新 §2.2
4. **新增 rules function** → 加 `rules.rs` 函数 + 更新 §2.3
5. **新增 Error 变体** → 加 `errors.rs` 变体 + 更新 §2.4 + 检查所有 `?` 调用方

## 8. 错误传播约定

- 模型层内部:返回 `Result<T, SessionConfigError>`(typed error)
- 模型层对外:`From<SessionConfigError> for String` 在 `models/session/mod.rs` 根级实现
- service 层:`Result<T, SessionError>` 或 `Result<T, String>`(现状)
- app 层:`Result<T, String>`(IPC 序列化)

未来可统一为 `SessionError` + `From<SessionError> for String`(per service/session/DOWNSTREAM.md 提到的 typed error 迁移路径)。