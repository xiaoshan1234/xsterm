# Domain · Session — 职责

> **位置**：`src-tauri/src/domain/session/`
> **类型**：⭐ 核心 domain（session 元数据 = 跨多个 commands module 共享的 source of truth）
> **被调用方**：`commands/session`、`commands/terminal`、`commands/shell`
> **Frontend 对应**：[`../../../frontend/service/session/RESPONSIBILITY.md`](../../../frontend/service/session/RESPONSIBILITY.md)（frontend 镜像状态、backend 协议 + 状态机）

## 1. 这个 domain 负责什么

session domain 是 backend 的**中央 session 状态机**——所有 session（local PTY / SSH / tmux pane）的元数据注册表 + 生命周期编排 + 后端 backend 实现 + 纯数据 + 算法。

"session 状态机"（原 `services/session/`）和"session 纯类型 + 算法"（原 `models/session/`）分两个目录——**合并为 `domain/session/`**，按文件分（types / rules / state）。

承担 4 大类职责：

### 1.1 状态机层

1. **session 注册表**——`DashMap<u32, Arc<ActiveSession>>`（按 id 索引的 O(1) 查找，Perf 004）
2. **session id 分配**——`Arc<SessionIdSource>` 单调递增 AtomicU32，3 种 backend 共享
3. **3 种 backend 实现**——local（PTY）、ssh（russh）、tmux_pane（持 controller Arc）
4. **session lifecycle 编排**——create / write / resize / close / list
5. **session 日志**——session 创建时 `start_session_logging`
6. **tmux controller 注册表代理**——`tmux_controllers: DashMap<u32, Arc<TmuxController>>`

### 1.2 数据 + 算法层

1. **session 配置类型**——`LocalSessionConfig / SSHSessionConfig / SessionConfig`（enum 分发）
2. **session 元数据类型**——`SessionInfo`（IPC 序列化）、`SessionType`（local/ssh/tmux 区分）
3. **id 分配器类型**——`SessionIdSource`（Arc 共享 + AtomicU32 单调递增）
4. **算法**（rules）——纯变更函数（`withStatus / applyDisplayConfig / withCapability`）

### 1.3 错误处理

- `SessionError`（thiserror derive）——`SessionConfigError / SessionError / SessionBackendError`

## 2. 这个 domain **不**负责什么

- **不持有 pane tree / workspace 状态** —— workspace 状态完全 frontend 持有
- **不持有 settings** —— 归各归属 module（CapabilityFlags / SizingMode / DisplayConfig / EnvConfig / SshAuthMethod / SessionLoggingConfig 等 → session，LogConfig runtime → persistence）
- **不直接持久化** —— 持久化能力由 `domain/terminal::attached_tmux` + `commands/shell::log_config` 提供；session 不 import `tauri_plugin_store`
- **不实现 tmux 协议** —— tmux 协议归 `domain/terminal/`（3 层架构下归 terminal，不是独立 tmux domain）
- **不监听 Tauri 事件** —— 事件推送由 controller / bridge 内部完成，session 不直接订阅
- **不渲染 UI** —— backend 无 UI

## 3. 子结构

```
domain/session/
├── types.rs              # 纯数据 + serde derive：SessionType / SessionInfo / SessionConfig / LocalSessionConfig / SSHSessionConfig / SessionLoggingConfig / SizingMode / DisplayConfig / EnvConfig / SessionIdSource
├── rules.rs              # 纯算法：withStatus / applyDisplayConfig / withCapability
├── state.rs              # SessionManager + 注册表 + id 分配（状态机）
├── backends/             # 3 种 backend 实现（trait object）
│   ├── traits.rs         # SessionBackend trait（抽象接口）
│   ├── local.rs          # LocalSession + PtyPair（拆自 `local_session/`）
│   ├── ssh.rs            # SshSession + russh 连接（拆自 `ssh_session/`）
│   └── tmux_pane.rs      # TmuxPaneHandle（拆自 `tmux_session` 内嵌部分）
├── log.rs                # start_session_logging（拆自 `session_log.rs`）
├── api.rs                # ⭐ 唯一对外入口（pub SessionManager + pub typed wrappers）
├── errors.rs             # SessionError / SessionConfigError / SessionBackendError（thiserror）
└── *.test.rs             # mockall 单测（拆自 `tests.rs`）
```

