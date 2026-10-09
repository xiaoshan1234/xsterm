# Module · App MCP — 对外接口

> **位置**：`src/app/modules/mcp/`
> **唯一进口**：`useMcpServer()` hook（`api.ts` 导出）
> **架构原则**：见 [`../../README.md §1.1`](../../README.md)—— MCP server 整体归 frontend TS 层。backend 只提供 stdio transport helper（`backend/infra/tauri/mcp_transport.rs`，如果未来 MCP server 需要独立进程再引入）。

## 1. 对外暴露什么

MCP module 暴露 **2 个对外符号**：

1. **`server::start(app)`** —— Tauri 启动钩子调一次
2. **`server::shutdown()`** —— Tauri 关闭钩子调一次（graceful drop）

外部不直接 import 工具实现——MCP 工具通过 MCP SDK 自动注册（`@tool` 标注），由 MCP 协议层调度。

## 2. 核心接口

### 2.1 server 生命周期

```typescript
// app/mcp/server.ts
/// 启动 MCP server。frontend app/shell `initialize()` 内调一次。
/// 内部：stdio transport 立即启动；TCP transport 按 settings 决定是否启动。
export async function startServer(ctx: McpContext, opts: ServerOpts): Promise<void>;

/// 关闭 MCP server。frontend app/shell 关闭时调一次（如果需要的话；通常由 Tauri webview 销毁触发）。
/// 内部：graceful drop 所有 client，flush 状态。
export async function shutdown(ctx: McpContext): Promise<void>;
```
**关键**：

- `startServer` 是异步但**不** await 完成（fire-and-forget）——frontend app/shell.initialize 同步返回
- TCP transport 启动失败不阻塞整体启动——返回 tracing::warn + 关闭 stdio 不受影响
- panic isolation：内部 panic 由 try/catch 捕获，log 不 propagate

### 2.2 工具入口（MCP SDK 自动注册）

```rust
```typescript
// app/mcp/tools/list_sessions.ts
export async function list_sessions(ctx: McpContext): Promise<ListSessionsResult> {
  const sessions = ctx.sessionStore.listAll();
  return { sessions };
}
```

```typescript
// app/mcp/tools/create_session.ts
export async function create_session(
  ctx: McpContext,
  profile: string,
): Promise<CreateSessionResult> {
  const sessionId = await invoke<string>("create_session", { config: profile });
  return { session_id: sessionId, name: profile };
}
```

**关键**：
- 工具由 MCP `@tool` 装饰器 标注自动注册到 MCP server
- `McpContext` 注入到工具函数（持有 service store + attach state + emit）
- 工具不直接 import tauri——通过 `McpState` 抽象

## 3. 工具集 v1 接口签名

### 3.1 list_sessions

```rust
#[tool(name = "list_sessions")]
async fn list_sessions(state: McpContext) -> Promise<ListSessionsResult>;

#[derive(Serialize)]
struct ListSessionsResult {
    sessions: Vec<SessionSummary>,  // id, name, kind, status, attached_by_mcp
}
```

### 3.2 create_session

```rust
#[tool(name = "create_session")]
async fn create_session(
    profile: String,                   // saved session config name
    ctx: McpContext,
) -> Promise<CreateSessionResult>;

