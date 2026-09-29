# Backend · MCP Server 子系统

> **位置**：`src-tauri/src/mcp_server/`
> **状态**：⭐ MVP P0-1（PRD §2 M6 + M7 + M8 的核心差异化）
> **架构决策**：ADR 0002——嵌入主进程，与 Tauri WebView 同生命周期
> **替代方案**：未来拆 `xsterm-mcp.exe` 子进程（迁移路径见 [backend/README §16](../README.md)）

## 1. 一句话架构

**MCP server = 1 个 rmcp Server + 12 个工具 + 2 个 transport + 安全边界**

```
src-tauri/src/mcp_server/
├── mod.rs              入口 + start() / stop() 公开 API
├── server.rs           rmcp ServerBuilder + 工具注册 + transport 选择
├── context.rs          McpContext 依赖注入容器
├── tools/              12 个 MCP 工具实现（每个 1 个文件）
│   ├── mod.rs          register_all(server, ctx) 一键注册
│   ├── list_sessions.rs
│   ├── create_session.rs
│   ├── close_session.rs
│   ├── send_keys.rs        ← 调 safety.rs 拦截破坏性键
│   ├── capture_screen.rs   ← 调 services::capture
│   ├── subscribe_output.rs ← 调 services::subscribe
│   ├── unsubscribe_output.rs
│   ├── attach_session.rs   ← 调 services::attach
│   ├── detach_session.rs
│   ├── wait_for.rs         ← 复用 subscribe + regex
│   ├── list_profiles.rs
│   ├── get_config.rs       ← 走 services::config 白名单
│   └── set_config.rs       ← 走 services::config 白名单
├── transport/
│   ├── mod.rs
│   ├── stdio.rs        JSON-RPC over stdin/stdout（默认）
│   └── http.rs         Streamable HTTP（SSE + Bearer token，127.0.0.1:19847）
├── auth.rs             Bearer token 生成 / 验证 / 持久化
├── safety.rs           破坏性快捷键白名单（pure function）
├── audit.rs            可选审计日志（mcp.audit.enabled）
├── rate_limit.rs       100 req/s per MCP session（令牌桶）
└── error.rs            McpError → JSON-RPC error code 映射
```

## 2. 12 个工具清单（PRD §2 M6 + target-arch §7）

| # | 工具 | 类型 | 调 backend | 安全约束 |
|---|---|---|---|---|
| 1 | `list_sessions` | 只读 | `services::session_manager::list` | 无 |
| 2 | `create_session` | 写 | `commands::session::create_session` 内部等价 | 配额 100 |
| 3 | `close_session` | 写 | `services::session_manager::close` | 只关自己 attach 的 |
| 4 | `send_keys` | 写 | `services::session_manager::write` | 必须 attach + 破坏性键白名单 |
| 5 | `capture_screen` | 只读 | `services::capture::capture_*` | 无 |
| 6 | `subscribe_output` | 订阅 | `services::subscribe::OutputRing::subscribe` | 单 session 上限 100 |
| 7 | `unsubscribe_output` | 写 | `services::subscribe::OutputRing::unsubscribe` | 自己的 |
| 8 | `attach_session` | 写 | `services::attach::try_attach` | 互斥 CAS |
| 9 | `detach_session` | 写 | `services::attach::detach` | 自己的 |
| 10 | `wait_for` | 只读 | `services::subscribe` + regex | timeout_ms ≤ 60000 |
| 11 | `list_profiles` | 只读 | `services::config::profiles` | 无 |
| 12 | `get_config` / `set_config` | 读写 | `services::config` | 白名单字段 |

详见 [`tools/RESPONSIBILITY.md`](tools/RESPONSIBILITY.md)。

## 3. 子结构详解

### 3.1 `mod.rs` — 公开 API

