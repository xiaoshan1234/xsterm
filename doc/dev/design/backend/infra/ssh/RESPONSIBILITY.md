# Infra · SSH — 职责

> **位置**：`src-tauri/src/infrastructure/ssh/`
> **类型**：⭐ 外部资源 — SSH 协议
> **被使用方**：`services/session`、`services/session_log`
> **外部依赖**：`russh` crate（v0 用 `0.50.0-beta.7`）

## 1. 这个子模块负责什么

ssh 子模块是 backend 与 **SSH 协议**交互的物理适配层——所有 `russh` crate 调用都集中在这里。

承担 5 类职责：

1. **SshBackend trait 定义**——抽象 SSH 连接 + 命令执行 + 文件上传接口（让 service 层能 mock）
2. **SshBackendImpl**——基于 `russh` crate 的实现（连接 + 认证 + 读循环 + 命令执行）
3. **SshSession struct**——russh channel + 读循环（被 services/session/manager.rs 通过 SshBox 持有）
4. **upload_file_via_ssh / upload_image**——SCP 文件上传（用于粘贴图片到 SSH 服务器）
5. **run_command_capture_stdout**——一次性命令执行（用于 tmux probe）

## 2. 这个子模块 **不**负责什么

- **不实现 SSH 协议**——`russh` crate 实现
- **不持有 session 元数据**——session 元数据归 `models/session/types.rs::SessionInfo`
- **不处理 session lifecycle**——lifecycle 归 `services/session/manager.rs::SessionManager`
- **不存储 SSH 凭据**——凭据由 service 层通过 `SSHSessionConfig` 传入（不持久化）
- **不验证 host key**——**当前禁用**（见 §10 安全警告）

## 3. 子结构

```
infrastructure/ssh/
├── mod.rs              re-export 7 文件
├── traits.rs           SshBackend trait 定义
├── backend.rs          SshBackendImpl(russh 连接 + 读循环)
├── session.rs          SshSession struct(russh channel + 读写循环)
├── upload.rs           upload_file_via_ssh / upload_image(SCP)
├── probe.rs            run_command_capture_stdout(tmux probe 用)
├── mock.rs             #[automock] MockSshBackend
└── errors.rs           SshError(thiserror derive,含 host-key 警告)
```

**v0 → v1 拆分映射**：v0 的 `infrastructure/ssh.rs`（包含 SshBackend trait + SshBackendImpl + SshSession + upload_file + run_command + from 等所有逻辑）单文件 ~700+ 行 → v1 拆为 7 文件，按 trait / impl / struct / 上传 / 探测 / mock / errors 分类。

## 4. 跟 frontend infra 的关系

frontend **没有** `infra/ssh` —— frontend 不直接调 SSH（通过 IPC 调 backend 的 `create_ssh_session` / `write_session` / `resize_ssh_session` / `upload_image_to_ssh_session`）。

| backend infra/ssh | frontend 等价 |
|---|---|
| `SshBackend::connect(config)` | ❌（frontend 不可见）|
| `SshBackend::run_command_capture_stdout(cmd)` | ❌（frontend 通过 tmux probe 间接）|
| `upload_file_via_ssh(local, remote)` | ❌（frontend 通过 upload_image_to_ssh_session 间接）|

**关键**：backend infra/ssh 是**纯 backend 概念**——frontend 完全不感知 SSH 协议。

## 5. 跟其他 backend infra 子模块的关系

| 子模块 | 关系 |
|---|---|
| `infra/pty` | 平级；不互相依赖 |
| `infra/tmux` | 平级；tmux 通过 SSH backend 间接（`SshBackend::run_command_capture_stdout` 用于 SSH 上的 tmux probe）|
| `infra/tauri` | 平级；ssh 不调 Tauri runtime |

**关键约束**：

- ssh 子模块**不** import 其他 infra 子模块
- ssh 子模块**不** import service / app / commands
- ssh 子模块**只**依赖 models（pure data）+ russh crate

## 6. 跟 service / app 的关系

| 层 | 怎么用 infra/ssh |
|---|---|
| `services/session` | `SessionManager::ssh_backend: Arc<dyn SshBackend>` 字段持有；`create_ssh` 调用 `ssh_backend.connect(config)` |
| `services/session_log` | 不直接调 ssh——log message 通过 tracing |
| `app/session` | `upload_image_to_ssh_session` IPC handler 内部调 `infra/ssh::upload_file_via_ssh` |
| `app/terminal` | `SessionManager::probe_tmux_session_exists`（SSH 路径）间接调 `SshBackend::run_command_capture_stdout` |

## 7. 这个子模块的"产品语言"术语

