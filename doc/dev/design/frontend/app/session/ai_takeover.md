# Module · App Session — AI 接管（本地一键 + 释放）

> **位置**：`src/app/modules/session/usecases/ai_takeover/`（PRD §2 M7 + §7.2）
> **类型**：跨 module 业务编排（app/session + app/workspace + app/shell + integration/mcp）
> **UI 对应**：`ui/session/` 的"🤖 AI 接管"按钮 + "释放"按钮 + 顶部 banner

## 1. 这个 module 负责什么

PRD §2 M7 + §7.2 描述的"本地 AI 一键接管"流程——不通过 MCP 入口,而是 UI 按钮直接发起;但底层走的还是同一份 `McpAttachState` 独占机制(由 backend `integration/mcp` 持有)。

承担 3 类职责:

1. **UI 触发** —— 渲染"🤖 AI 接管"按钮 / "释放"按钮 / 顶部 banner
2. **本地发起 attach** —— 用户点按钮 → 模拟一个 MCP client 调 `attach_session`
3. **释放口令检测** —— 监听 session output,匹配配置的口令(默认 `ctrl-cmd-ai-release`)自动 detach

**为什么 backend 不直出"AI takeover IPC"**:
- 独占状态已经在 `integration/mcp::McpAttachState` 实现
- 复用同一份机制避免重复实现 + 状态分裂
- 触发方式是"模拟 MCP client":backend 收到 `attach_session` 后只关心 client_id,不关心 client 是 UI 还是 stdio

## 2. 跟其他 module 的关系

| module | 关系 |
|---|---|
| `app/session/usecases/aiTakeover` | 顶层编排 |
| `integration/mcp` | 调 `attach_session` / `detach_session` MCP 工具 (通过 backend emit IPC,因为 frontend 没有直连 stdio) |
| `app/workspace` | attach 后,workspace pane 状态展示 "AI 接管中" 标识 |
| `app/shell` | 启动时检查 "auto takeover last session" 配置 |
| `infra/tauri/commands/mcp` | 需要新增 IPC handler 把 MCP 工具暴露给 frontend(详见 §4) |

## 3. UI 触发流程

```typescript
// ui/session/components/AiTakeoverButton.tsx
export function AiTakeoverButton({ sessionId }: { sessionId: string }) {
  const isAttached = useSession(sessionId).attached_by_mcp !== null;
  
  const handleClick = async () => {
    if (isAttached) {
      await appSessionApi.detachSession(sessionId);
    } else {
      // 模拟一个特殊 client_id = "ui-takeover"
      await appSessionApi.attachSession(sessionId, "ui-takeover");
    }
  };
  
  return (
    <button onClick={handleClick}>
      {isAttached ? "🤖 释放" : "🤖 AI 接管"}
    </button>
  );
}
```

## 4. IPC 暴露层

frontend 不能直连 MCP stdio,需要 backend 增加 IPC handler 把 attach/detach 暴露出来:

```rust
// commands/mcp.rs (新增 module,v6 后补)
#[tauri::command]
pub async fn attach_session(
    session_id: u32,
    client_id: String,        // frontend 传 "ui-takeover"
    state: State<'_, Arc<SessionManager>>,
    attach_state: State<'_, Arc<McpAttachState>>,
) -> Result<(), String> {
    integration::mcp::tools::attach_session::attach_internal(
        session_id, client_id, state.inner(), attach_state.inner(),
    ).await
}

#[tauri::command]
pub async fn detach_session(/* 同上 */) -> Result<(), String>;
```

**关键**:
- `commands/mcp` 是 v6 后新增的 4th module(原 §1 commands 表格说 3 module —— 后面 P0-3 完成后加 4th)
- 实际是 **MCP attach 工具的 IPC 镜像** —— 内部委托 `integration/mcp::tools::attach_session` 实现
- `commands/mcp` 自身不持有状态 —— 全权委托给 `integration/mcp`

## 5. 释放口令检测

### 5.1 配置入口

```toml
# settings.json (PRD §2 M9 frontend 直存)
[ai_takeover]
release_password = "ctrl-cmd-ai-release"  # 用户可改
match_mode = "exact"                     # exact | regex
case_sensitive = false
```

### 5.2 检测位置:frontend service/session bridge

