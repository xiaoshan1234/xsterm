# Infra · SSH — 对下依赖

> **位置**：`src-tauri/src/infrastructure/ssh/`

## 1. 依赖图

```
infrastructure/ssh/
├── traits.rs           ────►  std::process::ExitStatus          (run_command_capture_stdout 返回)
├── backend.rs          ────►  russh::{client, Config, Preferred}  (连接 + 认证 + channel)
├── backend.rs          ────►  russh_keys::key::KeyPair            (私钥解析)
├── session.rs          ────►  russh::Channel                      (russh channel)
├── upload.rs           ────►  models/cross_cutting::helpers::build_remote_image_path  (远端路径构造)
├── upload.rs           ────►  std::path::Path                     (本地路径)
├── probe.rs            ────►  tokio::task::spawn_blocking         (同步阻塞 → async 包装)
├── mock.rs             ────►  mockall                             (#[automock])
└── errors.rs           ────►  thiserror::Error                    (SshError derive)
```

**关键约束**：

- ssh 子模块**不** import `crate::services::*`
- ssh 子模块**不** import `crate::app::*`
- ssh 子模块**不** import `crate::commands::*`
- ssh 子模块**不** import 其他 infra 子模块（平级）
- ssh 子模块**只** import `std` + `russh` + `russh_keys` + `tokio` + `mockall` + `thiserror` + `models`

## 2. russh（核心外部依赖）

| 调用 | 来源 | 何时 |
|---|---|---|
| `russh::client::connect(host, port)` | `russh` crate | `SshBackendImpl::connect()` |
| `russh::client::Config::default()` | 同上 | 配置 ssh client |
| `russh::Preferred::COMPRESSED` | 同上 | 压缩偏好 |
| `client.awaited_authenticate(user, auth)` | 同上 | 密码 / 公钥认证 |
| `client.open_shell_channel()` | 同上 | 打开交互式 shell channel |
| `russh::Channel::make_writer()` / `make_reader()` | 同上 | 读写 channel |
| `Channel::request_window_change(rows, cols)` | 同上 | SSH window-change(resize)|

**约束**：

- ssh 子模块是**唯一**允许直接 import `russh` 的地方
- service 层通过 `SshBackend` trait 间接调用
- 升级 russh 版本只影响 `backend.rs / session.rs` 两个文件

## 3. russh_keys

| 调用 | 来源 | 何时 |
|---|---|---|
| `russh_keys::key::KeyPair::from_pkcs8(...)` | `russh-keys` crate | 解析 PKCS8 格式私钥 |
| `russh_keys::decode_pkcs8_private_key(...)` | 同上 | SSH 私钥解析 |

**约束**：私钥处理必须 redact logging——禁止 `tracing::info!("private key: {:?}", key)`。

## 4. tokio

| 调用 | 来源 | 何时 |
|---|---|---|
| `tokio::task::spawn_blocking` | `tokio` crate | `run_command_capture_stdout` 包装同步阻塞 |
| `tokio::time::timeout` | 同上 | SSH 连接超时控制 |
| `tokio::sync::mpsc` | 同上 | SshSession 内部读循环（russh 异步 API）|

**约束**：

- ssh 子模块**允许** import `tokio::process / tokio::sync / tokio::time` —— 这些是具体 I/O API
- ssh 子模块**禁止** import `tokio::main`（那是 binary 入口）

## 5. models

| 读取 | 来源 |
|---|---|
| `SSHSessionConfig` | `models/session/types.rs` |

**约束**：models 是纯数据类型——ssh 可自由 import。

## 6. mockall

| 使用 | 何时 |
|---|---|
| `#[automock]` | 自动 mock `SshBackend` trait |
| `MockSshBackend::new()` | 测试代码构造 mock 实例 |
| `.expect_connect().returning(...)` | 配置 mock 行为 |

**约束**：infra 层统一用 `#[automock]`（自动 mock）；service 层用**手写 fixture**。

## 7. thiserror

| 调用 | 来源 | 何时 |
|---|---|---|
| `#[derive(thiserror::Error)]` | `thiserror` crate | `SshError` enum derive |
| `#[from] std::io::Error` | std | `SshError::Io` 自动 From |

## 8. 内部依赖关系

```
infrastructure/ssh/
├── traits.rs           ← 被 backend.rs / mock.rs 实现 + 被 service/session 实现
├── backend.rs          ← 实现 traits.rs + 使用 session.rs + errors.rs
├── session.rs          ← 实现 SshSessionHandle + 使用 errors.rs
├── upload.rs           ← 调用 traits.rs(SshBackend) + models/cross_cutting/helpers
├── probe.rs            ← 调用 traits.rs(SshBackend)
├── errors.rs           ← 被 traits.rs + backend.rs + session.rs 使用
└── mock.rs             ← 实现 traits.rs(#[automock])
```

