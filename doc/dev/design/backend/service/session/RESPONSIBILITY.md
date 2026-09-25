# Service · Session — 职责

> **位置**：`src-tauri/src/services/session/`
> **类型**：⭐ 核心 domain（session 元数据 = 跨多个 app module 共享的 source of truth）
> **被调用方**：`app/session`、`app/terminal`、`app/workspace`（未来）、`app/shell`
> **Frontend 对应**：[`../../../frontend/service/session/RESPONSIBILITY.md`](../../../frontend/service/session/RESPONSIBILITY.md)

## 1. 这个 domain 负责什么

session domain 是 backend 的**中央 session 状态机**——所有 session（local PTY / SSH / tmux pane）的元数据注册表 + 生命周期编排 + 后端 backend 实现。

承担 6 类职责：

1. **session 注册表**——`DashMap<u32, Arc<ActiveSession>>`（按 id 索引的 O(1) 查找，Perf 004）
2. **session id 分配**——`Arc<SessionIdSource>` 单调递增 AtomicU32，3 种 backend 共享
3. **3 种 backend 实现**——local（PTY）、ssh（russh）、tmux_pane（持 controller Arc）
4. **session lifecycle 编排**——create / write / resize / close / list
5. **session 日志**——session 创建时 `start_session_logging`（拆自 v0 `services/session_log.rs`）
6. **tmux controller 注册表代理**——`tmux_controllers: DashMap<u32, Arc<TmuxController>>`（拆自 v0 内嵌于 `session_manager.rs`）

## 2. 这个 domain **不**负责什么

- **不持有 pane tree / workspace 状态** —— 归 `services/workspace/`（MVP 预留）
- **不持有 settings** —— 归 `services/settings/`
- **不直接持久化** —— 持久化能力归 `services/persistence/`；session 不 import `tauri_plugin_store`
- **不实现 tmux 协议** —— tmux 协议归 `services/tmux/`
- **不监听 Tauri 事件** —— 事件推送由 controller / bridge 内部完成，session 不直接订阅
- **不渲染 UI** —— backend 无 UI

## 3. 子结构

```
services/session/
├── api.rs            ⭐ 唯一对外入口
│                      - SessionManager struct (新位置)
│                      - SessionError enum (thiserror)
│                      - public trait: SessionBackend, PtySystem, SshBackend
├── manager.rs        SessionManager 主体（拆自 v0 session_manager.rs，按 backend 类型分组）
├── registry.rs       DashMap<u32, Arc<ActiveSession>> + tmux_controllers DashMap 访问器
├── id.rs             SessionIdSource（AtomicU32 分配器）
├── log.rs            start_session_logging（拆自 v0 session_log.rs）
├── errors.rs         SessionError / SessionBackendError
├── backends/
│   ├── local.rs      LocalSession + PtyPair（拆自 v0 services/local_session/*）
│   ├── ssh.rs        SshSession + russh 连接（拆自 v0 services/ssh_session/*）
│   └── tmux_pane.rs  TmuxPaneHandle（拆自 v0 tmux_session 内嵌部分）
└── *.test.rs         mockall 单测（拆自 v0 tests.rs）
```

## 4. 跟 v0 的差异（关键迁移点）

| v0 位置 | v1 位置 | 改动 |
|---|---|---|
| `services/session_manager.rs`（3000+ 行单文件） | `services/session/manager.rs` | 按 backend 类型分组，移除 tmux_controllers 内嵌逻辑 |
| `services/local_session/*`（4 文件） | `services/session/backends/local.rs` | 子模块化 |
| `services/ssh_session/*`（1 文件） | `services/session/backends/ssh.rs` | 子模块化 |
| `services/tmux_session/` 中的 `TmuxPaneHandle`（在 session_manager.rs 内联） | `services/session/backends/tmux_pane.rs` | 抽出独立模块 |
| `services/session_log.rs`（平铺） | `services/session/log.rs` | 子模块化 |
| `models/session.rs` 内的 `SessionIdSource` | `services/session/id.rs` | 从 models 移到 services（session 是 session 的核心，不属于纯模型）|