#[derive(Serialize)]
struct CreateSessionResult {
    session_id: String,                // 数字 id 序列化为 string
    name: String,
}
```

**行为**：
- 调 `commands/session/api::create_session(SessionConfig::from_profile(profile))`
- 触发 frontend `service/persistence` 直存 saved config 流程由 frontend 编排（MCP 不直写 store）
- 失败：profile 名不存在 / backend 启动失败 → `McpError::SessionCreateFailed`

### 3.3 close_session

```rust
#[tool(name = "close_session")]
async fn close_session(
    session_id: String,
    ctx: McpContext,
) -> Promise<CloseSessionResult>;
```

### 3.4 send_keys

```rust
#[tool(name = "send_keys")]
async fn send_keys(
    session_id: String,
    keys: Option<Vec<String>>,         // 组合键形式（["Ctrl", "C"]）
    text: Option<String>,              // 普通文本（含 true 注入）
    ctx: McpContext,
) -> Promise<SendKeysResult>;
```

**行为**：
- 校验 `keys` 不含破坏性快捷键（safety.rs 白名单）
- 校验 `keys` / `text` 至少一个非空
- 调 `invoke('write_session', { sessionId, data: bytes })`（合并 keys + text 成 byte stream）
- 失败：白名单拒绝 / session 不存在 / MAX_WRITE_PAYLOAD_BYTES 超限

### 3.5 capture_screen

```rust
#[tool(name = "capture_screen")]
async fn capture_screen(
    session_id: String,
    mode: CaptureMode,                  // "text" | "ansi" | "screenshot"
    lines: Option<u32>,                // scrollback 行数（默认 100）
    ctx: McpContext,
) -> Promise<CaptureScreenResult>;

enum CaptureMode { Text, Ansi, Screenshot }
```

**行为**：
- `Text` 模式：从 session output buffer 读最近 N 行，剥 ANSI 转义
- `Ansi` 模式：从 output buffer 读最近 N 行，保留 ANSI
- `Screenshot` 模式（MVP 不做）：读 xterm render snapshot，编码 PNG
- tmux session 走 `commands/terminal/api::capture_tmux_pane(session_id, lines)`

### 3.6 subscribe_output

```rust
#[tool(name = "subscribe_output")]
async fn subscribe_output(
    session_id: String,
    since_seq: Option<u64>,             // 增量订阅起点
    ctx: McpContext,
) -> Promise<SubscriptionHandle>;

struct SubscriptionHandle {
    /// MCP SSE stream
    stream_url: String,
    /// 当前已发布序号
    current_seq: u64,
}
```

**行为**：
- 订阅 `domain::session::SessionManager::output_channel(session_id)` 或 `infra::tauri::RealAppBackend::session_output_channel` 推送
- 序号从 1 单调递增，client 可传 `since_seq` 重连

### 3.7 attach_session / detach_session

详见 P0-3 AI 接管设计。

```rust
#[tool(name = "attach_session")]
async fn attach_session(
    session_id: String,
    ctx: McpContext,
) -> Promise<AttachSessionResult>;

#[tool(name = "detach_session")]
async fn detach_session(
    session_id: String,
    ctx: McpContext,
) -> Promise<DetachSessionResult>;
```

### 3.8 wait_for

```rust
#[tool(name = "wait_for")]
async fn wait_for(
    session_id: String,
    pattern: String,                   // 正则
    timeout_ms: u32,                   // 超时（毫秒）
    ctx: McpContext,
) -> Promise<WaitForResult>;

struct WaitForResult {
    matched: bool,
    matched_line: Option<String>,      // 匹配的行内容
    elapsed_ms: u64,
}
```

**行为**：
- 内部临时订阅 output channel，按行 scan 找匹配
- 超时返回 `matched: false`，不抛错

## 4. 类型

```rust
// app/mcp/types.rs
pub struct SessionSummary {
    pub id: u32,
    pub name: String,
    pub kind: String,                   // "local" | "ssh" | "tmux"
    pub status: String,                 // "running" | "closed" | "error"
    pub attached_by_mcp: Option<String>, // 被哪个 client_id 独占
}

pub struct CreateSessionResult { /* ... */ }
pub struct CloseSessionResult { /* ... */ }
pub struct SendKeysResult { /* ... */ }
pub struct CaptureScreenResult { /* ... */ }
pub struct SubscriptionHandle { /* ... */ }
pub struct AttachSessionResult { /* ... */ }
pub struct DetachSessionResult { /* ... */ }
pub struct WaitForResult { /* ... */ }
```

## 5. Errors

```typescript
// app/mcp/errors.ts
export class McpError extends Error {
  constructor(
    public kind:
      | "session_not_found"
      | "session_create_failed"
      | "session_already_attached"
      | "destructive_shortcut_rejected"
      | "payload_too_large"
      | "server_crashed"
      | "auth_failed"
      | "mcp_sdk_error",
    message: string,
    public context?: Record<string, unknown>,
  ) {
    super(message);
  }

