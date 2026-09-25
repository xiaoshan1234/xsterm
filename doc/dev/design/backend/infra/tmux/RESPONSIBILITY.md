# Infra · Tmux — 职责

> **位置**：`src-tauri/src/infrastructure/tmux/`
> **类型**：⭐ 外部资源 — tmux 控制模式（外部子进程 + wire 协议）
> **被使用方**：`services/tmux/controller/`
> **外部依赖**：`tokio::process`（spawn tmux -CC 子进程）+ tmux wire protocol

## 1. 这个子模块负责什么

tmux 子模块是 backend 与 **tmux -CC 控制模式**交互的物理适配层——所有 tmux 子进程 spawn + wire 协议处理都集中在这里。

承担 4 类职责：

1. **TmuxBackend trait 定义**——抽象 tmux 子进程 spawn + 命令发送接口
2. **LocalTmuxBackend impl**——本地 tmux -CC 子进程（`tokio::process::Command`）
3. **SshTmuxBackend impl**——远程 SSH 上的 tmux -CC 子进程（通过 `infra/ssh::SshBackend::run_command_capture_stdout`）
4. **TmuxInfraError** —— infra 层 tmux 错误（与 `services::tmux::TmuxError` 区分）

## 2. 这个子模块 **不**负责什么

- **不实现 tmux wire 协议**——协议层在 `services/tmux/protocol/`（octal codec / CommandKind / ProtocolEvent）
- **不持有 tmux controller 状态**——controller 在 `services/tmux/controller/`（pane_bindings / window_bindings / dispatch_task）
- **不解析 tmux 命令输出**——parser 在 `services/tmux/protocol/parser.rs`
- **不推 Tauri 事件**——bridge 在 `services/tmux/bridge.rs`
- **不处理 session lifecycle**——lifecycle 由 `SessionManager` 编排

## 3. 子结构

```
infrastructure/tmux/
├── mod.rs              re-export 4 文件
├── backend.rs          TmuxBackend trait + LocalTmuxBackend + SshTmuxBackend
├── errors.rs           TmuxInfraError(thiserror derive)
├── mock.rs             #[automock] MockTmuxBackend
└── (未来) wire.rs      tmux wire 协议封装(占位)
```

**v3 → v4 拆分映射**：v3 的 `infrastructure/tmux/{mod.rs, backend.rs}` 2 文件 → v4 拆为 3 文件（backend / errors / mock）。

## 4. 跟 frontend infra 的关系

frontend **没有** `infra/tmux` —— frontend 不直接调 tmux（通过 IPC 接收 backend 推送的 `tmux-pane-added` / `tmux-window-added` 等事件 + 调 `invoke('create_tmux_session', ...)`）。

| backend infra/tmux | frontend 等价 |
|---|---|
| `TmuxBackend::spawn(config)` | ❌（frontend 不可见） |
| `LocalTmuxBackend` / `SshTmuxBackend` | ❌ |
| tmux wire protocol | ❌（frontend 通过 IPC 接收 `TmuxEvent`）|

**关键**：backend infra/tmux 是**纯 backend 概念**——frontend 完全不感知 tmux wire 协议。

## 5. 跟其他 backend infra 子模块的关系

| 子模块 | 关系 |
|---|---|
| `infra/pty` | 平级；不互相依赖 |
| `infra/ssh` | ⚠️ `SshTmuxBackend` **依赖** `infra/ssh::SshBackend`(用于在远程 SSH 上 spawn tmux -CC) |
| `infra/tauri` | 平级；tmux 子进程不直接调 Tauri |

**关键约束**：

- tmux 子模块**不** import pty / tauri
- tmux 子模块**允许** import `infra/ssh::SshBackend` trait（用于 SshTmuxBackend）
- tmux 子模块**不** import service / app / commands

## 6. 跟 service / app 的关系

| 层 | 怎么用 infra/tmux |
|---|---|
| `services/tmux/controller/spawn.rs` | `TmuxController::spawn_create(config, backend, ssh_backend, ...)` 内部根据 `config.ssh.is_some()` 选择 `LocalTmuxBackend` 或 `SshTmuxBackend` |
| `app/terminal` | 不直接调 infra/tmux——通过 `services/tmux::TmuxController` 间接 |
| `services/session` | `SessionManager::probe_tmux_session_exists` 间接通过 `SshBackend::run_command_capture_stdout` 调 tmux list-sessions |

## 7. 这个子模块的"产品语言"术语

- **tmux -CC** —— tmux 控制模式（`tmux -CC` 命令行参数）
- **LocalTmuxBackend** —— 本地 tmux -CC 子进程后端
- **SshTmuxBackend** —— 远程 SSH 上的 tmux -CC 后端
- **tmux wire protocol** —— tmux 控制模式的 line-based 协议（`send-keys` / `split-window` / `list-windows` / `%begin..%end`）
- **TmuxBackend trait** —— 抽象后端接口（mockable）
- **control mode** —— tmux 的控制模式（区别于 attach mode）

## 8. 关键设计约束

### 8.1 TmuxBackend trait 必须 Send + Sync

```rust
pub trait TmuxBackend: Send + Sync {
    /// 启动 tmux -CC 子进程(local 或 SSH)
    fn spawn(
        &self,
        config: &TmuxCcConfig,
    ) -> Result<TmuxBackendHandle, TmuxInfraError>;
}
```

**关键**：`Send + Sync` 让 trait object 在多线程 controller 中使用。