```rust
//! mcp_server 是嵌入主进程的 MCP server 子系统
//!
//! # 入口
//! - [`start`] —— Tauri setup 钩子调一次
//! - [`stop`] —— Tauri shutdown 调一次（graceful drop all clients）
//!
//! # 公开类型
//! - [`McpHandle`] —— handle 持有内部状态 + 提供 status / regenerate_token
//! - [`McpConfig`] —— start 参数（stdio / http / token / 启用开关）

pub mod server;
pub mod tools;
pub mod transport;
pub mod context;
pub mod auth;
pub mod safety;
pub mod audit;
pub mod rate_limit;
pub mod error;

pub use context::McpContext;
pub use server::{McpHandle, McpStatus};

/// 启动 MCP server。失败不阻塞主进程启动——返回 tracing::warn + null handle。
pub async fn start(
    session_manager: Arc<SessionManager>,
    config_store: Arc<ConfigStore>,
    app: AppHandle,
) -> Result<McpHandle, McpError>;

/// 关闭 MCP server。优雅 drop 所有 client。
pub async fn stop(handle: McpHandle) -> Result<(), McpError>;
```

### 3.2 `server.rs` — rmcp Server + 工具注册

```rust
use rmcp::{ServerHandler, model::*, tool, transport::stdio};

pub struct McpServerImpl {
    context: McpContext,
}

impl ServerHandler for McpServerImpl {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2024_11_05,
            capabilities: ServerCapabilities::builder()
                .enable_tools()
                .build(),
            server_info: Implementation {
                name: "xsterm".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
            instructions: Some(
                "xsterm terminal MCP server. Use list_sessions to discover \
                 active sessions, then attach_session before send_keys / \
                 capture_screen / subscribe_output.".to_string()
            ),
        }
    }

    async fn list_tools(&self, _req: Option<PaginatedRequestParams>) -> Result<ListToolsResult, McpError> {
        Ok(ListToolsResult {
            tools: tools::all_definitions(),  // 12 个工具的 schema 列表
            ..Default::default()
        })
    }

    async fn call_tool(&self, req: CallToolRequestParams) -> Result<CallToolResult, McpError> {
        // 1. 速率限制检查
        self.context.rate_limiter.check(&req.name)?;

        // 2. 路由到对应工具实现
        let result = tools::dispatch(&req.name, req.arguments, &self.context).await?;

        // 3. 审计日志（如果启用）
        self.context.audit.record(&req.name, &result).await;

        Ok(result)
    }
}

pub async fn start(
    session_manager: Arc<SessionManager>,
    config_store: Arc<ConfigStore>,
    app: AppHandle,
) -> Result<McpHandle, McpError> {
    let context = McpContext::new(session_manager, config_store, app.clone());

    // stdio transport（默认）
    let stdio_transport = transport::stdio::StdioTransport::spawn(&context)?;

    // 可选 HTTP transport
    let http_transport = if context.config.mcp.http.enabled {
        Some(transport::http::HttpTransport::spawn(&context).await?)
    } else {
        None
    };

    let handle = McpHandle {
        stdio: stdio_transport,
        http: http_transport,
        context: Arc::new(context),
    };

    Ok(handle)
}
```

### 3.3 `tools/` — 12 个工具实现

每个工具 1 个文件，结构统一：

```rust
// tools/list_sessions.rs —— 模式：tool handler

use rmcp::{tool, model::*};
use crate::{McpContext, error::McpError};

#[tool(name = "list_sessions", description = "List all active sessions")]
pub async fn list_sessions(
    ctx: &McpContext,
    params: Parameters<ListSessionsParams>,
) -> Result<CallToolResult, McpError> {
    let sessions = ctx.session_manager
        .list_with_filter(params.0.filter)
        .await?;
    Ok(CallToolResult::success(serde_json::to_value(sessions)?))
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsParams {
    pub filter: Option<Filter>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    /// 过滤 session 类型（"local" | "ssh" | "tmux"）
    #[serde(rename = "type")]
    pub type_: Option<String>,
    /// 过滤 profile 名
    pub profile: Option<String>,
    /// 是否被 attach
    pub attached: Option<bool>,
}
```