types + rules + state 三个文件按"数据 vs 算法 vs 状态机"分——同一个 domain 内**按文件分**（不是按子目录分），保持轻量。

** 文件迁移**：

| 位置 | 位置 |
|--|--|
| `services/session/manager.rs`（3000+ 行） | `domain/session/state.rs` + `backends/{traits,local,ssh,tmux_pane}.rs` |
| `services/session/registry.rs` | `domain/session/state.rs`（合并到 SessionManager） |
| `services/session/id.rs` | `domain/session/types.rs`（SessionIdSource 是类型） |
| `services/session/log.rs` | `domain/session/log.rs`（不变） |
| `services/session/errors.rs` | `domain/session/errors.rs`（合并 SessionError + SessionConfigError） |
| `services/session/backends/traits.rs` | `domain/session/backends/traits.rs` |
| `services/session/backends/local.rs` | `domain/session/backends/local.rs` |
| `services/session/backends/ssh.rs` | `domain/session/backends/ssh.rs` |
| `services/session/backends/tmux_pane.rs` | `domain/session/backends/tmux_pane.rs` |
| `models/session/types.rs` | `domain/session/types.rs`（合并 types + SessionIdSource） |
| `models/session/rules.rs` | `domain/session/rules.rs` |
| `models/session/accessor.rs` | **删除**——纯查询合并到 rules（`withStatus` 等已是 pure function） |
| `models/session/errors.rs` | `domain/session/errors.rs`（合并） |

## 4. 跟其他 domain 的关系

| domain | 关系 |
|--|--|
| `domain/terminal` | session **不直接** import `terminal::controller::*` 字段——通过 `TmuxController::controller_id()` 公开方法 + `Arc<TmuxController>` 引用持有。bug 0009 根因是字段直读，v4 严格走 trait / public method |
| （已删除——workspace 状态完全 frontend 持有）| 不依赖 |
| （已删除——见各归属 domain）| session 创建时**不直接**读 settings（settings 是横切，由 `commands/` 编排注入 default 值）|
| （已删除——v6 砍） | session 不直接 import `tauri_plugin_store`——持久化由 `commands/terminal/api（attached_tmux）` + `commands/shell/api（log_config）` 触发 |
| `infra/*` | session 通过 `infra::pty::PtySystem` / `infra::ssh::SshBackend` trait 调底层——session 持有 trait object，不持有静态方法 |

## 5. 跟 commands 的关系

| commands module | 怎么用 domain/session |
|--|--|
| `commands/session` | `SessionManager::create_local` / `create_ssh` / `write` / `close` / `list` / `resize_*` —— 通过 `State<Arc<SessionManager>>` 注入 |
| `commands/terminal` | `SessionManager::create_tmux` / `attach_tmux` / `create_tmux_pane` / `kill_tmux_pane` / `resize_tmux_pane` / `capture_tmux_pane` / `create_tmux_window` / `kill_tmux_window` / `rename_tmux_window` / `list_attached_tmux_servers` / `detach_tmux_controller` / `close_tmux_controller`（kill server）—— session manager **代理** tmux controller 操作 |
| （已删除）| session_manager 提供 session 元数据读取 + 创建 |
| `commands/shell` | session **不**被 shell 直接调——所有 session 创建由 frontend invoke 触发 |

**关键**：commands 通过 `commands/<module>/api.rs` 的 pure function 调用 domain/session；session manager 不感知 IPC。

## 7. 这个 domain 的"产品语言"术语

