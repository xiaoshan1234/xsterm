# Domain · Session — 对下依赖

> **位置**：`src-tauri/src/domain/session/`

## 1. 依赖图

```
domain/session/
├── state.rs          ────►  domain/terminal::{TmuxController, TmuxCcConfig, ...} (Arc<引用>)
├── state.rs          ────►  infra/pty::{PtySystem, NativePtySystem} (Box<dyn>)
├── state.rs          ────►  infra/ssh::{SshBackend, SshBackendImpl} (Arc<dyn>)
├── state.rs          ────►  infra/tauri::{AppBackend, RealAppBackend} (Arc<dyn>)
├── state.rs          ────►  domain/terminal/backends/tmux_pane.rs (TmuxPaneHandle impl)
├── backends/local.rs ────►  infra/pty::{PtyPair, NativePtySystem} (PTY 实现)
├── backends/ssh.rs   ────►  infra/ssh/{SshBackend, SshSessionHandle} (russh 实现)
├── backends/tmux_pane.rs ──►  domain/terminal::TmuxController (借 controller)
├── types.rs          ────►  domain/session::{SizingMode, DisplayConfig, EnvConfig, SshAuthMethod}
├── types.rs          ────►  domain/terminal::{TmuxCcConfig, AttachedTmuxServer}
├── types.rs          ────►  domain/cross_cutting::{CapabilityFlags, SplitDirection, SessionLoggingConfig}
├── rules.rs          ────►  (self-only: SessionInfo)
├── log.rs            ────►  crate::logging_setup (tracing appender)
└── errors.rs         ────►  thiserror::Error
```

## 2. domain/terminal（核心依赖）

session 通过 `TmuxController` 公开方法访问 tmux 功能：

| 调用 | 来源 | 何时 |
|—|—|—|
| `TmuxController::spawn_create(config, backend, ssh_backend, controller_id, allocator)` | `domain/terminal/controller/spawn.rs` | `SessionManager::create_tmux` / `attach_tmux` |
| `TmuxController::await_first_pane()` | `domain/terminal/controller/sync.rs` | create / attach 后等待 bootstrap pane |
| `TmuxController::take_initial_state()` | `domain/terminal/controller/sync.rs` | create / attach 后等待 windows + panes |
| `TmuxController::tmux_window_id_for_pane(&pane_id)` | `domain/terminal/controller/registry.rs` | 查 pane 所属 window id |
| `TmuxController::controller_id()` | `domain/terminal/controller/mod.rs` | tmux pane handle 持有 |
| `TmuxController::session_name()` | `domain/terminal/controller/mod.rs` | `list_attached_tmux_servers` projection |
| `TmuxController::send_keys(&pane, bytes)` | `domain/terminal/controller/commands.rs` | `TmuxPaneHandle::write` |
| `TmuxController::resize_pane(&pane, rows, cols)` | 同上 | `TmuxPaneHandle::resize` |
| `TmuxController::unbind_pane(&pane)` | `domain/terminal/controller/registry.rs` | `TmuxPaneHandle::close` |
| `TmuxController::capture_pane(&pane, lines)` | `domain/terminal/controller/commands.rs` | `SessionManager::capture_tmux_pane` |
| `TmuxController::detach()` | 同上 | `SessionManager::detach_tmux_controller` |

**约束**：

- session **不** import `TmuxController` 的字段（pane_bindings / window_bindings / initial_state / dispatch_task 等）
- session **不** import `domain::terminal::bridge::*`（bridge 是 controller 内部事件推送机制）
- session **不** import `domain::terminal::protocol::*`（纯协议层，controller 封装）
- session 通过 `Arc<TmuxController>` 持有引用——可调用所有公开方法

**关键（bug 0009 防御）**： `SessionManager::create_tmux` 直读 `TmuxController.window_bindings` HashMap——严格禁止字段直读。所有跨 domain 访问走 trait / public method。

## 3. domain/session/backends（自身子模块）

3 种 backend 实现都跟 `infra::pty` / `infra::ssh` 绑定：