## 5. 跟其他 domain 的关系

| domain | 关系 |
|---|---|
| `services/tmux` | session **不直接** import `tmux::*` 字段——通过 `TmuxController::controller_id()` 公开方法 + `Arc<TmuxController>` 引用持有。bug 0009 根因是字段直读，v1 严格走 trait / public method |
| `services/workspace` | MVP 不调——pane tree 在 frontend store |
| `services/settings` | session 创建时**不直接**读 settings（settings 是横切，由 `app/` 编排注入 default 值）|
| `services/persistence` | session **不直接** import `tauri_plugin_store`——持久化由 `app/settings/api` 触发 |
| `infrastructure/*` | session 通过 `infra::pty::PtySystem` / `infra::ssh::SshBackend` trait 调底层——session 持有 trait object，不持有静态方法 |

## 6. 跟 app 的关系

| app module | 怎么用 services/session |
|---|---|
| `app/session` | `SessionManager::create_local` / `create_ssh` / `write` / `close` / `list` / `resize_*` —— 通过 `State<Arc<SessionManager>>` 注入 |
| `app/terminal` | `SessionManager::create_tmux` / `attach_tmux` / `create_tmux_pane` / `kill_tmux_pane` / `resize_tmux_pane` / `capture_tmux_pane` / `create_tmux_window` / `kill_tmux_window` / `rename_tmux_window` / `list_attached_tmux_servers` / `detach_tmux_controller` / `close_tmux_controller`（kill server）—— session manager **代理** tmux controller 操作 |
| `app/workspace`（未来）| session_manager 提供 session 元数据读取 + 创建 |
| `app/shell` | session **不**被 shell 直接调——所有 session 创建由前端 invoke 触发 |

**关键**：app 通过 `app/<module>/api.rs` 的 pure function 调用 session manager；session manager 不感知 IPC。

## 7. 这个 domain 的"产品语言"术语

- **session** —— 一个后台进程 + 它的连接配置 + 状态
- **local session** —— 本地 PTY（通过 `LocalSession + PtyPair` 实现）
- **ssh session** —— 远程 SSH（通过 `SshSession + russh` 实现）
- **tmux session / pane** —— tmux -CC controller 下的 pane（通过 `TmuxPaneHandle` 实现，controller 在 `services/tmux/`）
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

### 8.3 tmux pane handle 是 session 的 backend，但 controller 在 tmux domain

```rust
pub struct TmuxPaneHandle {
    pub controller: Arc<TmuxController>,  // ← 借 tmux domain
    pub tmux_pane_id: String,
    pub info: SessionInfo,
    pub capabilities: CapabilityFlags,
}
```

**约束**：

- session 通过 `controller.controller_id()` / `controller.send_keys()` 等公开方法调
- session **不** import `services::tmux::controller::*` 字段（fix bug 0009 的根本要求）
- session 通过 `controller: Arc<TmuxController>` 持有引用——TmuxController 实例由 `services::tmux/` domain 创建

### 8.4 session id 全局共享

3 种 backend 都从 `SessionIdSource::allocate()` 取 id——一个 AtomicU32 单调递增。所有 session（local / ssh / tmux）共享同一 id 空间。

**关键**：tmux controller 内部 dispatch task 通过 `Arc<dyn Fn() -> u32>` 闭包注入 allocator——controller **不**有自己的 id allocator（v0 的 `next_xsterm_id` 已删除）。

### 8.5 日志创建失败不影响 session 创建

```rust
let logging_config = SessionLoggingConfig::default();
if let Err(e) = start_session_logging(id, &logging_config) {
    tracing::warn!("Failed to start session logging for session {}: {}", id, e);
}
```

日志写入失败仅 warn，不阻断 session 生命周期。