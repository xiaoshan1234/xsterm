# MCP Server · Tools — 职责

> **位置**：`src-tauri/src/mcp_server/tools/`
> **数量**：12 个工具（PRD §2 M6 + target-arch §7）
> **注册方式**：rmcp `#[tool]` 宏 + `tools/mod.rs::register_all()` 一键注册

## 1. 12 个工具清单（按 MCP 协议分组）

### 1.1 Session 生命周期（只读 + CRUD）

| # | 工具 | 文件 | 类型 | 调 services |
|---|---|---|---|---|
| 1 | `list_sessions` | [`list_sessions.rs`](list_sessions.rs) | 只读 | `session_manager.list_with_filter` |
| 2 | `create_session` | [`create_session.rs`](create_session.rs) | 写 | `session_manager.create_*` |
| 3 | `close_session` | [`close_session.rs`](close_session.rs) | 写 | `session_manager.close` |
| 11 | `list_profiles` | [`list_profiles.rs`](list_profiles.rs) | 只读 | `config_store.profiles` |

### 1.2 I/O 操作

| # | 工具 | 文件 | 类型 | 调 services |
|---|---|---|---|---|
| 4 | `send_keys` | [`send_keys.rs`](send_keys.rs) | 写 | `session_manager.write` |
| 5 | `capture_screen` | [`capture_screen.rs`](capture_screen.rs) | 只读 | `capture::capture_*` |

### 1.3 输出流订阅

| # | 工具 | 文件 | 类型 | 调 services |
|---|---|---|---|---|
| 6 | `subscribe_output` | [`subscribe_output.rs`](subscribe_output.rs) | 订阅 | `subscribe::OutputRing::subscribe` |
| 7 | `unsubscribe_output` | [`unsubscribe_output.rs`](unsubscribe_output.rs) | 写 | `subscribe::OutputRing::unsubscribe` |
| 10 | `wait_for` | [`wait_for.rs`](wait_for.rs) | 只读 | `subscribe` + regex |

### 1.4 AI 接管（独占）

| # | 工具 | 文件 | 类型 | 调 services |
|---|---|---|---|---|
| 8 | `attach_session` | [`attach_session.rs`](attach_session.rs) | 写 | `attach::AttachRegistry::try_attach` |
| 9 | `detach_session` | [`detach_session.rs`](detach_session.rs) | 写 | `attach::AttachRegistry::detach` |

### 1.5 配置（白名单）

| # | 工具 | 文件 | 类型 | 调 services |
|---|---|---|---|---|
| 12a | `get_config` | [`get_config.rs`](get_config.rs) | 只读 | `config_store.get_allowlist` |
| 12b | `set_config` | [`set_config.rs`](set_config.rs) | 写 | `config_store.update_allowlist` |

## 2. 每个工具的统一结构

每个工具 1 个 .rs 文件，固定结构：

```rust
//! <工具名>——<一句话职责>
//! 
//! MCP 协议: <method_name>
//! 调用方: <哪个 agent 会调>
//! 安全约束: <必读>

use rmcp::{tool, model::*};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use crate::mcp_server::{McpContext, error::McpError};

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct <ToolName>Params {
    // ... 入参 ...
}

#[derive(Debug, Serialize, Deserialize)]
pub struct <ToolName>Result {
    // ... 返回 ...
}

#[tool(
    name = "<snake_case_name>",
    description = "<一句话描述>"
)]
pub async fn <tool_name>(
    ctx: &McpContext,
    params: Parameters<<ToolName>Params>,
) -> Result<CallToolResult, McpError> {
    // 1. 解析 session_id (mcp session_id 字符串 → u32)
    // 2. 权限检查 (attach / auth / rate_limit)
    // 3. 调 services
    // 4. 构造返回
}

/// 工具的 JSON Schema 定义（list_tools 用）
pub fn definition() -> Tool {
    Tool {
        name: "<snake_case_name>".to_string(),
        description: Some("<一句话描述>".to_string()),
        input_schema: schemars::schema_for!(<ToolName>Params),
    }
}
```

## 3. 工具路由

`tools/mod.rs` 提供两个入口：