```rust
// backends/local.rs
pub struct LocalSession {
    backend: PtyPair,        // 来自 infra/pty::NativePtySystem::openpty()
    pid: Option<u32>,
    writer: Box<dyn Write + Send>,
    info: SessionInfo,
    capabilities: CapabilityFlags,
}

impl LocalSession {
    pub fn new(
        config: &LocalSessionConfig,
        pty_system: &dyn PtySystem,
    ) -> Result<Self, SessionError>;
}
```

```rust
// backends/ssh.rs
pub struct SshSessionHandle {
    config: SSHSessionConfig,
    channel: russh::Channel,
    writer: ...,
}

impl SshSessionHandle {
    pub async fn connect(
        config: &SSHSessionConfig,
        ssh_backend: &dyn SshBackend,
    ) -> Result<Self, SessionError>;
}
```

```rust
// backends/tmux_pane.rs
pub struct TmuxPaneHandle {
    pub controller: Arc<TmuxController>,   // 借 domain/terminal
    pub tmux_pane_id: String,
    pub info: SessionInfo,
    pub capabilities: CapabilityFlags,
}

impl TmuxPaneHandle {
    pub fn from_controller(controller: Arc<TmuxController>, pane_id: &str) -> Self;
}
```

**约束**：

- 3 种 backend 都实现 `SessionBackend` trait（trait 定义在 `backends/traits.rs`）
- backend 通过 `Box<dyn SessionBackend + Send>` trait object 调度
- backend **不** import `tauri` / `tauri-plugin-store`
- backend **不** import 其他 domain（除了 `domain/terminal::TmuxController`）

## 4. infra/*（外部资源依赖）

| infra 子模块 | session 调什么 | session 持有 |
|—|—|—|
| `infra/pty` | `PtySystem::openpty()` | `Box<dyn PtySystem>`（注入到 SessionManager） |
| `infra/pty` | `PtyPair` (write/read) | `PtyPair`（在 `backends/local.rs::LocalSession`） |
| `infra/ssh` | `SshBackend::connect(&config)` | `Arc<dyn SshBackend>`（注入到 SessionManager） |
| `infra/ssh` | `SshSessionHandle` (russh channel) | `SshSessionHandle`（在 `backends/ssh.rs::SshSessionHandle`） |
| `infra/tauri` | `AppBackend::emit()` / `emit_binary()` | `Arc<dyn AppBackend>`（每次 create 传入） |

**约束**：

- session 通过 trait 调 infra（`Box<dyn PtySystem>` / `Arc<dyn SshBackend>` / `Arc<dyn AppBackend>`）
- session **不** import `infra::pty::NativePtySystem` 等具体实现——只 import trait
- session **不** import `infra::ssh::SshBackendImpl`——只 import trait
- session **不** import `russh` / `portable-pty` 等外部 crate——这些 import 应该在 `infra/*` 内部

## 5. domain/session（settings 类型字段——已迁移到 session）

session types 引用 settings 的纯类型：

| 类型 | 用途 |
|—|—|
| `SizingMode` | `SessionInfo::sizing` 字段 |
| `DisplayConfig` | `SessionInfo::display` 字段 |
| `EnvConfig` | `LocalSessionConfig::env` 字段 |
| `SshAuthMethod` | `SSHSessionConfig::auth_method` 字段 |

**约束**：

- 引用的是**纯类型字段**（不含逻辑）
- 引用 `domain/session::*` 直接（不再绕道 domain/settings）

## 6. domain/cross_cutting

session types 引用以下 cross-cutting 类型：

| 类型 | 用途 |
|—|—|
| `CapabilityFlags` | `SessionInfo::capabilities` 字段 |
| `SplitDirection` | session split 方向（local / ssh / tmux-cc 都用） |

cross-cutting 在 是 `domain/settings/cross_cutting/`（不再是独立 model domain）——内容是 settings 的"基础设施"。

## 7. domain/terminal（tmux 类型依赖）

session types 引用以下 terminal 类型：

| 类型 | 用途 |
|—|—|
| `TmuxCcConfig` | `SessionConfig::TmuxCc(TmuxCcConfig)` 变体 |
| `AttachedTmuxServer` | `auto_attach_on_startup` 的入参 |

**约束**：引用 `domain/terminal::*` 的纯类型字段。

## 8. crate::logging_setup

```rust
// log.rs
use crate::logging_setup::start_session_logging;

pub fn start_session_logging_for(
    session_id: u32,
    config: &SessionLoggingConfig,
) -> Result<(), SessionError> {
    start_session_logging(session_id, config).map_err(SessionError::Io)
}
```

