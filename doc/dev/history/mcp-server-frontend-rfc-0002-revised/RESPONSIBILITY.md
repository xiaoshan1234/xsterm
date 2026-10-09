# Module · App MCP — 职责

> **位置**：`src/app/modules/mcp/`（frontend app/mcp —— PRD §2 M6 + M7 差异化组件）
> **类型**：⭐⭐ 核心差异化 module（AI Terminal 的"产品定义"组件）
> **被调用方**：stdin/stdout 上的 MCP 客户端（Claude Desktop / Cursor / Codex / 自研 agent）
> **UI 对应**：[`ui/mcp/`](../../ui/mcp/RESPONSIBILITY.md)（MCP server 状态面板）
> **架构原则**：见 [`../../README.md §1.1`](../../README.md) 与 [`../../../backend/README.md §1.1`](../../../backend/README.md)—— MCP server 整体归 frontend TS 层。backend 只在 `infra/tauri/mcp_transport.rs` 提供 stdio transport / TCP listener adapter（如果需要）。

## 1. 这个 module 负责什么

MCP module 是 **xsterm 的 AI agent 入口**——按 Anthropic MCP 协议暴露工具集，让 AI agent 像操作文件一样操作 terminal。MVP 整体放 frontend TS 层（架构原则 2026-09），与 Tauri 后端同生命周期。

承担 4 类职责：

### 1.1 MCP server 生命周期
1. **stdio transport** —— 默认监听 stdin/stdout（RFC 0002；Claude Desktop / Cursor / Codex 配 stdio 即可）
2. **TCP transport（可选）** —— `127.0.0.1:<port>` + token 鉴权，默认关闭
3. **server 启动 / 关闭** —— 跟 `commands/shell/api::initialize()` 同一钩子启动；关闭时 graceful drop 所有 client
4. **panic isolation** —— MCP server panic 不应拖垮 UI（R6：tokio task 隔离 + panic hook 重启）

### 1.2 MCP 工具集 v1（PRD §2 M6）
| 工具 | 入参 | 行为 |
|---|---|---|
| `list_sessions` | (无) | 返回所有 active session 元数据 |
| `create_session` | `profile: str` | 按 profile 名（已保存的 session config）创建标签页，返回 `session_id` |
| `close_session` | `session_id: str` | 关闭指定 session |
| `send_keys` | `session_id`, `keys: list[str] \| text: str` | 注入按键或文本（防破坏性快捷键白名单，见 §3） |
| `capture_screen` | `session_id`, `mode: "text" \| "ansi" \| "screenshot"` | 捕获当前屏幕内容 |
| `subscribe_output` | `session_id` | 订阅输出流（增量文本 + 序号） |
| `attach_session` | `session_id` | 当前 MCP 连接独占该 session，其它输入被屏蔽 |
| `detach_session` | `session_id` | 释放独占 |
| `wait_for` | `session_id`, `pattern: str`, `timeout: int` | 等待输出匹配正则 |

### 1.3 业务编排

> **P2-2 精简**——具体编排链详见 §4 数据流图；本节仅列职责范畴。

MCP 工具集通过 `invoke()` 走 Tauri IPC（不直接调 backend domain）——`create_session` 调 `invoke('create_session')` / `send_keys` 调 `invoke('write_session')` / `capture_screen` 调 `invoke('capture_tmux_pane')` / `subscribe_output` 订阅 `service/session/output_channel` / `attach_session` 设置 `app/mcp/client_state` 状态。

### 1.4 安全边界（PRD §4 + §5）

> **P2-2 精简**——4 条边界合并为一段：stdio 默认不监听端口；TCP 启用时强制 127.0.0.1 + token 鉴权；MCP 工具只能操作 AI attach 的 session；send_keys 走破坏性快捷键白名单（默认仅 `Ctrl+C` / `Ctrl+D` / `Ctrl+Z` / `Ctrl+Break`，其余组合键拒绝；用户可在 settings 显式开启全部）。

## 2. 这个 module **不**负责什么