### 8.2 LocalTmuxBackend vs SshTmuxBackend 选择

```rust
// services/tmux/controller/spawn.rs
use crate::infrastructure::tmux::{LocalTmuxBackend, SshTmuxBackend};

pub fn spawn_create(
    config: &TmuxCcConfig,
    // ...
) -> Result<Arc<Self>, String> {
    let backend: Box<dyn TmuxBackend> = if config.ssh.is_some() {
        Box::new(SshTmuxBackend::new(ssh_backend.clone()))
    } else {
        Box::new(LocalTmuxBackend::new())
    };

    let handle = backend.spawn(config)?;
    // ... 用 handle.stdin / handle.stdout 创建 controller
}
```

### 8.3 TmuxBackendHandle 持有子进程 stdin/stdout

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
```

**关键**：controller 持有 `TmuxBackendHandle` —— 通过 stdin / stdout 与 tmux 子进程通信。

### 8.4 mockall 自动 mock

```rust
// infrastructure/tmux/mock.rs
#[automock]
impl TmuxBackend for MockTmuxBackend {
    fn spawn(&self, config: &TmuxCcConfig) -> Result<TmuxBackendHandle, TmuxInfraError> { ... }
}
```

**vs service 测试**：`services/tmux_session/controller/tests.rs` 用**手写** `RecordingBackend`——更可控。两种风格保持。

### 8.5 错误统一用 thiserror derive（与 services/tmux/errors.rs 区分）

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
```

**与 services/tmux/errors.rs::TmuxError 区分**：
- `TmuxInfraError` —— infra 层（spawn / process 错误）
- `TmuxError` —— service 层（controller 内部错误，如 ControllerNotFound / PaneNotBound / Timeout）

service 层通过 `?` 运算符 + `From<TmuxInfraError> for TmuxError` 自动转换。

## 9. v3 → v4 拆分映射

| v3 位置 | v4 位置 | 改动 |
|---|---|---|
| `infrastructure/tmux/mod.rs` | `infrastructure/tmux/mod.rs` | 不动 |
| `infrastructure/tmux/backend.rs::TmuxBackend trait` | `infrastructure/tmux/backend.rs` | 不动（已存在） |
| `infrastructure/tmux/backend.rs::LocalTmuxBackend` | `infrastructure/tmux/backend.rs` | 不动 |
| `infrastructure/tmux/backend.rs::SshTmuxBackend` | `infrastructure/tmux/backend.rs` | 不动 |
| 内嵌 error 隐式依赖 | `infrastructure/tmux/errors.rs::TmuxInfraError` | 新增 + thiserror derive |
| 无 mock | `infrastructure/tmux/mock.rs::MockTmuxBackend` | 新增 `#[automock]` |

## 10. 强制约束（可机械校验）

```bash
# infra/tmux 不依赖 service / app / commands
grep -rn 'use crate::\(services\|app\|commands\)' src-tauri/src/infrastructure/tmux/
# 必须为空

# infra/tmux 不依赖 infra/pty / infra/tauri(平级)
grep -rn 'use crate::infrastructure::\(pty\|tauri\)' src-tauri/src/infrastructure/tmux/
# 必须为空

# infra/tmux 只能读 models 类型
grep -rn 'use crate::models::' src-tauri/src/infrastructure/tmux/ | grep -v '::types\|::accessor\|::helpers'
# 必须为空

# infra/tmux 不持有 tokio::main
grep -rn 'tokio::main' src-tauri/src/infrastructure/tmux/
# 必须为空

# infra/tmux 允许依赖 infra/ssh（用于 SshTmuxBackend）
grep -rn 'use crate::infrastructure::ssh::' src-tauri/src/infrastructure/tmux/
# 应当出现（SshTmuxBackend 需要）
```

## 11. 跟 v3 的差异

| 维度 | v3 | v4 |
|---|---|---|
| 文件数 | 2 文件（mod + backend）| 4 文件（mod + backend + errors + mock） |
| 错误处理 | 隐式依赖（service 层用 String）| 独立 `TmuxInfraError`（thiserror derive） |
| mock | 无 | `#[automock]` 自动 mock |
| 与 frontend 镜像 | ❌（frontend 无 tmux） | 文档明确标注 "backend 独有" |
| 与 infra/ssh 依赖 | ❌ | ✅ SshTmuxBackend 依赖 SshBackend trait |

## 12. 测试

每个文件都有 `*.test.rs`：

- `backend.rs` 的 `LocalTmuxBackend::spawn` 需要真实 tmux 安装——集成测试标记 `#[ignore]`
- `backend.rs` 的 `SshTmuxBackend::spawn` 需要真实 SSH server + 远端 tmux——集成测试标记 `#[ignore]`
- `mock.rs` 的 `MockTmuxBackend::spawn` 单测
- `errors.rs` 的 `TmuxInfraError` Display + From 派生测试

## 13. 依赖变更流程

1. **新增 TmuxBackend trait method** → 加 `backend.rs` + 更新 mock + 更新 impl + INTERFACE.md §2.1
2. **新增 TmuxInfraError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.3 + 检查所有 `?` 调用方
3. **修改 LocalTmuxBackend / SshTmuxBackend 签名** → ⚠️ breaking——同步更新 `services/tmux/controller/spawn.rs`
4. **修改 tmux wire protocol**（未来）→ ⚠️ breaking——同步更新 `services/tmux/protocol/` + INTERFACE.md §2.2