```rust
pub fn register_all(server: &mut McpServerImpl) {
    server.add_tool(list_sessions::list_sessions);
    server.add_tool(create_session::create_session);
    server.add_tool(close_session::close_session);
    server.add_tool(send_keys::send_keys);
    server.add_tool(capture_screen::capture_screen);
    server.add_tool(subscribe_output::subscribe_output);
    server.add_tool(unsubscribe_output::unsubscribe_output);
    server.add_tool(attach_session::attach_session);
    server.add_tool(detach_session::detach_session);
    server.add_tool(wait_for::wait_for);
    server.add_tool(list_profiles::list_profiles);
    server.add_tool(get_config::get_config);
    server.add_tool(set_config::set_config);
}

pub async fn dispatch(
    name: &str,
    args: Option<JsonObject>,
    ctx: &McpContext,
) -> Result<CallToolResult, McpError> {
    match name {
        "list_sessions" => list_sessions::list_sessions(ctx, args.into()).await,
        // ... 12 个 case
        _ => Err(McpError::MethodNotFound(name.to_string())),
    }
}

pub fn all_definitions() -> Vec<Tool> {
    vec![
        list_sessions::definition(),
        // ... 12 个
    ]
}
```

## 4. 通用安全模式

所有工具**统一**执行以下检查（在 `McpServerImpl::call_tool` 顶层）：

```rust
async fn call_tool(&self, req: CallToolRequestParams) -> Result<CallToolResult, McpError> {
    // 1. ⭐ 速率限制（per MCP session）
    self.context.rate_limiter.check(&req.name)?;

    // 2. 路由
    let result = tools::dispatch(&req.name, req.arguments, &self.context).await?;

    // 3. ⭐ 审计（如果启用）
    self.context.audit.record(&req.name, &result).await;

    Ok(result)
}
```

**单工具级安全**：
- `send_keys` ⭐ 必须 `attach_session` 在前
- `attach_session` ⭐ CAS 互斥（已有 attach → 拒绝）
- `close_session` ⭐ 只能关自己 attach 的
- `set_config` ⭐ 白名单字段
- `send_keys` ⭐ 破坏性键白名单（`safety::is_destructive`）
- `wait_for` ⭐ timeout_ms ≤ 60000
- `subscribe_output` ⭐ 单 session 订阅上限 100

## 5. 每个工具的"产品语言"术语

| 术语 | 含义 |
|---|---|
| **session_id** | MCP 客户端用字符串 `"tab-7f3a9b"`；backend 内部 u32 |
| **profile** | 已保存的 session config（含创建参数 + display config） |
| **attach** | "AI agent 独占此 session"（CAS 互斥） |
| **destructive shortcut** | `Ctrl+*` / `Alt+*` 组合键（默认拒绝，仅 `Ctrl+C/D/Z/Break` 白名单） |
| **destructive_keys.policy** | `deny` / `ask` / `allow` |
| **since_seq** | 增量订阅起点（OutputRing 序号） |
| **wait_for pattern** | 正则表达式（regex crate） |
| **capture mode** | `text` / `ansi` / `screenshot` |

## 6. 工具实现骨架示例

### 6.1 `list_sessions`（最简单）

```rust
#[tool(name = "list_sessions", description = "List all active sessions")]
pub async fn list_sessions(
    ctx: &McpContext,
    params: Parameters<ListSessionsParams>,
) -> Result<CallToolResult, McpError> {
    let sessions = ctx.session_manager.list_with_filter(params.0.filter).await?;
    Ok(CallToolResult::success(serde_json::to_value(sessions)?))
}
```

### 6.2 `send_keys`（最复杂——4 层安全）

```rust
#[tool(name = "send_keys", description = "Send keys or text to an attached session")]
pub async fn send_keys(
    ctx: &McpContext,
    params: Parameters<SendKeysParams>,
) -> Result<CallToolResult, McpError> {
    // 1. 解析 session_id
    let session_id = ctx.resolve_session_id(&params.0.session_id)?;

    // 2. ⭐ attach 检查（强制）
    let caller = ctx.current_client_id();
    ctx.require_attached(session_id, &caller)?;

    // 3. ⭐ 破坏性键检查
    if let Some(keys) = &params.0.keys {
        let policy = ctx.config_store.get().mcp.destructive_keys.policy;
        if safety::is_destructive(keys, policy) {
            return Err(McpError::DestructiveShortcutRejected(keys.join("+")));
        }
    }

    // 4. ⭐ 至少一个非空
    if params.0.keys.is_none() && params.0.text.is_none() {
        return Err(McpError::Internal("keys and text are both empty".into()));
    }

    // 5. 序列化 payload（KeySpec union → bytes）
    let bytes = encode_payload(&params.0)?;

    // 6. ⭐ 大小检查
    if bytes.len() > MAX_WRITE_PAYLOAD_BYTES {
        return Err(McpError::PayloadTooLarge(bytes.len()));
    }

    // 7. 写入 PTY/SSH/tmux
    ctx.session_manager.write(session_id, &bytes)?;

    Ok(CallToolResult::success(serde_json::json!({
        "delivered": true,
        "bytesSent": bytes.len(),
        "warnings": null,
    })))
}
```