**关键约束**：

- `traits.rs` **不** import `backend.rs / mock.rs / session.rs`（trait 是抽象）
- `backend.rs` **不** import `mock.rs`（具体实现 vs mock 平行）
- `session.rs` **不** import `traits.rs`（独立 trait 实现）

## 9. 跨子模块依赖（infra 平级）

| 依赖 | 何时 |
|---|---|
| `infra/pty::*` | ❌ 不依赖 |
| `infra/tmux::*` | ❌ 不依赖 |
| `infra/tauri::*` | ❌ 不依赖 |

**关键**：4 个 infra 子模块是**平级**——互不依赖。

## 10. 跨层依赖（infra → service/app）

| 依赖 | 何时 |
|---|---|
| `crate::services::*` | ❌ 不依赖 |
| `crate::app::*` | ❌ 不依赖 |
| `crate::commands::*` | ❌ 不依赖 |
| `crate::models::session::SSHSessionConfig` | ✅ 读纯数据类型 |
| `crate::models::cross_cutting::helpers::build_remote_image_path` | ✅ 调跨域纯 helper |

## 11. 设计意图:ssh 是「SSH 协议的物理封装」

v3 反模式：`infrastructure/ssh.rs` 单文件 700+ 行，所有 SSH 相关逻辑混在一起——SshBackend trait + SshBackendImpl + SshSession + upload_file + run_command + from 转换。

v4 边界：

- ssh 子模块是**单一外部资源（SSH 协议）的物理封装**——`russh` crate 调用都集中在这里
- service 层通过 `SshBackend` trait 抽象——可 mock 替换
- SshSession 也通过 `SshSessionHandle` trait 抽象——v3 具体类型持有改为 v4 trait object
- error 集中在 `errors.rs`——typed error 模式

## 12. v3 → v4 跨调用迁移

| v3 现状 | v4 改法 |
|---|---|
| `infrastructure/ssh.rs::SshBackend trait` | `infrastructure/ssh/traits.rs` |
| `infrastructure/ssh.rs::SshBackendImpl` | `infrastructure/ssh/backend.rs` |
| `infrastructure/ssh.rs::SshSession` | `infrastructure/ssh/session.rs::SshSession` struct + `SshSessionHandle` trait |
| `infrastructure/ssh.rs::upload_file_via_ssh` | `infrastructure/ssh/upload.rs` |
| `infrastructure/ssh.rs::run_command_capture_stdout` | `infrastructure/ssh/probe.rs` |
| `infrastructure/ssh.rs` 内 inline error | `infrastructure/ssh/errors.rs::SshError`(thiserror derive) |
| 无 mock | `infrastructure/ssh/mock.rs::MockSshBackend`(`#[automock]`) |
| `services/session_manager.rs::Box<SshSession>` | `services/session/backends/ssh.rs::Box<dyn SshSessionHandle>` |
| 所有 `use crate::infrastructure::ssh::X` | `use crate::infrastructure::ssh::{traits, backend, session, upload, probe, mock, errors}::X` |

## 13. 不允许的依赖

- ❌ `infrastructure/ssh/` → `crate::services::*`
- ❌ `infrastructure/ssh/` → `crate::app::*`
- ❌ `infrastructure/ssh/` → `crate::commands::*`
- ❌ `infrastructure/ssh/` → 其他 infra 子模块
- ❌ `infrastructure/ssh/` → `tokio::main`
- ❌ `infrastructure/ssh/traits.rs` → `infrastructure/ssh/backend.rs`（trait 是抽象，不依赖 impl）
- ❌ `infrastructure/ssh/` → `infrastructure/ssh/mock.rs` 在非测试代码（mock 只用于 service 测试）
- ❌ `infrastructure/ssh/` → 直接 import `russh` 在 service 层（service 走 trait）
- ❌ `infrastructure/ssh/` → 任何 host key 校验实现（**当前禁用**）

## 14. 依赖变更流程

1. **新增 SshBackend trait method** → 加 `traits.rs` + 更新 mock + 更新 `backend.rs` impl + INTERFACE.md §2.1
2. **新增 SshSessionHandle method** → 加 `session.rs` + INTERFACE.md §2.2
3. **新增 SshError 变体** → 加 `errors.rs` 变体 + INTERFACE.md §2.4 + 检查所有 `?` 调用方
4. **修改 russh API** → 升级 Cargo.toml + 更新 `backend.rs / session.rs` 调用 + 跑集成测试
5. **修改 upload_file_via_ssh 签名** → ⚠️ breaking——同步更新 `app/session/api.rs::upload_image_to_ssh_session`
6. **启用 host key 校验**（未来）→ ⚠️ 安全评审 + 加 host 持久化存储 + UX 改动 + 在 `RESPONSIBILITY.md` §10 更新文档