- **session** —— 一个后台进程 + 它的连接配置 + 状态
- **local session** —— 本地 PTY（通过 `LocalSession + PtyPair` 实现）
- **ssh session** —— 远程 SSH（通过 `SshSession + russh` 实现）
- **tmux session / pane** —— tmux -CC controller 下的 pane（通过 `TmuxPaneHandle` 实现，controller 在 `domain/terminal/`）
- **session id** —— AtomicU32 单调递增的全局唯一 id（3 种 backend 共享）
- **ActiveSession** —— enum，3 种 backend 的 trait object 容器
- **SessionBackend trait** —— 抽象接口：`get_session_info` / `get_capabilities` / `write` / `resize` / `close`

## 8. 关键设计约束

### 8.1 SessionManager 持有所有可变状态

```rust
pub struct SessionManager {
    sessions: DashMap<u32, Arc<ActiveSession>>,
    session_id_source: Arc<SessionIdSource>,
    pty_system: Box<dyn PtySystem>,
    ssh_backend: Arc<dyn SshBackend>,
    tmux_controllers: DashMap<u32, Arc<TmuxController>>,
    next_controller_id: AtomicU32,
}
```

**并发模型**（Perf 004）：

- `sessions` 是 DashMap——所有单 session 操作（write / resize / info / close）只需 `&self` 借 manager + `DashMap::get`
- `next_id` / `next_controller_id` 是 AtomicU32
- create 和 close 是唯一 mutating 入口；两者需要独占 inner backend（`Arc::try_unwrap`）

### 8.2 3 种 backend 通过同一个 enum 持有

```rust
pub(crate) enum ActiveSession {
    Pty(Box<dyn SessionBackend + Send>),
    Ssh(Box<SshSession>),
    Tmux(Box<TmuxPaneHandle>),
}
```

**关键**：`SessionBackend` trait 是抽象接口；3 种 backend 实现该 trait。`write` / `resize` / `close` 通过 trait object 调度——session_manager 不知道具体 backend 类型。

### 8.3 tmux pane handle 是 session 的 backend，但 controller 在 terminal domain

```rust
pub struct TmuxPaneHandle {
    pub controller: Arc<TmuxController>,  // ← 借 domain/terminal
    pub tmux_pane_id: String,
    pub info: SessionInfo,
    pub capabilities: CapabilityFlags,
}
```

**约束**：

- session 通过 `controller.controller_id()` / `controller.send_keys()` 等公开方法调
- session **不** import `domain::terminal::controller::*` 字段（fix bug 0009 的根本要求）
- session 通过 `controller: Arc<TmuxController>` 持有引用——TmuxController 实例由 `domain/terminal/` domain 创建

### 8.4 session id 全局共享

3 种 backend 都从 `SessionIdSource::allocate()` 取 id——一个 AtomicU32 单调递增。所有 session（local / ssh / tmux）共享同一 id 空间。

**关键**：tmux controller 内部 dispatch task 通过 `Arc<dyn Fn() -> u32>` 闭包注入 allocator——controller **不**有自己的 id allocator（ `next_xsterm_id` 已删除）。

### 8.5 日志创建失败不影响 session 创建

```rust
let logging_config = SessionLoggingConfig::default();
if let Err(e) = start_session_logging(id, &logging_config) {
    tracing::warn!("Failed to start session logging for session {}: {}", id, e);
}
```

日志写入失败仅 warn，不阻断 session 生命周期。

## 10. 跟 frontend service 的职责分叉

| 维度 | frontend service/session | backend domain/session |
|--|--|--|
| 类型定义 | TS interface | Rust serde struct |
| 状态机 | zustand store + reducer | `Arc<DashMap>` + method |
| 算法 | pure function（accessor / rules）| pure function（rules）|
| IPC 桥 | `bridge.ts` listen backend → mutate store | 不存在——backend 直接 emit |
| 持久化 | frontend `infra/store` 直存 sessions.json | backend **不持久化** sessions.json（frontend 直存） |
| 3 种 backend 实现 | 不存在（frontend 只持有镜像 + capability flags） | 存在——LocalSession / SshSession / TmuxPaneHandle |
| tmux controller 代理 | 不存在 | 存在——tmux_controllers DashMap |

**frontend 是镜像 + 状态管理，backend 是协议 + 状态机 + 持久化**——两边自然分叉，但**域命名相同**便于跨语言导航。