**注册入口**（`tools/mod.rs`）：
```rust
pub mod list_sessions;
pub mod create_session;
// ...

pub fn register_all(server: &mut McpServerImpl) {
    server.add_tool(list_sessions::list_sessions);
    server.add_tool(create_session::create_session);
    // ...
}

pub async fn dispatch(
    name: &str,
    args: Option<JsonObject>,
    ctx: &McpContext,
) -> Result<CallToolResult, McpError> {
    match name {
        "list_sessions" => list_sessions::list_sessions(ctx, args.into()).await,
        "create_session" => create_session::create_session(ctx, args.into()).await,
        // ...
        _ => Err(McpError::MethodNotFound(name.to_string())),
    }
}

pub fn all_definitions() -> Vec<Tool> {
    vec![
        list_sessions::definition(),
        create_session::definition(),
        // ...
    ]
}
```

### 3.4 `context.rs` — 依赖注入

```rust
use std::sync::Arc;
use crate::services::session_manager::SessionManager;
use crate::services::config::ConfigStore;
use crate::mcp_server::{auth, rate_limit, audit};

pub struct McpContext {
    pub session_manager: Arc<SessionManager>,
    pub config_store: Arc<ConfigStore>,
    pub auth: Arc<auth::TokenStore>,
    pub rate_limiter: Arc<rate_limit::RateLimiter>,
    pub audit: Arc<audit::AuditLog>,
    pub app: tauri::AppHandle,
}

impl McpContext {
    pub fn new(
        session_manager: Arc<SessionManager>,
        config_store: Arc<ConfigStore>,
        app: tauri::AppHandle,
    ) -> Self {
        Self {
            session_manager,
            config_store: config_store.clone(),
            auth: Arc::new(auth::TokenStore::load_or_create(&config_store)),
            rate_limiter: Arc::new(rate_limit::RateLimiter::new(100)), // 100 req/s
            audit: Arc::new(audit::AuditLog::new(config_store.get().mcp.audit)),
            app,
        }
    }

    /// ⭐ 唯一 session_id 解析入口（MCP "tab-7f3a9b" → u32）
    pub fn resolve_session_id(&self, mcp_session_id: &str) -> Result<u32, McpError> {
        self.session_manager
            .session_id_index
            .get(mcp_session_id)
            .map(|r| *r.value())
            .ok_or_else(|| McpError::SessionNotFound(mcp_session_id.to_string()))
    }

    /// ⭐ attach 检查（send_keys / capture 必须 attach）
    pub fn require_attached(&self, session_id: u32, caller_client: &ClientId) -> Result<(), McpError> {
        match self.session_manager.attach_state.get(&session_id) {
            Some(state) if state.is_owned_by(caller_client) => Ok(()),
            Some(_) => Err(McpError::SessionNotAttached(session_id)),
            None => Err(McpError::SessionNotAttached(session_id)),
        }
    }
}
```

### 3.5 `transport/` — stdio + HTTP

**stdio**（默认，零配置）：
```rust
// transport/stdio.rs
use tokio::io::{stdin, stdout};
use rmcp::transport::async_rw::AsyncRwTransport;

pub struct StdioTransport {
    cancel: tokio::sync::oneshot::Sender<()>,
}

impl StdioTransport {
    pub fn spawn(ctx: &McpContext) -> Result<Self, McpError> {
        let server = McpServerImpl::new(ctx.clone());
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();

        tokio::spawn(async move {
            // rmcp 的 stdin/stdout transport
            let transport = AsyncRwTransport::new(stdin(), stdout());
            if let Err(e) = server.serve(transport).await {
                tracing::error!("MCP stdio server crashed: {e}");
            }
            let _ = cancel_rx.await;
        });

        Ok(Self { cancel: cancel_tx })
    }
}
```