### 6.3 `subscribe_output`（订阅型——返回流）

```rust
#[tool(name = "subscribe_output", description = "Subscribe to incremental session output")]
pub async fn subscribe_output(
    ctx: &McpContext,
    params: Parameters<SubscribeOutputParams>,
) -> Result<CallToolResult, McpError> {
    // 1. 解析 session_id
    let session_id = ctx.resolve_session_id(&params.0.session_id)?;

    // 2. attach 检查
    let caller = ctx.current_client_id();
    ctx.require_attached(session_id, &caller)?;

    // 3. ⭐ 单 session 订阅上限 100
    let count = ctx.subscribe_registry.count_subscribers(session_id);
    if count >= MAX_SUBSCRIBERS_PER_SESSION {
        return Err(McpError::Internal(format!(
            "session {session_id} reached max subscribers ({MAX_SUBSCRIBERS_PER_SESSION})"
        )));
    }

    // 4. 注册订阅 + 启动 spawn task
    let (tx, rx) = tokio::sync::mpsc::channel::<RingEntry>(1024);
    let since_seq = params.0.since_seq;
    ctx.subscribe_registry.register(session_id, ctx.current_client_id(), tx)?;

    // 5. spawn task: 从 rx 读 entry → 通过 MCP notification 推给 client
    let caller_clone = ctx.current_client_id();
    let server_clone = ctx.server.clone();  // rmcp server handle
    tokio::spawn(async move {
        let mut current_seq = since_seq.unwrap_or(0);
        while let Some(entry) = rx.recv().await {
            if entry.seq > current_seq {
                let chunk = OutputChunk {
                    seq: entry.seq,
                    session_id: session_id.to_string(),
                    data: entry.data,
                    timestamp_ms: entry.timestamp,
                };
                // rmcp send notification
                let _ = server_clone.notify("session-output", chunk).await;
                current_seq = entry.seq;
            }
        }
    });

    Ok(CallToolResult::success(serde_json::json!({
        "subscribed": true,
        "sinceSeq": since_seq.unwrap_or(0),
    })))
}
```

### 6.4 `attach_session`（状态机核心）

```rust
#[tool(name = "attach_session", description = "Attach to a session (exclusive ownership)")]
pub async fn attach_session(
    ctx: &McpContext,
    params: Parameters<AttachSessionParams>,
) -> Result<CallToolResult, McpError> {
    let session_id = ctx.resolve_session_id(&params.0.session_id)?;
    let caller = ctx.current_client_id();

    // ⭐ CAS 互斥
    let source = AttachSource::Mcp {
        client_id: caller.clone(),
        agent_name: ctx.client_info().name.clone(),
        agent_pid: ctx.client_info().pid,
    };

    ctx.attach_registry.try_attach(session_id, source)?;

    // ⭐ emit 事件让 frontend UI 显示 banner
    ctx.app.emit("mcp-attach-changed", McpAttachChangedEvent {
        session_id,
        client_id: caller,
        action: "attach".to_string(),
    })?;

    Ok(CallToolResult::success(serde_json::json!({
        "attached": true,
        "attachedAtMs": now_ms(),
    })))
}
```

## 7. 工具间依赖图

```
list_sessions ─────► (无)
create_session ─────► attach_registry.check_quota ─► session_manager.create_*
close_session ──────► attach_registry.check_owned_by ─► session_manager.close
send_keys ──────────► attach_registry.check_attached
                    ► safety.is_destructive
                    ► session_manager.write
capture_screen ─────► capture::capture_*
subscribe_output ───► attach_registry.check_attached
                    ► subscribe::OutputRing::subscribe
unsubscribe_output ─► subscribe::OutputRing::unsubscribe
attach_session ─────► attach_registry.try_attach
                    ► app.emit "mcp-attach-changed"
detach_session ─────► attach_registry.detach
                    ► app.emit "mcp-attach-changed"
wait_for ───────────► subscribe (临时) + regex
list_profiles ──────► config_store.profiles
get_config ─────────► config_store.get_allowlist
set_config ─────────► config_store.update_allowlist
```

## 8. 文档地图

| 文档 | 内容 |
|---|---|
| 本文档 | 工具职责总览 |
| [`INTERFACE.md`](INTERFACE.md) | 12 个工具的完整 JSON Schema + Rust struct + 错误码 |
| [`safety/README.md`](../safety/README.md) | send_keys 破坏性键白名单 + policy 决策 |