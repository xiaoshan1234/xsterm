# Services · MCP — 对外接口

> **位置**: `src-tauri/src/services/mcp/`
> **状态**: ⭐ NEW (RFC 0002-revised-2)

## 1. 公开类型

```rust
// services/mcp/types.rs

/// MCP JSON-RPC 2.0 request
#[derive(Serialize, Deserialize)]
pub struct McpRequest {
    pub jsonrpc: String,  // "2.0"
    pub id: RequestId,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

/// MCP JSON-RPC 2.0 response
#[derive(Serialize, Deserialize)]
pub struct McpResponse {
    pub jsonrpc: String,
    pub id: RequestId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<McpError>,
}

/// MCP standard error codes (JSON-RPC + MCP 扩展)
#[derive(Serialize, Deserialize)]
pub struct McpError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl McpError {
    pub const SESSION_NOT_FOUND: i32 = -32001;
    pub const SESSION_NOT_ATTACHED: i32 = -32002;
    pub const SESSION_ALREADY_ATTACHED: i32 = -32003;
    pub const PERMISSION_DENIED: i32 = -32004;
    pub const DESTRUCTIVE_KEY_REJECTED: i32 = -32005;
    pub const RATE_LIMIT_EXCEEDED: i32 = -32006;
}

/// MCP tool definition (Schema)
#[derive(Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: schemars::schema::Schema,  // JSON Schema 派生
}

/// Tool call params
#[derive(Serialize, Deserialize)]
pub struct ToolCallParams {
    pub name: String,
    pub arguments: serde_json::Value,
    #[serde(default)]
    pub metadata: ToolCallMetadata,
}

/// 工具调用上下文
#[derive(Clone)]
pub struct McpContext {
    pub client_id: String,                    // MCP client UUID
    pub auth_token: Option<String>,            // Bearer token (HTTP only)
    pub attach_registry: Arc<AttachRegistry>,
    pub session_manager: Arc<SessionManager>,
    pub subscribe_registry: Arc<SubscribeRegistry>,
    pub capture: Arc<CaptureService>,
    pub audit: Arc<AuditLog>,
}
```

## 2. 公开 API

### 2.1 启动序列 (lib.rs::run()::setup)

```rust
use services::mcp::{http, stdio, McpConfig};

// 在 setup() 中:
let mcp_port = http::start(
    state.clone(),
    app.handle().clone(),
    cfg.mcp.http.clone(),
).await?;

if cfg.mcp.stdio.enabled {
    stdio::spawn_sidecar(state.clone(), mcp_port)?;
}

app.emit("mcp-server-status", McpServerStatus {
    http_running: true,
    stdio_running: cfg.mcp.stdio.enabled,
    active_stdio_clients: 0,
    port: mcp_port,
})?;
```

### 2.2 HTTP server (http.rs)

```rust
/// 启动 tokio HTTP listener @ 127.0.0.1:19847
pub async fn start(
    state: Arc<SessionManager>,
    app: AppHandle,
    config: McpHttpConfig,
) -> Result<u16, McpError>;

/// 停止 HTTP listener
pub async fn stop() -> Result<(), McpError>;
```

### 2.3 stdio sidecar (stdio.rs)

```rust
/// spawn xstdiod-sidecar.exe 子进程 (1 个 stdio client 1 个 sidecar)
pub fn spawn_sidecar(
    state: Arc<SessionManager>,
    http_port: u16,
) -> Result<Child, McpError>;

/// 列出当前活跃的 stdio clients
pub fn list_active() -> Vec<StdioClientInfo>;
```

### 2.4 工具 registry (tools/mod.rs)

```rust
/// 12 个 MCP 工具的注册表
pub fn tool_registry() -> HashMap<&'static str, McpToolHandler>;

/// Dispatch 一个 tool call
pub async fn dispatch(
    ctx: McpContext,
    params: ToolCallParams,
) -> Result<McpToolResult, McpError>;
```

### 2.5 12 个工具实现

```rust
// tools/list_sessions.rs
pub async fn handle(ctx: McpContext, params: ListSessionsParams) -> Result<Vec<SessionInfo>, McpError>;

// tools/close_session.rs
pub async fn handle(ctx: McpContext, params: CloseSessionParams) -> Result<(), McpError>;

// tools/send_keys.rs (受 safety + attach 双重保护)
pub async fn handle(ctx: McpContext, params: SendKeysParams) -> Result<(), McpError>;

// tools/capture_screen.rs (text/ansi/screenshot 3 模式)
pub async fn handle(ctx: McpContext, params: CaptureScreenParams) -> Result<CaptureResult, McpError>;

// tools/subscribe_output.rs (OutputRing 序号管理)
pub async fn handle(ctx: McpContext, params: SubscribeOutputParams) -> Result<SubscribeHandle, McpError>;

// tools/attach_session.rs
pub async fn handle(ctx: McpContext, params: AttachSessionParams) -> Result<AttachState, McpError>;

// tools/detach_session.rs
pub async fn handle(ctx: McpContext, params: DetachSessionParams) -> Result<(), McpError>;

// tools/wait_for.rs (regex + timeout)
pub async fn handle(ctx: McpContext, params: WaitForParams) -> Result<WaitForResult, McpError>;

// tools/list_attached_sessions.rs
pub async fn handle(ctx: McpContext, params: ListAttachedParams) -> Result<Vec<AttachedSession>, McpError>;

// tools/list_profiles.rs (v1.1)
pub async fn handle(ctx: McpContext, params: ListProfilesParams) -> Result<Vec<Profile>, McpError>;

// tools/get_config.rs (v1.1)
pub async fn handle(ctx: McpContext, params: GetConfigParams) -> Result<Settings, McpError>;

// tools/get_session_attach_state.rs
pub async fn handle(ctx: McpContext, params: GetAttachStateParams) -> Result<AttachState, McpError>;
```