**HTTP**（可选，token 鉴权）：
```rust
// transport/http.rs
use rmcp::transport::streamable_http_server::StreamableHttpService;

pub struct HttpTransport {
    cancel: tokio::sync::oneshot::Sender<()>,
    pub port: u16,
}

impl HttpTransport {
    pub async fn spawn(ctx: &McpContext) -> Result<Self, McpError> {
        let bind = format!("127.0.0.1:{}", ctx.config_store.get().mcp.http.port);
        let server = McpServerImpl::new(ctx.clone());

        let cancel_tx = spawn_cancelable(async move {
            let svc = StreamableHttpService::new(move || Ok(server.clone()));
            let app = axum::Router::new()
                .route("/mcp", axum::routing::any(svc))
                .layer(tower_http::auth::RequireAuthorizationLayer::bearer(
                    ctx.auth.token()
                ));
            let listener = tokio::net::TcpListener::bind(&bind).await?;
            axum::serve(listener, app).await?;
            Ok::<(), McpError>(())
        });

        Ok(Self { cancel: cancel_tx, port: ctx.config_store.get().mcp.http.port })
    }
}
```

### 3.6 `auth.rs` — Bearer token

```rust
pub struct TokenStore {
    inner: tokio::sync::RwLock<String>,
}

impl TokenStore {
    pub fn load_or_create(config: &ConfigStore) -> Self {
        let token = config.get().mcp.http.token.clone()
            .unwrap_or_else(|| Self::generate());
        Self { inner: tokio::sync::RwLock::new(token) }
    }

    pub async fn verify(&self, header: &str) -> Result<(), AuthError> {
        let token = self.inner.read().await;
        let expected = format!("Bearer {}", *token);
        if header == expected { Ok(()) } else { Err(AuthError::InvalidToken) }
    }

    pub async fn regenerate(&self) -> String {
        let new_token = Self::generate();
        *self.inner.write().await = new_token.clone();
        new_token
    }

    fn generate() -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        (0..32).map(|_| rng.gen_range(0x20..0x7E) as char).collect()
    }
}
```

### 3.7 `safety.rs` — 破坏性快捷键白名单（pure）

```rust
/// 默认白名单——PRD §4 + §5 安全要求
pub const ALLOWED_DESTRUCTIVE: &[&str] = &[
    "Ctrl+C", "Ctrl+D", "Ctrl+Z",   // 中断信号
    "Ctrl+Break",                    // Windows break
];

/// 检查 keys 列表是否含破坏性组合键
/// 返回 true = 应该拒绝
pub fn is_destructive(keys: &[String], policy: DestructivePolicy) -> bool {
    let combo = keys.join("+");
    let has_combo = keys.iter().any(|k| k.starts_with("Ctrl+") || k.starts_with("Alt+"));

    if !has_combo {
        return false;  // 普通字符 / 单键 → 允许
    }

    match policy {
        DestructivePolicy::Deny => !ALLOWED_DESTRUCTIVE.contains(&combo.as_str()),
        DestructivePolicy::Ask => false,  // 让 frontend UI 弹确认
        DestructivePolicy::Allow => false, // 全部允许
    }
}
```

### 3.8 `error.rs` — JSON-RPC error 映射

```rust
#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("session {0} not attached by this client")]
    SessionNotAttached(u32),
    #[error("session {0} already attached by another client")]
    SessionAlreadyAttached(u32),
    #[error("destructive shortcut rejected: {0}")]
    DestructiveShortcutRejected(String),
    #[error("payload too large: {0} bytes")]
    PayloadTooLarge(usize),
    #[error("rate limit exceeded (max {0} req/s)")]
    RateLimitExceeded(u32),
    #[error("auth failed: invalid token")]
    AuthFailed,
    #[error("field '{0}' is not writable via MCP")]
    FieldNotWritable(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl McpError {
    /// 映射为 JSON-RPC 2.0 standard error codes
    pub fn to_json_rpc_code(&self) -> i32 {
        match self {
            Self::SessionNotFound(_) => -32001,
            Self::SessionNotAttached(_) => -32002,
            Self::SessionAlreadyAttached(_) => -32003,
            Self::DestructiveShortcutRejected(_) => -32004,
            Self::PayloadTooLarge(_) => -32005,
            Self::RateLimitExceeded(_) => -32006,
            Self::AuthFailed => -32007,
            Self::FieldNotWritable(_) => -32008,
            Self::Internal(_) => -32603,
        }
    }
}
```

## 4. 启动 / 关闭序列

### 4.1 启动（`lib.rs::run()` 的 setup 钩子）

