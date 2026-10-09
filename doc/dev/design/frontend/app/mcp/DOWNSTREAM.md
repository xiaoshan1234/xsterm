# Module · App MCP — 对下依赖 (frontend listener only)

> **位置**: `src/app/modules/mcp/`
> **状态**: ⭐ NEW (RFC 0002-revised-2)

## 1. 依赖图

```
src/app/modules/mcp/
├── infra/tauri/events        listen('mcp-attach-changed' / 'mcp-tool-called' / 'mcp-tool-returned' / 'mcp-server-status')
├── infra/tauri/commands/mcp  invoke('mcp_http_start/stop' / 'mcp_stdio_start/stop' / 'regenerate_mcp_token')
├── @tauri-apps/api/event       listen() 基础 API
├── @tauri-apps/api/core        invoke() 基础 API
├── zustand                     store (McpStoreState)
└── react                       useState / useEffect / useMemo (UI hooks)
```

## 2. 被调方 (上游)

| caller | 用途 |
|---|---|
| `ui/mcp/McpStatusPanel.tsx` | `useMcpListener()` 拿 server status + tool calls |
| `ui/mcp/McpAttachBanner.tsx` | `useMcpListener().useIsAttachByMcp(sessionId)` |
| `ui/settings/McpTransportTab.tsx` | `startHttpServer/stopHttpServer/startStdioServer/stopStdioServer` |
| `app/shell::usecases/initialize.ts` | `init()` 启动 listener (调 listen 4 类事件) |
| `service/session/bridge` (通知) | 不直接调,只通过 `listen('mcp-attach-changed')` 同步 banner (RFC 0002-revised-2: 单一真源 = backend) |

## 3. emit 事件订阅

| 事件名 | payload | 来自 backend | UI 影响 |
|---|---|---|---|
| `mcp-attach-changed` | `{ sessionId, clientId, action }` | `services/registry/attach_registry` 直 emit (本 module 透传) | attach banner 显隐 |
| `mcp-tool-called` | `{ tool, params, clientId, requestId }` | `services/mcp/events.rs` | tool log 入口 |
| `mcp-tool-returned` | `{ tool, result?, error?, latencyMs, requestId }` | `services/mcp/events.rs` | tool log 完成 (ok/error/耗时) |
| `mcp-server-status` | `{ httpRunning, stdioRunning, activeStdioClients, port }` | `services/mcp/events.rs` | server status 卡片 |

## 4. invoke 触发

| 命令 | 用途 | 触发 UI |
|---|---|---|
| `invoke('mcp_http_start')` | 启动 backend HTTP server | `ui/settings/McpTransportTab` 按钮 |
| `invoke('mcp_http_stop')` | 停止 backend HTTP server | 同上 |
| `invoke('mcp_stdio_start')` | spawn backend stdio sidecar | 同上 |
| `invoke('mcp_stdio_stop')` | kill backend stdio sidecar | 同上 |
| `invoke('regenerate_mcp_token')` | 重新生成 Bearer token | `ui/settings/McpTransportTab` |

## 5. 启动序列

```typescript
// app/shell::usecases/initialize.ts (片段)
// 4. ⭐ app/mcp/listener.ts::startListening(ctx)
const mcpListenerCleanup = await startListening({
  store: mcpStore,
  invoke,
  appHandle: getCurrent(),
});
// 注册到 app 生命周期, 在 quit hook 调 mcpListenerCleanup()
```

## 6. 强约束 (pre-commit 必跑)

```bash
# 1. ❌ frontend app/mcp 不能直连 backend services (必须通过 Tauri events)
grep -rnE 'session_manager\.|attach_registry\.|subscribe_registry\.' src/app/mcp/
# 必须为空

# 2. ❌ frontend app/mcp 不能直连 backend Rust module (不能 import src-tauri)
grep -rn 'src-tauri' src/app/mcp/
# 必须为空

# 3. ❌ frontend app/mcp 不能 import MCP SDK (假定)
grep -rnE '@modelcontextprotocol/sdk' src/app/mcp/
# 必须为空 (RFC 0002-revised-2: frontend 不再是 MCP server)

# 4. ❌ frontend app/mcp 不能启动 HTTP server (RFC 0002-revised-2)
grep -rnE 'new\s+Server|express\(\)|listen\([0-9]' src/app/mcp/
# 必须为空 (backend tokio listener 负责)

# 5. ❌ frontend app/mcp 不能 import express / http / https (假定)
grep -rnE 'from\s+"express"|from\s+"http"|from\s+"https"|node:http|node:net' src/app/mcp/
# 必须为空 (frontend HTTP server 是 v3 历史责任)

# 6. ❌ frontend app/mcp 不能直跳 model/session (通过 service/session/bridge 间接)
grep -rnE 'from\s+"@/model/session' src/app/mcp/
# 必须为空

# 7. ✅ frontend app/mcp 必须 listen 4 类事件
grep -rnE "listen<[A-Za-z]+>\(\"mcp-" src/app/mcp/
# 应当出现 (McpAttachChangedEvent / McpToolCalledEvent / McpToolReturnedEvent / McpServerStatus)

# 8. ✅ frontend app/mcp 必须 invoke 5 个 commands (RFC 0002-revised-2)
grep -rnE "invoke\('mcp_(http|stdio)|invoke\('regenerate_mcp_token'" src/app/mcp/
# 应当出现
```

## 7. 不允许的依赖

- ❌ `app/mcp` → `services/mcp` (backend Rust module, frontend 不能直跳)
- ❌ `app/mcp` → `model/session/types` 直读 (走 `service/session/bridge` + listen)
- ❌ `app/mcp` → `app/session/usecases` (不允许 frontend MCP 调业务 usecase)
- ❌ `app/mcp` 发起 MCP tool 调用 (HTTP POST /mcp / stdio write) — 只能 AI agent 调
- ❌ `app/mcp` 持有 Bearer token (backend `services/mcp/auth.rs` 验证, frontend 不知道)

## 8. 生命周期

```
app startup:
    app/shell::usecases/initialize.ts:
        mcpListenerCleanup = await startListening(ctx)  // 注册 4 类 listen
    → cleanup 注册到 app quit hook
    
app runtime (per backend event):
    backend services/mcp/events.rs::emit_tool_called()
    → Tauri event bus → frontend listen('mcp-tool-called')
    → app/mcp/listener.ts 回调 → store.addToolCall()
    → zustand re-render → McpStatusPanel 更新
    
app shutdown:
    app quit hook:
        mcpListenerCleanup()  // 取消所有 listen
```

## 9. 依赖变更流程

新增 1 类 listen 事件 (e.g. "mcp-error"):
1. `backend/services/mcp/events.rs` 加 emit 函数
2. `frontend/app/mcp/listener.ts` 加 cleanup 注册
3. `frontend/app/mcp/store.ts` 加 state 字段
5. 上面 §6 grep 加新检查项
6. 上面 §3 表加新事件行