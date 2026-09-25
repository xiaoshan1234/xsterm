# Infra · SSH — 对外接口

> **位置**：`src-tauri/src/infrastructure/ssh/`
> **唯一进口**：`use crate::infrastructure::ssh::*;` 或精确 `use crate::infrastructure::ssh::traits::SshBackend;`

## 1. 对外暴露什么

ssh 子模块暴露 4 类符号：

1. **`SshBackend` trait** —— SSH 连接 + 命令执行 + 文件上传的抽象接口
2. **`SshSessionTrait` trait** —— 单个 SSH session 的接口（read / write / resize / close）
3. **Public 函数** —— `upload_file_via_ssh / upload_image / run_command_capture_stdout`
4. **`SshError` enum** —— thiserror 派生错误

## 2. 核心接口

### 2.1 SshBackend trait

```rust
// infrastructure/ssh/traits.rs
use crate::models::session::SSHSessionConfig;
use std::process::ExitStatus;

pub trait SshBackend: Send + Sync {
    /// 建立 SSH 连接（connect + authenticate + open channel）
    fn connect(&self, config: &SSHSessionConfig) -> Result<Box<dyn SshSessionTrait>, SshError>;

    /// 一次性执行远程命令（用于 tmux probe）
    /// 返回 (stdout, exit_status) — exit_status 用于判断命令成功
    fn run_command_capture_stdout(
        &self,
        config: &SSHSessionConfig,
        command: &str,
    ) -> Result<(String, ExitStatus), SshError>;
}
```

**关键**：

- `Send + Sync` 让 `Arc<dyn SshBackend>` 在 `SessionManager` 中使用
- `run_command_capture_stdout` 是**同步阻塞**——service 层 wrap `tokio::task::spawn_blocking` 避免阻塞 async reactor

### 2.2 SshSessionTrait trait

```rust
// infrastructure/ssh/session.rs
pub trait SshSessionTrait: Send + Sync {
    /// 写入字节到 SSH channel stdin
    fn write(&self, bytes: &[u8]) -> Result<(), SshError>;

    /// 从 SSH channel stdout 读取（非阻塞）
    fn read(&self) -> Result<Vec<u8>, SshError>;

    /// 通知远程 PTY size 变化（window-change）
    fn resize(&self, rows: u16, cols: u16) -> Result<(), SshError>;

    /// 关闭 SSH channel + 清理
    fn close(&mut self) -> Result<(), SshError>;
}
```

**关键**：

- v4 通过 `Box<dyn SshSessionTrait>` 持有——service 层统一通过 trait 调度
- v3 是具体 `Box<SshSession>` 直接持有——v4 抽象化
- `read` 是非阻塞——service 层 wrap 异步循环（`tokio::select!`）

### 2.3 Public functions

```rust
// infrastructure/ssh/upload.rs
use std::path::Path;

/// SCP 文件上传到 SSH 服务器
pub fn upload_file_via_ssh(
    config: &SSHSessionConfig,
    ssh_backend: &dyn SshBackend,
    local_path: &Path,
    remote_path: &str,
) -> Result<(), SshError>;

/// 上传图片（构造远端路径 + SCP）
pub fn upload_image(
    config: &SSHSessionConfig,
    ssh_backend: &dyn SshBackend,
    local_path: &Path,
    filename: &str,
) -> Result<String, SshError>;
// ↑ 返回 remote_path(由 models/cross_cutting/helpers::build_remote_image_path 构造)
```

```rust
// infrastructure/ssh/probe.rs
/// 一次性执行远程命令并捕获 stdout
pub async fn run_command_capture_stdout(
    config: &SSHSessionConfig,
    ssh_backend: &dyn SshBackend,
    command: &str,
) -> Result<(String, ExitStatus), SshError>;
// ↑ 注意:与 trait method 同名(infra/ssh/probe.rs 内部 wrap trait 调用)
```

### 2.4 SshError enum

```rust
// infrastructure/ssh/errors.rs
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SshError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("russh error: {0}")]
    Russh(String),

    #[error("ssh authentication failed")]
    AuthFailed,

    #[error("ssh connection timeout after {0:?}")]
    Timeout(std::time::Duration),

    #[error("ssh host key mismatch (NOT CHECKED — known security debt)")]
    HostKeyUnchecked,

    #[error("ssh command exit status: {0}")]
    NonZeroExit(i32),

    #[error("ssh upload failed: {0}")]
    Upload(String),
}

impl From<SshError> for String {
    fn from(e: SshError) -> Self { e.to_string() }
}
```

### 2.5 SshBackendImpl + SshSession impl

```rust
// infrastructure/ssh/backend.rs
use russh::{client, Config, Preferred};
use russh_keys::key::KeyPair;

pub struct SshBackendImpl;

impl SshBackendImpl {
    pub fn new() -> Self { Self }
}

impl SshBackend for SshBackendImpl {
    fn connect(&self, config: &SSHSessionConfig) -> Result<Box<dyn SshSessionTrait>, SshError> {
        // russh::client::connect(config.host, config.port)
        //   .awaited_authenticate(config.user, auth_method)
        //   .open_shell_channel()
        //   → SshSession::new(channel)
    }

    fn run_command_capture_stdout(
        &self,
        config: &SSHSessionConfig,
        command: &str,
    ) -> Result<(String, ExitStatus), SshError> {
        // russh::client::connect(...) + exec_channel.run(command)
        // → collect stdout + exit_status
    }
}
```