```rust
.setup(|app| {
    // ... 已有 logging + RealAppBackend ...

    // ⭐ NEW: config.toml 加载（先于 MCP start，因为 MCP start 要读 config）
    let config_store = services::config::ConfigStore::load(app.handle())?;
    app.manage(Arc::new(config_store.clone()));

    // ⭐ NEW: 启动 MCP server（fire-and-forget tokio task）
    let session_manager: State<'_, Arc<SessionManager>> = app.state();
    let mcp_handle = tokio::spawn(async move {
        match mcp_server::start(
            session_manager.inner().clone(),
            config_store,
            app.handle().clone(),
        ).await {
            Ok(handle) => {
                tracing::info!("MCP server started (stdio + http)");
                app.manage(handle);
            }
            Err(e) => {
                tracing::error!("MCP server failed to start: {e}");
                // 不阻塞主进程启动
            }
        }
    });

    Ok(())
})
```

### 4.2 关闭

```rust
impl Drop for McpHandle {
    fn drop(&mut self) {
        // graceful drop all clients
        let _ = self.stdio.cancel.send(());
        if let Some(http) = self.http.take() {
            let _ = http.cancel.send(());
        }
        tracing::info!("MCP server stopped");
    }
}
```

**Tauri 主进程退出时**：`McpHandle::drop()` 自动触发（`manage()` 注册的所有 state 在 shutdown 时 drop）—— stdio client EOF 自动断开；HTTP client 收到 `connection: close` 头后断开。

## 5. 关键设计决策

### 5.1 为什么 mcp_server 是独立子系统（不是 services 子 module）

考虑过 `services/mcp/` 但**否决**：
- mcp_server 跨所有 4 层（调 services / 读 models / 用 rmcp crate / emit 事件）
- mcp_server 跟 services 是**协议层 vs 业务层**——MCP 是外部协议，不是 xsterm 内部业务
- mcp_server 未来可以独立 crate（ADR 0002 §5），结构稳定

### 5.2 为什么 mcp_server 不直读 SessionManager private 字段

`session_manager.sessions / tmux_controllers / attach_state / output_rings` 全是 `pub(crate)`——**只在 services/session_manager.rs 内部和它的 friend module（attach / subscribe）使用**。

`mcp_server` 必须通过 public API：
- `session_manager.list() / create() / close() / write()`
- `session_manager.lookup_by_mcp_id(string) -> u32`
- `session_manager.list_with_filter(filter)`

详见 [`services/session_manager/INTERFACE.md`](../services/session_manager/INTERFACE.md) §6 public API 边界。

### 5.3 为什么 attach 状态独立 module（不内嵌 SessionManager）

考虑过 `SessionManager::attach_state: DashMap<u32, AttachState>` 但**否决**：
- attach 状态机独立演化（idle timeout / EOF 自动释放 / 互斥 CAS）
- attach 逻辑复杂（300+ 行）+ 强单测需求——独立 module 便于 mockall
- attach 同时被 MCP 工具 + UI takeover + reverse_tunnel 使用——多 caller，单一真相源

### 5.4 为什么 send_keys 必须先 attach

PRD §4 安全边界："MCP 工具只能操作 AI attach 的 session"。

```rust
// tools/send_keys.rs
pub async fn send_keys(ctx: &McpContext, params: Parameters<SendKeysParams>) -> Result<...> {
    let session_id = ctx.resolve_session_id(&params.0.session_id)?;

    // ⭐ attach 检查（这是 send_keys 的强制前提）
    let caller = ctx.current_client_id();
    ctx.require_attached(session_id, &caller)?;

    // 破坏性快捷键检查
    if let Some(keys) = &params.0.keys {
        if safety::is_destructive(keys, ctx.config_store.get().mcp.destructive_keys.policy) {
            return Err(McpError::DestructiveShortcutRejected(keys.join("+")));
        }
    }

    // 序列化 + 写入
    let bytes = encode_payload(&params.0)?;
    ctx.session_manager.write(session_id, &bytes)?;
    Ok(...)
}
```