  /** 序列化为 JSON-RPC 2.0 error 格式 */
  toJsonRpcError(): { code: number; message: string; data?: unknown } {
    // 映射规则见 MCP 协议规范
    return { code: -32000, message: this.message, data: this.context };
  }
}
```

## 6. McpContext（依赖注入容器）

```typescript
// app/mcp/context.ts
import { useSessionStore } from "@/service/session";
import { useTmuxStore } from "@/service/tmux";
import { McpAttachState } from "./client_state";
import { emit } from "@tauri-apps/api/event";

export interface McpContext {
  sessionStore: ReturnType<typeof useSessionStore>;
  tmuxStore: ReturnType<typeof useTmuxStore>;
  attachState: McpAttachState;
  emit: typeof emit;
}

export function createMcpContext(): McpContext {
  return {
    sessionStore: useSessionStore(),
    tmuxStore: useTmuxStore(),
    attachState: new McpAttachState(),
    emit,
  };
}
```

**关键**：
- `McpContext` 通过闭包注入到工具函数（无 State extractor 概念）
- 不直接暴露 `@tauri-apps/api` 给 MCP 工具——通过 `emit` 字段间接用

## 7. 接缝契约

```typescript
// src/app/modules/shell/usecases/initialize.ts (frontend app/shell)
export async function initialize(): Promise<void> {
  // 1. logging 初始化（调 backend shell IPC）
  await invoke("shell_initialize_logging");

  // 2. binary output channel 监听（backend emit）
  const channel = await listen("session-output", handler);

  // 3. ⭐ MCP server 启动（frontend app/mcp 自身编排）
  const ctx = createMcpContext();
  await startServer(ctx, { transport: "stdio" });

  // 4. readiness.setReady(true)
}
```

**关键**：
- MCP server 由 frontend `app/shell` 的 `initialize()` 编排启动（在 Tauri webview 内）
- 不需要 backend 介入 —— MCP 跟 backend 是平行的 stdio / TCP server
- frontend TS 的 startup 顺序：app/shell.initialize → app/mcp.startServer → readiness.setReady

## 8. 不对外暴露

- 工具实现内部 helper（如 `isDestructiveCombo`）——只在 `tools/<name>.ts` 内部使用
- `McpAttachState` 内部 `Map` 字段——只通过 `tryAttach` / `detach` / `isAttached` 公开方法
- MCP SDK 内部类型——通过 JSON.stringify / JSON.parse 自动转换 MCP wire format
- `@tauri-apps/api` 在 `McpContext` 内部——只用来 emit 事件给 frontend UI（不是 MCP → frontend 业务通信）

## 9. api 变更流程

1. **新增 MCP 工具** → 加 `tools/<name>.ts` + `@tool` 装饰器 + INTERFACE.md §3 一节 + 类型契约更新
2. **修改工具签名** → 同步更新 INTERFACE.md §3 + 测试 + MCP 协议版本 bump
3. **删除工具** → 从 `tools/<name>.ts` 删除 + INTERFACE.md 同步（**⚠️ breaking 协议变更**）
4. **新增 transport**（如 Unix socket）→ 加 `server.ts` 内部 helper + settings 选项
5. **修改 attach 状态语义** → 同步 P0-3 AI 接管设计 + frontend banner 事件契约

## 10. 错误传播约定

- infra → MCP：`Result<T, McpError>`（typed error via `From`）
- MCP → MCP wire：`Promise<T>` 通过 MCP SDK 自动序列化
- client 收到非预期错误（如 server crash）：MCP SDK 返回连接错误，client 端自行 retry
