# Services · Attach — 对外接口

> **位置**：`src-tauri/src/services/attach/registry.rs`
> **唯一入口**：`session_manager.attach_registry()` 拿 `Arc<AttachRegistry>`
> **公开类型**：`AttachRegistry` / `AttachSource` / `AttachState` / `AttachError`

## 1. 公开类型

### 1.1 `AttachSource` — 谁 attach 的

```rust
#[derive(Debug, Clone)]
pub enum AttachSource {
    Mcp {
        client_id: String,
        agent_name: String,
        agent_pid: u32,
    },
    Ui {
        client_id: String,  // 固定 "ui-takeover"
    },
    Tunnel {
        client_id: String,
        remote_user: String,
    },
}

impl AttachSource {
    pub fn client_id(&self) -> &str;
}
```

### 1.2 `AttachState` — 完整 attach 信息

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachState {
    pub source: AttachSource,
    pub attached_at_ms: u64,
    pub last_activity_at_ms: u64,
}

impl AttachState {
    pub fn is_owned_by(&self, client_id: &str) -> bool;
    pub fn refresh(&mut self);
}
```

### 1.3 `AttachError`

```rust
#[derive(Debug, thiserror::Error)]
pub enum AttachError {
    #[error("session {0} already attached by {1}")]
    AlreadyAttached(u32, String),
    #[error("session {0} not attached")]
    NotAttached(u32),
    #[error("session {0} not attached by this client")]
    NotOwnedByYou(u32),
}
```

### 1.4 `AttachRegistry` — 全局单例

```rust
pub struct AttachRegistry {
    // ... 内部字段 ...
}

impl AttachRegistry {
    // ============ 状态机 ============
    pub fn try_attach(&self, session_id: u32, source: AttachSource) -> Result<(), AttachError>;
    pub fn detach(&self, session_id: u32, caller_client_id: &str) -> Result<(), AttachError>;
    pub fn force_detach(&self, session_id: u32);

    // ============ 权限检查 ============
    /// 给 SessionManager::write() 调
    /// - caller_client_id = None → 来自 user 键盘
    /// - caller_client_id = Some(...) → 来自 attach agent
    pub fn check_write_permission(&self, session_id: u32, caller_client_id: Option<&str>) -> bool;

    // ============ 活动追踪 ============
    pub fn record_activity(&self, session_id: u32, caller_client_id: &str);

    // ============ 查询 ============
    pub fn get(&self, session_id: u32) -> Option<AttachState>;
    pub fn list(&self) -> Vec<(u32, AttachState)>;

