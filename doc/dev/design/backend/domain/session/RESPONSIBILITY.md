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
5. **session 生命周期事件点**——session 创建时触发 commands/session/api.rs::start_session_logging_session 入口（**具体编排归 commands/session**；本 domain 仅声明事件点，不感知具体日志文件路径/format）
6. **tmux controller 注册表代理**——`tmux_controllers: DashMap<u32, Arc<TmuxController>>`
7. **MCP attach 注册表**——`mcp_attachments: DashMap<u32, String>`（session_id → client_id；登记 MCP 工具独占的 session；详见 §8.6 write_session 防御）

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
| `services/session/log.rs` | `commands/session/log.rs`（**P1-5 上移**——具体编排归 commands/session；domain/session 仅声明事件点） |
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
| `domain::terminal` | session **不直接** import `terminal::controller::*` 字段——通过 `TmuxController::controller_id()` 公开方法 + `Arc<TmuxController>` 引用持有。bug 0009 根因是字段直读，严格走 trait / public method |
| **（无）** | workspace 状态完全 frontend 持有，session 不依赖 workspace domain |
| **（无）** | session 创建时**不直接**读 settings（v6 砍 domain/settings；default 值由 frontend `app/settings` 编排后通过 IPC 传入） |
| **（无）** | session 不直接 import `tauri_plugin_store`——持久化由 `commands/terminal/api::save_attached_tmux_servers`（attached_tmux）+ `commands/shell/api::load_log_config`（log_config）触发 |
| `infra/*` | session 通过 `infra::pty::PtySystem` / `infra::ssh::SshBackend` trait 调底层——session 持有 trait object，不持有静态方法 |

## 5. 跟 commands 的关系

| commands module | 怎么用 domain/session |
|--|--|
| `commands/session` | `SessionManager::create_local` / `create_ssh` / `write` / `close` / `list` / `resize_*` —— 通过 `State<Arc<SessionManager>>` 注入 |
| `commands/terminal` | `SessionManager::create_tmux` / `attach_tmux` / `create_tmux_pane` / `kill_tmux_pane` / `resize_tmux_pane` / `capture_tmux_pane` / `create_tmux_window` / `kill_tmux_window` / `rename_tmux_window` / `list_attached_tmux_servers` / `detach_tmux_controller` / `close_tmux_controller`（kill server）—— session manager **代理** tmux controller 操作 |
| **（无）** | session_manager 提供 session 元数据读取 + 创建 |
| `commands/shell` | session **不**被 shell 直接调——所有 session 创建由 frontend invoke 触发 |

**关键**：commands 通过归属 module 的 `api.rs` pure function 调用 `domain/session`；session manager 不感知 IPC。具体：同 module 内部直接 `commands/<module>/api::*`；跨 module 走 `commands/<target>/api::*`（按函数归属：log → shell，attached_tmux → terminal）。

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
    pub(crate) sessions: DashMap<u32, Arc<ActiveSession>>,
    pub(crate) session_id_source: Arc<SessionIdSource>,
    pub(crate) pty_system: Box<dyn PtySystem>,
    pub(crate) ssh_backend: Arc<dyn SshBackend>,
    pub(crate) tmux_controllers: DashMap<u32, Arc<TmuxController>>,
    pub(crate) next_controller_id: AtomicU32,
    pub(crate) mcp_attachments: DashMap<u32, String>,  // session_id → mcp client_id（P1-3：MCP attach 注册表）
}
```

**字段可见性约束（bug 0009 类防御，backend/README §10.2 单一事实源）**：字段全部 `pub(crate)`，跨 module / domain 访问**禁止**直读字段。所有外部访问走下面的 `impl SessionManager` 公开方法。

```rust
impl SessionManager {
    /// 读 session 元数据（克隆 Arc —— caller 持有期间内部 mutation 不可见）
    pub fn get_session(&self, id: u32) -> Option<Arc<ActiveSession>>;

    /// 通过 tmux pane_id 反查 controller_id（供 commands/terminal 复用）
    pub fn controller_for_pane(&self, pane_id: &str) -> Option<u32>;

    /// 取 ssh_backend trait object（供 domain::session::backends::ssh 构造 SshSessionHandle 用）
    pub fn ssh_backend(&self) -> &Arc<dyn SshBackend>;

    /// 取 pty_system trait object（供 domain::session::backends::local 构造 LocalSession 用）
    pub fn pty_system(&self) -> &dyn PtySystem;

    /// 按 controller_id 取 Arc<TmuxController>（供 commands/terminal + domain::session 复用）
    pub fn tmux_controller(&self, controller_id: u32) -> Option<Arc<TmuxController>>;

    /// 分配下一个 session_id（3 种 backend 共享的 AtomicU32 单调递增）
    /// ——tmux controller 内部 dispatch task 通过 `Arc<dyn Fn() -> u32>` 闭包注入此方法
    pub fn allocate_session_id(&self) -> u32;