**约束**：session 只调 `logging_setup` 的纯函数——不创建 / 管理 tracing subscriber（那是 settings 的责任）。

## 9. 内部依赖关系

```rust
domain/session/
├── types.rs              ← 纯数据（其他文件都依赖）
├── rules.rs             ← types（rules 接受 SessionInfo 返回新 SessionInfo）
├── backends/traits.rs   ← types + errors（SessionBackend trait）
├── backends/local.rs    ← traits + types + errors + infra/pty
├── backends/ssh.rs      ← traits + types + errors + infra/ssh
├── backends/tmux_pane.rs ← traits + types + errors + domain/terminal
├── log.rs               ← errors（不依赖其他 session 内部文件）
├── state.rs             ← types + rules + backends/* + errors + infra/*（状态机依赖最广）
└── errors.rs            ← types（SessionError enum）
```

**关键约束**：

- types / rules / errors 是**最底层**——其他文件依赖它们
- state.rs 是**依赖最广的文件**——是正常的（状态机集成所有部分）
- backends 之间**不**互相依赖（`local.rs` / `ssh.rs` / `tmux_pane.rs` 互相不引用）

## 10. 跨域依赖

| domain | session 对其依赖 |
|—|—|
| `domain/terminal` | ✅ 强依赖（Arc<TmuxController> 引用 + 类型字段） |
| （已删除——见各归属 domain）| ✅ 弱依赖（仅类型字段） |
| `domain/cross_cutting`（在 settings 下） | ✅ 弱依赖（仅 CapabilityFlags / SplitDirection） |
| `domain/persistence` | ❌ 不依赖（持久化由 commands/<target>/api（log → shell，attached_tmux → terminal）触发） |
| `domain/workspace` | ❌ 不依赖（MVP 不调） |
| `infra/pty` | ✅ 依赖（PtySystem trait + PtyPair） |
| `infra/ssh` | ✅ 依赖（SshBackend trait + SshSessionHandle） |
| `infra/tauri` | ✅ 依赖（AppBackend trait，emit 事件用） |

## 11. 设计意图：session 是"backend 中央状态机"

反模式（按资源类型切）：
- `services/session_manager.rs`（3000+ 行）——同时管 local/ssh/tmux 三种 session
- `services/session_log.rs` 平铺——跟 session 逻辑耦合
- `services/tmux_session/` 内嵌 TmuxPaneHandle——跨子目录字段直读（bug 0009 根因）

边界（按数据 domain 切，3 层架构）：
- session domain = 中央状态机（SessionManager）+ types + rules + 3 backend impl
- 3 个 backend 实现（pty_system / ssh_backend / tmux controller）通过 trait 调度
- 所有跨域访问走 trait / public method——**禁止字段直读**

## 13. 不允许的依赖

- ❌ `domain/session/` → `domain/workspace/*`（session 不持有 workspace 状态）
- ❌ `domain/session/` → `domain/persistence/*`（持久化由 commands 触发）
- ❌ `domain/session/` → `tauri`（session 不感知 IPC 边界）
- ❌ `domain/session/` → `tokio::main` / `actix` / `async-std`（session 允许 tokio::process / tokio::io 等具体 API）
- ❌ `domain/session/backends/*` 之间互相 import（每个 backend 独立）

## 14. 依赖变更流程

1. **新增 SessionManager method** → 加 `domain/session/state.rs` 方法 + 更新 INTERFACE §2 + 检查所有 commands 调用方 + 检查 frontend 类型
2. **新增 typed wrapper** → 加 `domain/session/backends/{local,ssh,tmux_pane}.rs` 类型 + 更新 INTERFACE §3
3. **修改 SessionBackend trait** → ⚠️ breaking——3 种 backend impl 全部更新 + INTERFACE §5
4. **修改 SessionIdSource** → ⚠️ breaking——所有调用方更新（注意 `Arc<SessionIdSource>` 共享）
5. **新增 rule** → 加 `domain/session/rules.rs` 纯函数 + 更新 INTERFACE §4
6. **修改 types 字段** → ⚠️ breaking——serde tag 变化影响 IPC payload + frontend TS 类型同步