```typescript
// service/session/aiRelease.ts
export async function setupAiReleaseDetection(sessionId: string) {
  const session = useSessionService();
  const settings = usePersistenceService().get("ai_takeover");
  
  // 监听 session-output 事件
  const unsub = sessionEventBus.onOutput((event) => {
    if (event.sessionId !== sessionId) return;
    
    // 匹配口令
    const text = stripAnsi(event.data.toString());
    const pattern = settings.case_sensitive 
      ? settings.release_password 
      : settings.release_password.toLowerCase();
    
    const matched = settings.match_mode === "exact"
      ? text.toLowerCase().includes(pattern)
      : new RegExp(pattern).test(text);
    
    if (matched) {
      // 自动 detach
      invoke("detach_session", { sessionId, clientId: "ui-takeover" });
      logger.info(`AI takeover released by password match on session ${sessionId}`);
    }
  });
  
  return unsub;
}
```

**关键**:
- 检测发生在 frontend —— 不在 backend(避免每行 output 都要 regex match 开销)
- 用户在终端**正常输入**口令即可触发 —— 不需要 Ctrl+C 之类
- 用户也可手动点 UI "释放" 按钮 —— 等价于主动调 `detach_session`

## 6. UI 状态

### 6.1 Banner(顶部固定)

```typescript
// ui/shell/components/AiTakeoverBanner.tsx
export function AiTakeoverBanner() {
  const attachedSessions = useSessions().filter(s => s.attached_by_mcp);
  
  if (attachedSessions.length === 0) return null;
  
  return (
    <div className="ai-takeover-banner">
      🤖 AI Agent 接管中: {attachedSessions.map(s => s.name).join(", ")}
    </div>
  );
}
```

### 6.2 Pane 状态标识

```typescript
// ui/workspace/components/PaneHeader.tsx
{ pane.session.attached_by_mcp && (
  <span className="ai-attached-indicator" title="此 pane 被 AI agent 接管,用户键盘被屏蔽">
    🤖
  </span>
)}
```

## 7. 边界条件

- **AI attach 后用户输入检测**: backend `domain::session::SessionManager::write()` 检查 `attached_by_mcp` 字段,如果被 AI 独占且 `client_id != "ui-takeover"`(即真实 AI client),用户键盘被屏蔽
- **多 session 同时 attach**: 支持 —— 多个 session 可被不同 client 同时 attach;但同一 session 只被一个 client 独占
- **AI attach 中用户关 app**: backend shutdown 时 `McpAttachState` 自然 drop,所有 attach 解除;启动后 `attached_tmux.json` 重连时保留

## 8. 关键设计决策

### 8.1 为什么不是独立 backend IPC module

考虑过 `commands/mcp/` 做成独立 module(在 commands 顶层加第 4 个)。**但**:
- attach / detach 只 2 个 IPC,不值得独立 module
- 业务逻辑全在 `integration/mcp` —— commands/mcp 只是镜像
- 加进 `commands/session` 也可 —— attach 本质上是 "session 操作"的扩展

**当前决策**: 加进 `commands/session`(详见 §4 代码示例)。

### 8.2 为什么 UI 走 MCP 工具(不直连)

- 复用同一份 `McpAttachState` —— 状态唯一
- 未来 UI takeover 也能转发给真实 MCP client(用户想让本地 UI 接管后通过 reverse tunnel 给远端 agent)—— 统一入口更容易扩展
- PRD §5 AI agent 权限边界 = "MCP 工具只能操作 AI attach 的 session" —— UI takeover 必须走 MCP 路径才合规

### 8.3 为什么不监听 terminal 输出做正则匹配

考虑过在 backend `domain::session` 监听 output 做正则匹配(避免 frontend 检测)。
**但**:
- 每行 output 都要 regex 是性能开销 —— backend 是 hot path
- 用户密码可能在 terminal 输出里 —— backend regex 误触概率比 frontend 低,但仍存在
- PRD §4 安全: "send_keys 注入时禁止破坏性快捷键" —— release 口令本身就是"破坏性"操作 —— 用户主动行为

**当前决策**: frontend 检测;backend 不感知 release 口令内容。

## 9. 文档地图

- 顶层 PRD: §2 M7 / §7.2
- backend 实现: `integration/mcp/RESPONSIBILITY.md` §8.5 (`McpAttachState`)
- frontend 流程: 本文
- 释放口令配置: `service/settings/RESPONSIBILITY.md`(未来 settings 拆分后)