    /// 登记 MCP attach（P1-3 —— 由 commands/session/commands/attach.rs::set_mcp_attach 调）
    pub fn attach_mcp(&self, session_id: u32, client_id: String) -> Result<(), SessionError>;

    /// 释放 MCP attach（由 commands/session/commands/attach.rs::clear_mcp_attach 调）
    pub fn detach_mcp(&self, session_id: u32, client_id: &str) -> Result<(), SessionError>;

    /// 探测 session 是否被 MCP attach（write_session 防御；返回 client_id）
    pub fn is_attached_by_mcp(&self, session_id: u32) -> Option<String>;

    /// 列当前被 MCP attach 的所有 session（由 commands/session/commands/attach.rs::list_mcp_attached 调）
    pub fn list_mcp_attached(&self) -> Vec<u32>;
}
```

**新增字段一律先在 `impl SessionManager` 加公开方法，禁止外部字段直读**——变更流程见 backend/README §10.4。

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

**关键**：tmux controller 内部 dispatch task 通过 `Arc<dyn Fn() -> u32>` 闭包注入 allocator（闭包内部调 `SessionManager::allocate_session_id()`）——controller **不**有自己的 id allocator（`next_xsterm_id` 已删除）。

### 8.5 日志创建失败不影响 session 创建

```rust
let logging_config = SessionLoggingConfig::default();
if let Err(e) = start_session_logging(id, &logging_config) {
    tracing::warn!("Failed to start session logging for session {}: {}", id, e);
}
```

日志写入失败仅 warn，不阻断 session 生命周期。

**P2-3 新增枚举变体** —— `SessionStatus` enum 增 `LoggingDegraded` 变体：当 `start_session_logging` 失败时,session 的 status 不停留在 `Running` 而是切到 `LoggingDegraded`：

```rust
pub enum SessionStatus {
    Connecting,
    Running,
    /// P2-3 新增：session 正常但日志写入降级（disk full / permission denied / file rotation 失败）
    /// —— session 仍可读写;UI 顶栏显示警告 banner "⚠ session 日志写入失败"
    LoggingDegraded,
    Closed,
    Error(String),
}
```

**UI 警告语义**：

- `service/session` 镜像 backend 状态推到 frontend
- frontend `ui/session` 在状态栏（tab 标题旁 icon）显示降级标记
- 点击 icon 弹 toast：「session #N 日志写入失败，最近 N 行未持久化」+ 提供「重新初始化日志」按钮（调 `invoke('restart_session_logging', { sessionId })`）
- 关闭 session 时 `LoggingDegraded` 跟 `Running` 走相同 close 流程——不阻断 close

**约束**：`LoggingDegraded` 是 **业务状态变体**（不是 `Error`）——session 主体仍工作，不阻塞用户操作；仅日志侧降级。

### 8.6 MCP attach 期间 user keystroke 被屏蔽（P1-3 风险防御）

当 MCP AI 工具独占 session 时（`attached_by_mcp: true`，由 frontend `app/mcp/tools/attach_session.ts` 调 `invoke('set_mcp_attach', ...)`），user 在 frontend xterm 输入的任何 keystroke 必须被 backend **拒绝**——否则会跟 MCP 工具的写入冲突（race condition + state divergence）。

```rust
// commands/session/commands/write.rs::write_session —— P1-3 防御
#[tauri::command]
pub async fn write_session(
    session_id: u32,
    bytes: Vec<u8>,
    state: State<'_, Arc<SessionManager>>,
) -> Result<usize, String> {
    // MCP attach 防御：user keystroke 期间拒绝写入
    if let Some(client_id) = state.is_attached_by_mcp(session_id) {
        tracing::warn!(
            "blocked user keystroke for mcp-attached session {} (mcp client: {})",
            session_id, client_id
        );
        return Err(SessionError::McpAttachBlocked(client_id).to_string());
    }
    state.write(session_id, &bytes).await
}
```

**关键**：

- `SessionError::McpAttachBlocked(String)` 是新增错误变体（client_id 用于 log + 提示 user「请先 detach」）
- 防御**仅**针对 user keystroke——MCP 工具自己的 write 走 `commands/mcp/*` 直连 IPC，不受此防御（避免 MCP 自己跟自己 race）
- frontend UI 检测到 `McpAttachBlocked` 错误时弹 banner：「session 被 AI agent 独占，请先 detach」+ 提供 release 口令 / detach 按钮入口

**严格遵守 [`../README.md §10.1`](../README.md) + [`../README.md §10.2`](../README.md) 字段直读防御**，本 §8 字段表为内部可见性（`pub(crate)`），跨 module 访问必须走 `impl SessionManager` 公开方法。新加字段必须先在 `impl SessionManager` 加公开方法，子文档引用 backend/README §10，不重复抄。

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