```rust
// infrastructure/ssh/session.rs
pub struct SshSession {
    handle: client::Handle<SshClient>,
    channel: Channel,
}

impl SshSessionTrait for SshSession {
    fn write(&self, bytes: &[u8]) -> Result<(), SshError> { ... }
    fn read(&self) -> Result<Vec<u8>, SshError> { ... }
    fn resize(&self, rows: u16, cols: u16) -> Result<(), SshError> { ... }
    fn close(&mut self) -> Result<(), SshError> { ... }
}
```

### 2.6 MockSshBackend（自动生成）

```rust
// infrastructure/ssh/mock.rs
#[automock]
impl SshBackend for MockSshBackend {
    fn connect(&self, config: &SSHSessionConfig) -> Result<Box<dyn SshSessionTrait>, SshError> { ... }
    fn run_command_capture_stdout(...) -> Result<..., SshError> { ... }
}
```

## 3. 跟 service / app 的接缝

### 3.1 service → infra/ssh

```rust
// services/session/manager.rs
use crate::infrastructure::ssh::{SshBackend, SshBackendImpl, SshSessionTrait};

pub struct SessionManager {
    ssh_backend: Arc<dyn SshBackend>,
    // ...
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            ssh_backend: Arc::new(SshBackendImpl::new()),
            // ...
        }
    }

    pub fn create_ssh(
        &self,
        config: SSHSessionConfig,
        backend: Arc<dyn AppBackend>,
    ) -> Result<SessionInfo, String> {
        let ssh_session = self.ssh_backend.connect(&config).map_err(|e| e.to_string())?;
        // 包装为 services/session/backends/ssh.rs::SshSession(Box<dyn SshSessionTrait>)
        // ...
    }
}
```

### 3.2 service 测试 → MockSshBackend

```rust
// services/session/manager.rs::tests
use crate::infrastructure::ssh::MockSshBackend;

#[test]
fn create_ssh_session() {
    let mut mock_ssh = MockSshBackend::new();
    mock_ssh.expect_connect()
        .returning(|_config| Ok(Box::new(MockSshSessionTrait::new())));

    let manager = SessionManager::with_ssh_backend(Arc::new(mock_ssh));
    // 测试 SessionManager::create_ssh 流程
}
```

### 3.3 app → infra/ssh（upload_image 流程）

```rust
// app/session/commands/ssh/upload.rs
use crate::infrastructure::ssh::{upload_image, SshBackend};

#[tauri::command]
pub async fn upload_image_to_ssh_session(
    session_id: u32,
    filename: String,
    data: Vec<u8>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<String, String> {
    // 1. 拿 session 对应的 ssh_config
    let session = state.info(session_id).ok_or_else(|| format!("session {session_id} not found"))?;
    let ssh_config = session.get_ssh_config().ok_or_else(|| "not an SSH session".to_string())?;

    // 2. 写本地临时文件
    let local_path = std::env::temp_dir().join(&filename);
    std::fs::write(&local_path, &data).map_err(|e| e.to_string())?;

    // 3. 调 infra/ssh::upload_image
    let remote_path = upload_image(&ssh_config, &state.ssh_backend, &local_path, &filename)
        .map_err(|e| e.to_string())?;

    // 4. 清理本地文件
    let _ = std::fs::remove_file(&local_path);

    Ok(remote_path)
}
```

## 4. 接缝约束

- service 持有 `Arc<dyn SshBackend>`（不是具体类型）——支持 mock 替换
- service 不直接 import `russh`——通过 `SshBackend` trait 间接
- service 调 `ssh_backend.connect(config)` 返回 `Result<Box<dyn SshSessionTrait>, SshError>`
- service 通过 `?` 运算符 + `From<SshError> for String` 自动转换为 IPC 错误

## 5. 不对外暴露

- `SshBackendImpl` 的 russh 内部类型（`russh::client::Handle` / `russh::Channel`）
- `SshSession::handle / channel`（只在 ssh 子模块内部使用）
- `upload_file_via_ssh` 的内部 SCP 实现细节
- `run_command_capture_stdout` 的同步阻塞实现细节

## 6. api.rs 变更流程

1. **新增 SshBackend trait method** → 加 `traits.rs` + 更新 mock + 更新 `backend.rs` impl + INTERFACE.md §2.1
2. **新增 SshSessionTrait method** → 加 `session.rs` + INTERFACE.md §2.2
3. **新增 SshError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.4 + 检查所有 `?` 调用方
4. **修改 upload_file_via_ssh 签名** → ⚠️ breaking——同步更新 `app/session/api.rs::upload_image_to_ssh_session`
5. **修改 russh API** → 升级 Cargo.toml + 更新 `backend.rs / session.rs` 调用 + 跑集成测试

## 7. 错误传播约定

- infra 层：`Result<T, SshError>`（typed error）
- infra → service：`Result<T, String>`（通过 `From<SshError> for String` 自动转换）
- service → app：`Result<T, String>`（IPC 序列化）

未来可统一为 `AppError`（顶层 error.rs）—— 但 MVP 保持 `Result<T, String>`。