**为什么强制 attach**：
- 防止 MCP agent 随意操作 user 标签页（恶意 agent 可能发送破坏性键）
- attach 是"用户授权给 agent 操作这个标签页"的明确信号
- 用户可在 UI 看到"🤖 AI 接管中" banner（知情）

### 5.5 MCP session_id 双向映射

规格要求 MCP 暴露 `"type-uuid_short"` 字符串（target-arch §5.4）。xsterm 内部用 u32。

**映射策略**：
- 首次 create_session / list_sessions 时，主进程生成 `uuid_short`（`Uuid::new_v4().simple()[..6]`）并存到 `SessionInfo.mcp_session_id`
- `SessionManager` 维护 `session_id_index: DashMap<String, u32>` + `reverse_index: DashMap<u32, String>`
- MCP 工具收到的 `session_id` 全部按字符串处理；`ctx.resolve_session_id()` 解析

**持久化**：u32 继续持久化（attached_tmux.json / savedConfigs）；mcp_session_id **不持久化**——重启后重新生成。

## 6. 跟其他 layer 的关系

| 调用方向 | 边界 |
|---|---|
| `commands/mcp.rs` → `mcp_server::*` | 通过 `McpHandle::status() / regenerate_token()` 公开方法 |
| `mcp_server/tools/*` → `services::session_manager` | 通过 public API（list / create / close / write / lookup_by_mcp_id） |
| `mcp_server/tools/send_keys` → `services::attach` | 通过 `AttachRegistry::try_attach / detach` |
| `mcp_server/tools/attach_session` → `services::attach` | 通过 `AttachRegistry::try_attach` |
| `mcp_server/tools/subscribe_output` → `services::subscribe` | 通过 `OutputRing::subscribe` |
| `mcp_server/tools/capture_screen` → `services::capture` | 通过 `capture_text / capture_ansi / capture_screenshot` |
| `mcp_server/tools/get_config / set_config` → `services::config` | 通过白名单 `config.read() / config.write_allowlist()` |
| `mcp_server/*` → `models::*` | 通过 serde 派生类型 |
| `mcp_server/*` → `infrastructure::*` | ❌ **禁止**——mcp_server 不直接用 PTY / SSH / russh |

## 7. 测试策略

### 7.1 单元测试（cargo test + mockall）

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mockall::predicate::*;
    use crate::mcp_server::context::McpContext;
    use crate::services::session_manager::MockSessionManager;

    #[tokio::test]
    async fn list_sessions_returns_all() {
        let mut sm = MockSessionManager::new();
        sm.expect_list_with_filter()
            .returning(|_| Ok(vec![fake_session_info(1), fake_session_info(2)]));

        let ctx = McpContext::new(Arc::new(sm), ...);
        let result = list_sessions::list_sessions(&ctx, Parameters(ListSessionsParams { filter: None })).await?;

        assert_eq!(result.len(), 2);
    }

    #[tokio::test]
    async fn send_keys_rejects_destructive() {
        // ...
    }
}
```

### 7.2 协议兼容性测试（mcp-compat suite）

**目标**：CI 跑 `npx @modelcontextprotocol/sdk@latest` 客户端连接 stdio transport，验证所有 12 个工具可调用 + 错误码正确。

```python
# tests/mcp_compat/test_12_tools.py
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def test_list_sessions():
    params = StdioServerParameters(command="cargo", args=["run", "--bin", "xsterm-mcp-test"])
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            assert "list_sessions" in [t.name for t in tools]

            result = await session.call_tool("list_sessions", {})
            assert result.is_error is False
            assert "sessions" in result.content