- **不持有 session 元数据**——session 元数据归 `domain::session::SessionManager`；MCP 是 facade
- **不持有 workspace 状态**——workspace 完全 frontend 持有；MCP 工具不暴露 workspace/window/pane 操作
- **不持有 session 元数据**——session 元数据归 `service/session` store；MCP 是 facade
- **不持有 workspace 状态**——workspace 完全 frontend 持有；MCP 工具不暴露 workspace/window/pane 操作
- **不直接 import tauri**——MCP 通过 `@tauri-apps/api` 间接 emit 事件
- **不替代 commands IPC**——MCP 工具集只是 frontend service 的 facade（PRD §3 数据流："MCP server 订阅 → AI agent 收到"）；所有底层 backend 操作仍走 `invoke()` 走 commands

## 3. 子结构

```
src/app/modules/mcp/
├── api.ts                  ⭐ 唯一对外入口
├── server.ts               ⭐ MCP server 启动 / 关闭（stdio + 可选 TCP）
├── tools/                  9 个 MCP 工具实现（PRD §2 M6 工具集 v1）
│   ├── mod.ts
│   ├── list_sessions.ts
│   ├── create_session.ts
│   ├── close_session.ts
│   ├── send_keys.ts        ← send_keys 防破坏性快捷键白名单
│   ├── capture_screen.ts
│   ├── subscribe_output.ts
│   ├── attach_session.ts   ← AI 接管入口（详见 P0-3 design）
│   ├── detach_session.ts
│   └── wait_for.ts
├── auth.ts                 TCP token 鉴权（PRD §4 安全）
├── safety.ts               send_keys 破坏性快捷键白名单
├── client_state.ts         ⭐ AI attach 独占状态（attached_by_mcp client_id → session_id）
├── types.ts                MCP wire 类型（与 backend domain::session 类型镜像）
├── errors.ts               McpError
└── *.test.ts               MCP SDK 兼容性测试
```

**TS 实现选型**：

- **自研** —— 推荐。直接实现 MCP JSON-RPC 2.0 over stdio/TCP，避免引入 MCP SDK 依赖；session/workspace/tmux state 已经在 frontend TS 里持有，调用方便
- **MCP SDK (TypeScript)** —— 可选加速开发，但与 frontend state 集成需要适配层；MCP SDK 在 TS 生态较新，运行时风险自担

## 4. 跟 frontend 的关系

```
AI agent (Claude Desktop)
    ↓ stdio (MCP protocol)
MCP server (app/mcp)
    ↓ 调 service api + invoke('create_session' / 'write_session' / 'capture_screen' / etc.)
backend commands (Tauri IPC)
    ↓ 通过 RealAppBackend emit 事件
frontend infra/tauri (listen session-output / session-closed)
    ↓ 写入 frontend store
ui (渲染)
```

**关键**：
- MCP **不**通过 Tauri IPC 与 frontend 通信——MCP 直接走 stdio
- frontend 不感知 MCP 存在（除了显示 "🤖 AI 接管" banner——那是 `commands/shell` emit 的事件触发的，不是 MCP 直发）
- MCP 工具调用链 vs frontend 工具调用链是**并行**的——都最终落到 backend commands IPC，backend 内部统一调 `domain::session::SessionManager` / `domain::terminal::TmuxController`

## 5. 跟其他 backend module 的关系

| module | 关系 |
|---|---|
| `commands/session` (backend) | 间接通过 `invoke()` |
| `service/session` | 调 `service/session` 公开方法 + `invoke()` 调 backend IPC |
| `service/tmux` | 调 `service/tmux` 公开方法 + `invoke('capture_tmux_pane')` for tmux session |
| `commands/terminal` (backend) | 间接通过 `invoke('capture_tmux_pane')` 等 |
| `infra/tauri` (frontend) | 通过 `@tauri-apps/api` 间接 emit 事件 |
- `commands/shell` (backend) | shell `initialize()` 内部启动 MCP server；shell `log_message` IPC 给前端，但 MCP 不走这条路径（MCP 自己 emit Tauri event 给 frontend logger） |
**关键**：

- ❌ `app/mcp/` → backend `domain::*`（MCP 在 frontend 不触碰 backend Rust 域）
- ❌ `app/mcp/` → `service/*` 内部 helper（必须经过 `service/<domain>/api.ts` 边界）
- ❌ `app/mcp/` → `ui/*` 组件（必须经过 app/ui api 边界）
- ✅ `app/mcp/` → `service/*` 公开 api（service/session, service/tmux 等）
- ✅ `app/mcp/` → `@tauri-apps/api`（通过 `invoke()` 调 backend）

## 6. 用户故事（AI agent 视角）