    // ============ 配置 ============
    pub fn set_idle_timeout(&self, seconds: u64);
    pub fn idle_timeout_seconds(&self) -> u64;
}
```

## 2. 公开 API 边界

### 2.1 允许调 attach 的模块

| caller | 调用方式 | 用途 |
|---|---|---|
| `mcp_server::tools::attach_session` | `attach_registry.try_attach(session_id, AttachSource::Mcp { ... })` | MCP client attach |
| `mcp_server::tools::detach_session` | `attach_registry.detach(session_id, client_id)` | MCP client detach |
| `mcp_server::server` (EOF handler) | `attach_registry.force_detach(session_id)` | stdio EOF 自动释放 |
| `commands/mcp::attach_session` | `attach_registry.try_attach(session_id, AttachSource::Ui { client_id: "ui-takeover" })` | frontend UI takeover |
| `commands/mcp::detach_session` | `attach_registry.detach(session_id, "ui-takeover")` | frontend "释放"按钮 |
| `services/reverse_tunnel` | `attach_registry.try_attach(session_id, AttachSource::Tunnel { ... })` | 远端 agent 接管 |
| `services/session_manager::write` | `attach_registry.check_write_permission(session_id, caller_client_id)` | 写入权限检查 |
| `services/session_manager::close` | `attach_registry.force_detach(session_id)` | 关闭 session 时清理 |
| `services/attach::idle_timeout` | `attach_registry.list()` + `force_detach(id)` | 后台扫描超时 |

### 2.2 禁止

- ❌ `mcp_server/*` 直接调 `attach_registry.inner`（必须用公开 API）
- ❌ `commands/*` 直接调 `try_attach` 跳过 source 类型——必须显式传 `AttachSource`
- ❌ `services/subscribe / capture` 调 `check_write_permission`——它们不感知 attach 状态
- ❌ frontend 调 `try_attach`（必须通过 `invoke('attach_session')` 走 IPC）

## 3. 接缝契约

### 3.1 mcp_server ↔ attach

```rust
// mcp_server/tools/attach_session.rs
use crate::services::attach::AttachSource;

pub async fn handle(ctx: &McpContext, params: AttachSessionParams) -> Result<...> {
    let session_id = ctx.resolve_session_id(&params.session_id)?;
    let source = AttachSource::Mcp {
        client_id: ctx.current_client_id(),
        agent_name: ctx.client_info().name.clone(),
        agent_pid: ctx.client_info().pid,
    };
    ctx.attach_registry.try_attach(session_id, source)?;
    Ok(...)
}
```

### 3.2 session_manager ↔ attach

```rust
// services/session_manager.rs
impl SessionManager {
    pub fn write(
        &self,
        session_id: u32,
        bytes: &[u8],
        caller_client_id: Option<&str>,  // ⭐ 新增参数
    ) -> Result<(), SessionError> {
        // ⭐ 权限检查
        if !self.attach_registry.check_write_permission(session_id, caller_client_id) {
            return Err(SessionError::PermissionDenied);
        }
        // ... 原有 write 逻辑
    }

    pub fn close(&self, session_id: u32) -> Result<(), SessionError> {
        // ⭐ close 时清理 attach
        self.attach_registry.force_detach(session_id);
        // ... 原有 close 逻辑
    }
}
```

### 3.3 commands ↔ attach（UI takeover 入口）

```rust
// commands/mcp.rs
#[tauri::command]
pub async fn attach_session(
    session_id: u32,
    client_id: String,
    attach_registry: State<'_, Arc<AttachRegistry>>,
) -> Result<(), String> {
    let source = AttachSource::Ui { client_id };  // 固定是 Ui source
    attach_registry.try_attach(session_id, source).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn detach_session(
    session_id: u32,
    client_id: String,
    attach_registry: State<'_, Arc<AttachRegistry>>,
) -> Result<(), String> {
    attach_registry.detach(session_id, &client_id).map_err(|e| e.to_string())
}
```

## 4. 不对外暴露

- `AttachRegistry.inner: DashMap<u32, AttachState>` —— 只在内部使用
- `AttachState.refresh()` —— 只在 `record_activity` / 幂等 `try_attach` 内部调
- `idle_timeout` tokio task handle —— 由 `attach::mod.rs::spawn()` 内部持有

## 5. api 变更流程

1. **新增 AttachSource variant** → 更新 `mod.rs::re-export` + `try_attach` 接受新 source + `INTERFACE.md` §1.1 + 测试
2. **修改 try_attach 行为** → 同步 `INTERFACE.md` §1.4 + 测试（破坏向后兼容的变更需要 ADR）
3. **新增公开方法** → 加到 `mod.rs` + `INTERFACE.md` §1.4
4. **删除公开方法** → 三处一起删除（破坏向后兼容的变更需要 ADR）

## 6. attach state 与 session 生命周期

| session 事件 | attach 副作用 |
|---|---|
| `create_session` | 无（默认未 attach） |
| `close_session` | `force_detach(session_id)` + emit `mcp-attach-changed { action: "detach" }` |
| PTY/SSH/tmux 后端异常退出 | `force_detach(session_id)` + emit |
| `attach_session` (MCP) | `try_attach` + emit `mcp-attach-changed { action: "attach" }` |
| `attach_session` (UI takeover) | `try_attach(AttachSource::Ui)` + emit |
| `detach_session` (MCP / UI / Tunnel) | `detach` + emit |
| `idle_timeout` (60s 扫描) | `force_detach` + emit |
| stdio EOF (MCP client 退出) | `force_detach` + emit |
| HTTP stream close | `force_detach` + emit |

## 7. IPC 契约

**`attach_session` IPC**（frontend UI takeover 入口）：
```typescript
// frontend: invoke('attach_session', { sessionId, clientId: "ui-takeover" })
{
  sessionId: number;
  clientId: string;  // frontend 固定传 "ui-takeover"
}
```

**`detach_session` IPC**：
```typescript
{
  sessionId: number;
  clientId: string;
}
```

**`mcp-attach-changed` 事件**：
```typescript
{
  sessionId: number;
  clientId: string;
  action: "attach" | "detach";
}
```

**`get_session_attach_state` IPC**（frontend 启动时拉一次）：
```typescript
// invoke('get_session_attach_state', { sessionId })
// 返回 { source: "mcp" | "ui" | "tunnel", attachedAtMs, lastActivityAtMs, ... }
```

## 8. 类型与 frontend TS 镜像

| Rust | TS (`model/attach/types.ts`) |
|---|---|
| `AttachSource::Mcp { client_id, agent_name, agent_pid }` | `{ kind: "mcp", clientId, agentName, agentPid }` |
| `AttachSource::Ui { client_id }` | `{ kind: "ui", clientId }` |
| `AttachSource::Tunnel { client_id, remote_user }` | `{ kind: "tunnel", clientId, remoteUser }` |
| `AttachState { source, attached_at_ms, last_activity_at_ms }` | `{ source, attachedAtMs, lastActivityAtMs }` |

## 9. 错误码 → frontend

| AttachError | Tauri IPC 错误字符串 | frontend 处理 |
|---|---|---|
| `AlreadyAttached(session_id, current_client_id)` | "session N already attached by X" | 提示 user 当前 attach agent；调 `force_detach` 需 `force=true` |
| `NotAttached(session_id)` | "session N not attached" | 静默忽略 |
| `NotOwnedByYou(session_id)` | "session N not attached by this client" | 提示 user 只 detach 自己的 |

## 10. 性能预算

| 操作 | 预算 | 备注 |
|---|---|---|
| `try_attach` | < 1ms | DashMap CAS |
| `detach` | < 1ms | DashMap remove + emit |
| `force_detach` | < 1ms | 同上 |
| `check_write_permission` | < 0.1ms | DashMap get |
| `list()` | < 1ms | DashMap iter（100 sessions 预算） |
| `idle_timeout` 扫描 | < 10ms | 60s 间隔，每次遍历所有 attach |

## 11. 内存预算

- 每 AttachState: ~100 字节（source enum + 2 u64）
- 100 个 attach session: ~10KB
- 单 DashMap: ~1KB overhead
- 总: < 100KB（可忽略）

## 12. 错误传播约定

| caller | AttachError → caller error |
|---|---|
| `mcp_server/tools/attach_session` | → `McpError::SessionAlreadyAttached` (-32003) |
| `mcp_server/tools/detach_session` | → `McpError::SessionNotAttached` (-32002) |
| `commands/mcp` | → `Result<(), String>` (Tauri IPC 错误字符串) |
| `services/session_manager::write` | → `SessionError::PermissionDenied` |
| `services/reverse_tunnel` | → log warn + 不重试 |