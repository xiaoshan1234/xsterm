# Infra · Tmux — 对外接口

> **位置**：`src-tauri/src/infrastructure/tmux/`
> **唯一进口**：`use crate::infrastructure::tmux::*;` 或精确 `use crate::infrastructure::tmux::backend::TmuxBackend;`

## 1. 对外暴露什么

tmux 子模块暴露 4 类符号：

1. **`TmuxBackend` trait** —— tmux 子进程 spawn 的抽象接口
2. **`LocalTmuxBackend` / `SshTmuxBackend` impl** —— 本地 / SSH 后端
3. **`TmuxBackendHandle` struct** —— 持有子进程 stdin/stdout/child
4. **`TmuxInfraError` enum** —— infra 层 tmux 错误

## 2. 核心接口

### 2.1 TmuxBackend trait

```rust
// infrastructure/tmux/backend.rs
use crate::models::tmux::TmuxCcConfig;
use std::io::{Read, Write};

pub trait TmuxBackend: Send + Sync {
    /// 启动 tmux -CC 子进程（local 或 SSH 远端）
    fn spawn(&self, config: &TmuxCcConfig) -> Result<TmuxBackendHandle, TmuxInfraError>;
}
```

### 2.2 LocalTmuxBackend

```rust
pub struct LocalTmuxBackend;

impl LocalTmuxBackend {
    pub fn new() -> Self { Self }
}

impl TmuxBackend for LocalTmuxBackend {
    fn spawn(&self, config: &TmuxCcConfig) -> Result<TmuxBackendHandle, TmuxInfraError> {
        // 1. tokio::process::Command::new("tmux")
        //      .args(["-CC", "new-session", "-s", session_name, ...])
        //      .spawn()?
        //
        // 2. 拿 stdin / stdout / stderr / child handle
        //
        // 3. 返回 TmuxBackendHandle
    }
}
```

### 2.3 SshTmuxBackend

```rust
pub struct SshTmuxBackend<'a> {
    ssh_backend: &'a dyn SshBackend,
}

impl<'a> SshTmuxBackend<'a> {
    pub fn new(ssh_backend: &'a dyn SshBackend) -> Self {
        Self { ssh_backend }
    }
}

impl<'a> TmuxBackend for SshTmuxBackend<'a> {
    fn spawn(&self, config: &TmuxCcConfig) -> Result<TmuxBackendHandle, TmuxInfraError> {
        let ssh_config = config.ssh.as_ref().ok_or_else(|| {
            TmuxInfraError::SpawnFailed("ssh config required for SshTmuxBackend".into())
        })?;

        // 1. 通过 ssh_backend 启动远端 tmux -CC 进程
        // 2. 用 SSH exec channel 作为 stdin / stdout
        // 3. 返回 TmuxBackendHandle
    }
}
```

### 2.4 TmuxBackendHandle

```rust
pub struct TmuxBackendHandle {
    /// 子进程 stdin（向 tmux 发送命令）
    pub stdin: Box<dyn Write + Send>,

    /// 子进程 stdout（读取 tmux 响应 + 事件）
    pub stdout: Box<dyn Read + Send>,

    /// 子进程 stderr（错误日志）
    pub stderr: Box<dyn Read + Send>,

    /// 子进程 Child handle（用于 wait / kill）
    pub child: Box<dyn Child + Send>,
}

/// Child trait abstraction (tokio::process::Child)
pub trait Child: Send {
    fn kill(&mut self) -> std::io::Result<()>;
    fn wait(&mut self) -> std::io::Result<std::process::ExitStatus>;
    fn id(&self) -> Option<u32>;
}
```

### 2.5 TmuxInfraError

```rust
// infrastructure/tmux/errors.rs
use thiserror::Error;

#[derive(Debug, Error)]
pub enum TmuxInfraError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("tmux command failed to spawn: {0}")]
    SpawnFailed(String),

    #[error("tmux process exited unexpectedly")]
    ProcessExited,

    #[error("ssh backend error: {0}")]
    Ssh(String),
}

impl From<TmuxInfraError> for String {
    fn from(e: TmuxInfraError) -> Self { e.to_string() }
}
```

### 2.6 MockTmuxBackend（自动生成）

```rust
// infrastructure/tmux/mock.rs
#[automock]
impl TmuxBackend for MockTmuxBackend {
    fn spawn(&self, config: &TmuxCcConfig) -> Result<TmuxBackendHandle, TmuxInfraError> { ... }
}
```

## 3. 跟 service / app 的接缝

### 3.1 service → infra/tmux

```rust
// services/tmux/controller/spawn.rs
use crate::infrastructure::tmux::{TmuxBackend, LocalTmuxBackend, SshTmuxBackend, TmuxInfraError};
use crate::infrastructure::ssh::SshBackend;

pub fn spawn_create(
    config: &TmuxCcConfig,
    backend: Arc<dyn AppBackend>,
    ssh_backend: &dyn SshBackend,
    // ...
) -> Result<Arc<Self>, TmuxError> {
    // 1. 根据 config.ssh 选择 backend
    let tmux_backend: Box<dyn TmuxBackend> = if config.ssh.is_some() {
        Box::new(SshTmuxBackend::new(ssh_backend))
    } else {
        Box::new(LocalTmuxBackend::new())
    };

    // 2. spawn tmux -CC 子进程
    let handle = tmux_backend.spawn(config)?;

    // 3. 用 handle.stdin / stdout 启动 dispatch task
    // 4. 创建 TmuxController
}
```

### 3.2 service 测试 → MockTmuxBackend

```rust
// services/tmux/controller/spawn.rs::tests
use crate::infrastructure::tmux::MockTmuxBackend;

#[test]
fn spawn_create_local() {
    let mut mock_tmux = MockTmuxBackend::new();
    mock_tmux.expect_spawn()
        .returning(|_config| Ok(/* mock TmuxBackendHandle */));

    // 测试 controller 创建流程
}
```

## 4. 接缝约束

- service 持有 `Box<dyn TmuxBackend>`（不是具体类型）——支持 mock 替换
- service 不直接 import `tokio::process::Command`（调 tmux 子进程）——通过 `TmuxBackend` trait 间接
- service 调 `tmux_backend.spawn(config)` 返回 `Result<TmuxBackendHandle, TmuxInfraError>`
- service 通过 `?` 运算符 + `From<TmuxInfraError> for TmuxError` 转换为 service 层错误

## 5. 不对外暴露

- `LocalTmuxBackend` 的 `tokio::process::Command` 内部细节
- `SshTmuxBackend` 的 SSH exec channel 内部细节
- `TmuxBackendHandle` 的具体子进程类型

## 6. api.rs 变更流程

1. **新增 TmuxBackend trait method** → 加 `backend.rs` + 更新 mock + 更新 impl + INTERFACE.md §2.1
2. **新增 TmuxInfraError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.5 + 检查所有 `?` 调用方
3. **修改 LocalTmuxBackend / SshTmuxBackend 签名** → ⚠️ breaking——同步更新 `services/tmux/controller/spawn.rs`
4. **修改 tmux wire protocol**（未来）→ ⚠️ breaking——同步更新 `services/tmux/protocol/`

## 7. 错误传播约定

- infra 层：`Result<T, TmuxInfraError>`（typed error）
- infra → service：`From<TmuxInfraError> for TmuxError` 在 `services/tmux/errors.rs` 实现
- service → app：`Result<T, String>`（IPC 序列化）