- **作为 Claude Desktop 用户**，我配 stdio MCP server → Claude 能看到所有标签页，能 create_session("my-dev-profile") 创建新标签页
- **作为 AI agent**，我用 `send_keys("ls\n")` → backend 注入 `\n` 到 PTY stdin → 输出流推回 `subscribe_output`
- **作为 AI agent**，我用 `wait_for(session_id, "READY", timeout=10)` → 等命令完成时返回匹配行
- **作为 AI agent**，我用 `attach_session(session_id)` → 该 session 标记为 AI 独占，用户键盘输入被屏蔽；UI 顶部出现 "🤖 AI 接管" banner
- **作为用户**，我在终端输入 `ctrl-cmd-ai-release`（默认口令，可配置）→ AI 接管自动解除
- **作为 AI agent**，我在用 `send_keys(["Ctrl", "C"])` 时被拦下并提示需要用户授权破坏性快捷键

## 7. 这个 module 的"产品语言"术语

- **MCP** —— Model Context Protocol（Anthropic 提出的 AI agent ↔ 工具协议）
- **stdio transport** —— MCP 默认通信方式（stdin/stdout）
- **TCP transport** —— MCP 可选通信方式（127.0.0.1 + token）
- **MCP tool** —— MCP 协议定义的可调用函数（MCP SDK 中是 `@tool` 标注的函数）
- **MCP resource** —— MCP 协议定义的只读数据（xsterm MVP 不暴露 resource）
- **AI 接管（attach）** —— session 被某个 MCP client 独占的状态（详见 P0-3）
- **AI 释放口令** —— 用户在终端输入特定字符串解除 AI 接管（默认 `ctrl-cmd-ai-release`）
- **破坏性快捷键** —— send_keys 中需要白名单的组合键（Ctrl+C / Ctrl+D / Ctrl+Z 之外）

## 8. 关键设计约束

### 8.1 MCP server 启动（frontend app 触发）

```typescript
// src/app/modules/shell/usecases/initialize.ts (frontend app/shell)
export async function initialize(): Promise<void> {
  // 1. logging 初始化（调 commands/shell IPC，backend 处理）
  await invoke('shell_initialize_logging');
  
  // 2. binary output channel 监听
  const channel = await listen('session-output', handler);
  
  // 3. ⭐ MCP server 启动（frontend app/mcp 自身编排）
  const mcpServer = await import('@/app/modules/mcp');
  await mcpServer.startServer({
    transport: 'stdio',  // 默认
    token: settings.mcpTcpToken,  // 仅 TCP 用
  });
  
  // 4. readiness.setReady(true)
}
```

**关键**：
- MCP server 由 frontend `app/shell` 的 `initialize()` 编排启动（在 Tauri webview 内）
- 不走 Tauri IPC——MCP server 进程 = Tauri webview 进程
- 后台 stdio/TCP listener 由 frontend TS 直接管理（Node child_process 或 net 模块）
- 不需要 backend 介入 —— `invoke()` 只用来调底层 backend 命令（write_session / create_session 等）

### 8.2 stdio transport 是默认

```rust
// app/mcp/server.ts
pub async fn start(app: &AppHandle) -> Result<(), McpError> {
    let server = McpServer (TS 实现)::new(McpImpl::new(...))
        .with_stdio_transport()           // ← 默认
        .with_tcp_transport_if_enabled()  // ← settings 启用才打开
        .build()
        .await?;
    
    setImmediate(async () => {
        if let Err(e) = server.serve().await {
            tracing::error!("MCP server crashed: {e}");
            // 不 propagate 给 Tauri UI——独立 task
        }
    });
    Ok(())
}
```

**关键**：
- stdio 是默认；TCP 必须用户显式开启 + token 鉴权
- 应用启动时 `netstat -ano | findstr LISTEN` 不应看到 xsterm.exe（除非 TCP 启用）
- TCP 默认关闭，关闭后进程立即停止 TCP listener

### 8.3 send_keys 破坏性快捷键白名单