- **SSH** —— Secure Shell 协议（russh crate 实现）
- **SshBackend trait** —— 抽象 SSH 连接接口（mockable）
- **SshBackendImpl** —— SshBackend 的 russh 实现
- **SshSession** —— 单个 SSH session 的状态机（russh channel + 读循环）
- **run_command_capture_stdout** —— 一次性命令执行（同步获取 stdout）
- **upload_file_via_ssh** —— SCP 文件上传（单文件）
- **upload_image** —— 图片上传 wrapper（构造远端路径 + 调 upload_file_via_ssh）
- **host key** —— 服务器 SSH 公钥指纹（**当前禁用校验**——见 §10）
- **russh channel** —— russh crate 的 SSH 通道抽象

## 8. 关键设计约束

### 8.1 SshBackend trait 必须 Send + Sync

```rust
pub trait SshBackend: Send + Sync {
    fn connect(&self, config: &SSHSessionConfig) -> Result<Box<dyn SshSessionTrait>, SshError>;
    fn run_command_capture_stdout(&self, config: &SSHSessionConfig, command: &str) -> Result<(String, ExitStatus), SshError>;
}
```

**关键**：`Send + Sync` 让 `Arc<dyn SshBackend>` 在 `SessionManager` 中使用。

### 8.2 SshSessionTrait 抽象化单个 SSH session

```rust
pub trait SshSessionTrait: Send + Sync {
    fn write(&self, bytes: &[u8]) -> Result<(), SshError>;
    fn read(&self) -> Result<Vec<u8>, SshError>;  // 非阻塞
    fn resize(&self, rows: u16, cols: u16) -> Result<(), SshError>;  // window-change
    fn close(&mut self) -> Result<(), SshError>;
}
```

**关键**：SshSessionTrait 是 `services/session/backends/ssh.rs::SshSession` 的**接口**——`SshSession` 实现该 trait。**这与 v0 不同**：v0 的 `SshSession` 是具体 struct，直接被 `SessionManager` 通过 `Box<SshSession>` 持有。

### 8.3 host key 校验**当前禁用**(已知安全债)

```rust
// infrastructure/ssh/backend.rs
impl SshBackendImpl {
    async fn connect(&self, config: &SSHSessionConfig) -> Result<Box<dyn SshSessionTrait>, SshError> {
        let russh_config = russh::Config {
            // ↓↓↓ 禁用 host key 校验（KNOWN SECURITY DEBT）↓↓↓
            preferred: Preferred::COMPRESSED,
            ..Default::default()
            // ↑↑↑ 禁用 host key 校验（KNOWN SECURITY DEBT）↑↑↑
        };
        // ...
    }
}
```

**警告**：见 §10 安全警告——禁止在本子模块之外的位置重新打开或绕过 host key 校验。

### 8.4 upload_image 是 upload_file_via_ssh 的 wrapper

```rust
// infrastructure/ssh/upload.rs
pub fn upload_image(
    ssh_config: &SSHSessionConfig,
    ssh_backend: &dyn SshBackend,
    local_path: &Path,
    filename: &str,
) -> Result<String, SshError> {
    let remote_path = build_remote_image_path(filename)?;  // ← 来自 models/cross_cutting/helpers
    upload_file_via_ssh(ssh_config, ssh_backend, local_path, &remote_path)?;
    Ok(remote_path)
}
```

**关键**：`build_remote_image_path` 是**跨域纯 helper**——定义在 `models/cross_cutting/helpers.rs`，ssh upload 模块调用。

### 8.5 mockall 自动 mock

```rust
// infrastructure/ssh/mock.rs
#[automock]
impl SshBackend for MockSshBackend {
    fn connect(&self, config: &SSHSessionConfig) -> Result<Box<dyn SshSessionTrait>, SshError> { ... }
    fn run_command_capture_stdout(&self, config: &SSHSessionConfig, command: &str) -> Result<(String, ExitStatus), SshError> { ... }
}
```

### 8.6 错误统一用 thiserror derive

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
    HostKeyUnchecked,  // 占位——明示当前禁用 host key 校验

    #[error("ssh command exit status: {0}")]
    NonZeroExit(i32),

    #[error("ssh upload failed: {0}")]
    Upload(String),
}
```

## 9. v0 → v1 拆分映射

| v0 位置 | v1 位置 | 改动 |
|---|---|---|
| `infrastructure/ssh.rs::SshBackend trait` | `infrastructure/ssh/traits.rs` | 抽到独立文件 |
| `infrastructure/ssh.rs::SshBackendImpl` | `infrastructure/ssh/backend.rs` | 抽到独立文件 |
| `infrastructure/ssh.rs::SshSession` | `infrastructure/ssh/session.rs` | 抽到独立文件 |
| `infrastructure/ssh.rs::upload_file_via_ssh` | `infrastructure/ssh/upload.rs` | 抽到独立文件 |
| `infrastructure/ssh.rs::run_command_capture_stdout` | `infrastructure/ssh/probe.rs` | 抽到独立文件 |
| `infrastructure/ssh.rs` 内 inline enum error | `infrastructure/ssh/errors.rs::SshError` | 抽到独立文件 + thiserror derive |
| 无 mock | `infrastructure/ssh/mock.rs::MockSshBackend` | 新增 `#[automock]` |
| `services/session_manager.rs::Box<SshSession>` | `services/session/backends/ssh.rs::Box<dyn SshSessionTrait>` | v1 通过 trait object 持有 |