### 2.6 auth + rate_limit (auth.rs)

```rust
/// 验证 Bearer token
pub async fn verify_token(ctx: &McpContext, token: &str) -> Result<bool, McpError>;

/// 检查速率限制 (100/s per tool)
pub async fn check_rate_limit(tool_name: &str) -> Result<(), McpError>;
```

### 2.7 events (events.rs)

```rust
/// 发送 tool-called 事件给 frontend listen
pub async fn emit_tool_called(app: &AppHandle, event: McpToolCalledEvent);

/// 发送 tool-returned 事件给 frontend listen
pub async fn emit_tool_returned(app: &AppHandle, event: McpToolReturnedEvent);

/// 发送 server-status 事件给 frontend listen
pub async fn emit_server_status(app: &AppHandle, status: McpServerStatus);
```

## 3. 安全约束

| 项 | 默认 | 可配置 |
|---|---|---|
| HTTP listener bind | `127.0.0.1:19847` (强制) | ❌ 不可改 |
| Bearer token 鉴权 | 必需 | ❌ 不可关 (除 stdio localhost bridge) |
| stdio sidecar 鉴权 | localhost IPC (无需 Bearer) | ❌ 不可改 |
| 速率限制 | 100/s per tool | settings.toml `mcp.rateLimitPerTool` |
| 破坏性快捷键 | 仅 Ctrl+C/D/Z/Break | settings.toml `mcp.destructiveKeys.policy` |

## 4. emit 事件契约

| 事件名 | payload | 何时 emit | frontend listener |
|---|---|---|---|
| `mcp-tool-called` | `{ tool, params, clientId, requestId }` | MCP client 调用 tool 入口 | `app/mcp/listener.ts` → `McpStatusPanel` |
| `mcp-tool-returned` | `{ tool, result?, error?, latencyMs, requestId }` | MCP client 调用 tool 返回 | `app/mcp/listener.ts` → `McpStatusPanel` |
| `mcp-server-status` | `{ httpRunning, stdioRunning, activeStdioClients, port }` | HTTP / stdio server 启停 | `app/mcp/listener.ts` → `McpStatusPanel` |
| `mcp-attach-changed` | `{ sessionId, clientId, action }` | attach 状态变化 (来自 attach_registry 透传) | `app/mcp/listener.ts` → `McpAttachBanner` |

## 5. 错误映射

| caller | AttachError → caller error |
|---|---|
| `services/mcp/tools/attach_session.rs` | → `McpError::SESSION_ALREADY_ATTACHED` (-32003) |
| `services/mcp/tools/detach_session.rs` | → `McpError::SESSION_NOT_ATTACHED` (-32002) |
| `services/mcp/tools/send_keys.rs` | → `McpError::PERMISSION_DENIED` (-32004) / `DESTRUCTIVE_KEY_REJECTED` (-32005) |
| `services/mcp/tools/wait_for.rs` | → `McpError::SESSION_NOT_FOUND` (-32001) (timeout) |
| `services/mcp/auth.rs` | → `McpError::PERMISSION_DENIED` (-32004) / `RATE_LIMIT_EXCEEDED` (-32006) |
| `commands/mcp::*` (IPC handler) | → `Result<(), String>` (Tauri IPC 错误字符串) |

## 6. 依赖注入 (McpContext)

```rust
// service_init.rs
pub fn init_mcp_context(
    attach_registry: Arc<AttachRegistry>,
    session_manager: Arc<SessionManager>,
    subscribe_registry: Arc<SubscribeRegistry>,
    capture: Arc<CaptureService>,
    audit: Arc<AuditLog>,
) -> McpContext;

impl Clone for McpContext { /* all fields are Arc */ }
```

## 7. 与 frontend 的契约

frontend `app/mcp/listener.ts` 只 listen 4 类事件:

```typescript
import { listen } from "@tauri-apps/api/event";

listen<McpToolCalledEvent>("mcp-tool-called", (e) => { /* update UI */ });
listen<McpToolReturnedEvent>("mcp-tool-returned", (e) => { /* update UI */ });
listen<McpServerStatus>("mcp-server-status", (e) => { /* update UI */ });
listen<McpAttachChangedEvent>("mcp-attach-changed", (e) => { /* banner */ });
```

frontend 不调 MCP tool (那是 AI agent 通过 HTTP/stdio 调的)。
frontend 不持有 MCP 协议状态 (services/mcp/ 是真源)。