```rust
// app/mcp/safety.rs
pub fn is_destructive_combo(keys: &[String]) -> bool {
    // 允许通过的"破坏性"快捷键白名单（PRD §4）
    const ALLOWED_DESTRUCTIVE: &[&str] = &[
        "Ctrl+C", "Ctrl+D", "Ctrl+Z",  // 中断信号
        "Ctrl+Break",                   // Windows break
    ];
    
    if keys.iter().any(|k| k.starts_with("Ctrl+") || k.starts_with("Alt+")) {
        // 是组合键——检查是否在白名单
        let combo = keys.join("+");
        if !ALLOWED_DESTRUCTIVE.contains(&combo.as_str()) {
            return true;  // 拒绝
        }
    }
    false  // 允许
}
```

**关键**：
- 默认拒绝所有 `Ctrl+*` / `Alt+*` 组合键（除白名单 4 个）
- 用户可在 settings.json 开启 "allow all destructive shortcuts"
- 拒绝时返回明确错误消息，提示用户授权

### 8.4 subscribe_output 增量 + 序号

```rust
// app/mcp/tools/subscribe_output.rs
pub async fn subscribe_output(
    session_id: &str,
    since_seq: Option<u64>,
) -> Result<OutputStream, McpError> {
    let receiver = state.output_channel(session_id).ok_or(...)?;
    
    // 返回 SSE 流（订阅 service/eventBus 的 output channel），每条带递增序号
    let mut seq = since_seq.unwrap_or(0);
    while let Some(bytes) = receiver.recv().await {
        seq += 1;
        yield OutputChunk { seq, data: bytes, timestamp_ms: now() };
    }
}
```

**关键**：
- 序号从 1 单调递增，client 用来检测丢消息 / 重排
- 字节流编码跟 `infra::tauri::BinaryFrame` 一致——但 MCP 走文本协议，所以拆成 JSON-friendly chunks
- 关闭时 SSE 流 graceful end——client 收到 `done` 后停止订阅

### 8.5 AI attach 独占状态

```typescript
// app/mcp/client_state.ts
export class McpAttachState {
  // session_id → { client_id, attached_at_ms }
  private attachments = new Map<string, AttachEntry>();
}

interface AttachEntry {
  client_id: string;        // MCP client 唯一标识
  attached_at_ms: number;
}

export function tryAttach(sessionId: string, clientId: string): void {
  const existing = attachments.get(sessionId);
  if (existing && existing.client_id !== clientId) {
    throw new McpError(`Session already attached by ${existing.client_id}`);
  }
  attachments.set(sessionId, { client_id: clientId, attached_at_ms: Date.now() });
  
  // 通知 frontend：emit Tauri event 给 banner 显示
  emit('mcp-attach-changed', { sessionId, clientId, action: 'attach' });
}

export function detach(sessionId: string, clientId: string): void {
  const existing = attachments.get(sessionId);
  if (!existing || existing.client_id !== clientId) {
    throw new McpError('Cannot detach: not attached by this client');
  }
  attachments.delete(sessionId);
  emit('mcp-attach-changed', { sessionId, clientId, action: 'detach' });
}
```

**关键**：
- session 只能被一个 MCP client attach；如果被别的 client 占着，新 client attach 失败
- 状态在 frontend TS —— frontend UI 立即可用（banner 显示）
- 通过 emit Tauri event 让 backend 知道（backend 用 `is_attached_by_mcp()` 决定是否屏蔽用户键盘）
- 详见 P0-3 AI 接管设计

## 9. 占位与未来工作

- **MCP resource 暴露**（MVP 不做）—— 暴露 session 元数据 / settings snapshot 作为 resource
- `mcp 子进程化`（RFC 0002 长期）—— 当前嵌入 Tauri webview；未来 spawn 独立进程，panic 不再传播
- **MCP sampling**（Anthropic 新协议）—— server 主动调用 LLM，MVP 不做
- **MCP prompts** —— 预定义 prompt template，MVP 不做

## 10. 文档地图

- 顶层（本文）：MCP 集成层职责 + 9 个工具 + 安全边界
- 各工具子文档：每个 tool 1 份（RESPONSIBILITY/INTERFACE/DOWNSTREAM）
- AI 接管独占状态：详见 P0-3 `frontend/app/session/ai_takeover.md` 和 `domain/session/attach.md`
- PRD §2 M6 / §3 mcp 模块 / §7.2 MCP attach 流程 / RFC 0002

**TM 验收入口**：先读本文档 → 读 `app/mcp/server/RESPONSIBILITY.md`（stdio vs TCP）→ 读 `tools/send_keys/RESPONSIBILITY.md`（安全白名单）→ 读 P0-3 AI 接管设计。