## 10. ⚠️ 安全警告（继承 v0，重要）

### 10.1 host key 校验**当前禁用**

**AGENTS.md 已记录**：xsterm v0 禁用了 SSH host key 校验。这是已知安全债。

**禁止**：

- ❌ 在 ssh 子模块之外的位置重新打开 host key 校验
- ❌ 在 service / app / commands 层 bypass 该限制
- ❌ 关闭 `SshError::HostKeyUnchecked` 警告以避免警告

**未来启用**：必须经过完整的安全评审 + 用户配对 UX 设计 + 已知 host 持久化策略。

### 10.2 SSH 凭据处理

**当前**：`SSHSessionConfig` 持有 password 或 private_key——通过 IPC 序列化传送到 backend。**禁止**：

- ❌ 持久化凭据到 disk（`attached_tmux.json` 不存 SSH 凭据）
- ❌ logging SSH password / private key（必须 redact）

**v1 改进**：在 `SSHSessionConfig` 加 `#[serde(skip_serializing_if = ...)]` 标记——避免凭据被意外持久化。

### 10.3 russh crate 版本

v0 用 `russh = "0.50.0-beta.7"`——beta 版本可能不稳定。升级路径：

- 升级前跑完整 SSH 集成测试
- 检查 russh API breaking change 文档
- 更新 mock + 测试 + service 调用方

## 11. 强制约束（可机械校验）

```bash
# infra/ssh 不依赖 service / app / commands
grep -rn 'use crate::\(services\|app\|commands\)' src-tauri/src/infrastructure/ssh/
# 必须为空

# infra/ssh 不依赖其他 infra 子模块
grep -rn 'use crate::infrastructure::\(pty\|tmux\|tauri\)' src-tauri/src/infrastructure/ssh/
# 必须为空

# infra/ssh 只能读 models 类型
grep -rn 'use crate::models::' src-tauri/src/infrastructure/ssh/ | grep -v '::types\|::accessor\|::helpers'
# 必须为空

# infra/ssh 不持有 tokio::main
grep -rn 'tokio::main' src-tauri/src/infrastructure/ssh/
# 必须为空

# infra/ssh 不禁用了 host key 校验的情况下不允许出现 hash known host 字符串
grep -rn 'verify_known_hosts' src-tauri/src/infrastructure/ssh/
# 必须为空（除非启用校验）

# infra/ssh 不 print password
grep -rn 'println.*password\|tracing.*password' src-tauri/src/infrastructure/ssh/
# 必须为空
```

## 12. 跟 v0 的差异

| 维度 | v0 | v1 |
|---|---|---|
| 文件数 | 1 文件 ~700 行 | 7 文件（traits / backend / session / upload / probe / mock / errors） |
| 错误处理 | inline enum | 独立 `SshError`（thiserror derive） |
| mock | 无 | `#[automock]` 自动 mock |
| SshSession 抽象 | 具体 struct（直接持有）| `SshSessionTrait`（trait object 持有） |
| build_remote_image_path 归属 | `models/session.rs` | `models/cross_cutting/helpers.rs`（v1 model 拆分）|
| 与 frontend 镜像 | ❌（frontend 无 SSH） | 文档明确标注 "backend 独有" |

## 13. 测试

每个文件都有 `*.test.rs`：

- `traits.rs` 的 trait 定义编译时由 `#[automock]` 验证
- `backend.rs` 的 russh 连接需要真实 SSH server——集成测试标记 `#[ignore]`，跑测试时显式开启
- `session.rs` 的 read / write / resize 单测（mock channel）
- `upload.rs` 的 SCP 上传测试（mock SshBackend）
- `probe.rs` 的 run_command_capture_stdout 测试（mock SshBackend）
- `errors.rs` 的 SshError Display + From 派生测试

**为什么 infra 测试最重要**：

- infra 是 backend 最底层的 I/O 层
- SSH 连接 / 上传 / 命令执行的 bug 影响所有 SSH session
- mock 正确性 = service 层单测可依赖的关键

## 14. 依赖变更流程

1. **新增 SshBackend trait method** → 加 `traits.rs` + 更新 mock + 更新 `backend.rs` impl + INTERFACE.md §2.1
2. **新增 SshError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.3 + 检查所有 `?` 调用方
3. **修改 russh API** → 升级 Cargo.toml + 更新 `backend.rs / session.rs` 调用 + 跑集成测试
4. **修改 upload_file_via_ssh 签名** → ⚠️ breaking——同步更新 `app/session/api.rs::upload_image_to_ssh_session`
5. **启用 host key 校验**（未来）→ ⚠️ 安全评审 + 加 host 持久化存储 + UX 改动 + 在 §10 更新文档