```

### 7.3 状态机测试

```rust
#[tokio::test]
async fn attach_state_machine() {
    let registry = AttachRegistry::new(Arc::new(MockSessionManager::new()));

    // 1. attach → ok
    registry.try_attach(42, AttachSource::Mcp { client_id: "agent-A".into() })?;

    // 2. 同 client re-attach → 幂等
    registry.try_attach(42, AttachSource::Mcp { client_id: "agent-A".into() })?;

    // 3. 不同 client → 拒绝
    assert!(matches!(
        registry.try_attach(42, AttachSource::Mcp { client_id: "agent-B".into() }),
        Err(McpError::SessionAlreadyAttached(_))
    ));

    // 4. detach → ok
    registry.detach(42, &"agent-A".into())?;

    // 5. 新 client 可 attach
    registry.try_attach(42, AttachSource::Mcp { client_id: "agent-B".into() })?;
}
```

### 7.4 安全测试

```rust
#[tokio::test]
async fn send_keys_blocks_ctrl_x() {
    let ctx = setup_ctx_with_attached_session(42, "agent-A");
    let params = SendKeysParams {
        session_id: "tab-7f3a9b".into(),
        keys: Some(vec!["Ctrl".into(), "X".into()]),
        text: None,
        press_enter: None,
        bracketed: None,
        delay_ms: None,
    };

    let result = send_keys::send_keys(&ctx, Parameters(params)).await;
    assert!(matches!(
        result,
        Err(McpError::DestructiveShortcutRejected(_))
    ));
}
```

## 8. 错误传播约定

| 错误源 | 表达方式 |
|---|---|
| `services::session_manager` | 返回 `Result<T, String>`（现有）→ mcp_server 包成 `McpError::Internal` |
| `services::attach` | 返回 `Result<T, AttachError>` → mcp_server 包成对应 `McpError` |
| `services::subscribe` | 返回 `Result<T, SubscribeError>` → mcp_server 包成对应 `McpError` |
| `services::capture` | 返回 `Result<T, CaptureError>` → mcp_server 包成对应 `McpError` |
| `services::config` | 返回 `Result<T, ConfigError>` → mcp_server 包成对应 `McpError` |
| rmcp SDK | 协议层错误（parse / format）→ 自动转 JSON-RPC parse error |
| panic | `tokio::spawn` 内 catch → 不传播；emit error notification 给 client |

## 9. MCP 工具参数 / 返回契约

详见 [`tools/INTERFACE.md`](tools/INTERFACE.md) — 每个工具的 JSON Schema + Rust struct 一一对应。

## 10. 占位与未来工作

- **MCP resource 暴露**（MVP 不做）—— 暴露 session 元数据 / settings snapshot 作为 resource
- **MCP 子进程化**（ADR 0002 长期）—— 当前嵌入主进程；未来 spawn 独立 `xsterm-mcp.exe`
- **MCP sampling**（Anthropic 新协议）—— server 主动调用 LLM，MVP 不做
- **MCP prompts** —— 预定义 prompt template，MVP 不做
- **审计日志持久化**（默认关闭）—— 当前 in-memory，未来可写文件 / 远端

## 11. 文档地图

| 文档 | 内容 |
|---|---|
| [`README.md`](README.md) | 本文档 |
| [`tools/RESPONSIBILITY.md`](tools/RESPONSIBILITY.md) | 12 个工具职责 + 类型契约 |
| [`tools/INTERFACE.md`](tools/INTERFACE.md) | 12 个工具的 JSON Schema |
| [`transport/README.md`](transport/README.md) | stdio / HTTP 启动 + 关闭 + 错误处理 |
| [`auth/README.md`](auth/README.md) | Bearer token 生成 + 验证 + 持久化 |
| [`safety/README.md`](safety/README.md) | 破坏性快捷键白名单 + policy 决策 |
| [`audit/README.md`](audit/README.md) | 可选审计日志（开关 + 字段 + 持久化） |
| [`rate_limit/README.md`](rate_limit/README.md) | 令牌桶 + 100 req/s + per-session 维度 |

## 12. 验收

- 12 个工具全部实现且通过 mcp-compat suite ✅
- `cargo test --manifest-path src-tauri/Cargo.toml mcp_server` 全过 ✅
- Claude Desktop + Cursor + Codex 三个客户端 E2E 验证通过 ✅
- stdio + HTTP 两种 transport 都能启动（默认 stdio） ✅
- attach 状态机互斥 / 幂等 / idle timeout / EOF 释放 都通过单测 ✅
- 破坏性快捷键默认拒绝 ✅
- 速率限制 100 req/s 生效 ✅
- panic isolation：rmcp panic 不影响 UI ✅