# Module · App MCP — 职责 (frontend listener only)

> **位置**: `src/app/modules/mcp/` (PRD §2 M6 + M7 — frontend 仅做 UI 实时显示)
> **类型**: ⭐ MCP UI listener (RFC 0002-revised-2: backend `services/mcp/` 是 MCP server 真源; frontend 只 listen 不 serve)
> **被调用方**: 无 (frontend listener 是被动订阅)
> **架构原则**: 见 [`../../README.md §4.1`](../../README.md) + [`../../../backend/README.md §4.1`](../../../backend/README.md) + [`../../../backend/services/mcp/RESPONSIBILITY.md`](../../../backend/services/mcp/RESPONSIBILITY.md) (RFC 0002-revised-2)

> **历史**: RFC 0002-revised (frontend MCP server 方案) 已被 RFC 0002-revised-2 取代。旧 RESPONSIBILITY.md 归档到 `doc/dev/history/mcp-server-frontend-rfc-0002-revised/RESPONSIBILITY.md`。

## 1. 这个 module 负责什么

frontend `app/mcp/` **退化**为 backend MCP 事件的被动订阅者 (RFC 0002-revised-2 supersede RFC 0002-revised)。

**只承担 1 类职责**: 监听 backend `services/mcp/` 推来的事件 + 更新 UI 状态。

### 1.1 不再做的事 (RFC 0002-revised → RFC 0002-revised-2 删除)

| ❌ 删除 (RFC 0002-revised frontend 方案) | ✅ 新方案 (RFC 0002-revised-2) |
|---|---|
| 启动 HTTP server (`server.ts`) | backend `services/mcp/http.rs` 启动 tokio listener |
| 注册 12 个 MCP 工具 (`tools/*.ts`) | backend `services/mcp/tools/*.rs` |
| Bearer token 鉴权 (`auth.ts`) | backend `services/mcp/auth.rs` |
| 破坏性快捷键拦截 (`safety.ts`) | backend `services/mcp/safety.rs` |
| client_state mirror (`client_state.ts`) | backend `attach_registry` 是真源, frontend listen 即可 |
| JSON-RPC 2.0 解析 (`server.ts`) | backend `services/mcp/types.rs` + `rmcp` SDK |

### 1.2 保留的事 (frontend listener)

1. **`app/mcp/listener.ts`** —— `listen('mcp-attach-changed' / 'mcp-tool-called' / 'mcp-tool-returned' / 'mcp-server-status')` 4 类事件
2. **`app/mcp/store.ts`** —— zustand store 镜像 MCP server 状态 (用于 UI 渲染)
3. **`app/mcp/api.ts`** —— 唯一对外入口 (`useMcpListener()` hook 给 UI 组件用)
4. **`app/mcp/ui/McpStatusPanel.tsx`** —— UI 组件: 显示 MCP server 状态 + tool 调用日志
5. **`app/mcp/ui/McpAttachBanner.tsx`** —— UI 组件: attach banner

## 2. 与其他 module 的关系

| module | 关系 |
|---|---|
| `infra/tauri/events` | `listen('mcp-*')` 订阅 backend 事件 |
| `infra/tauri/commands/mcp` | `invoke('mcp_http_start/stop' / 'mcp_stdio_start/stop')` UI 控制 backend MCP transport |
| `ui/mcp/McpStatusPanel.tsx` | `useMcpListener()` 拿 zustand state 渲染 |
| `ui/mcp/McpAttachBanner.tsx` | `useMcpListener()` 拿 attach state 渲染 |
| `app/session` | 不直连 — 通过 `listen('mcp-attach-changed')` 同步 (后端真源) |
| `service/session` | 不直读 — 只通过 `listen` 看到 attach 状态 (vs RFC 0002-revised 中 frontend 持有 store) |

**关键依赖规则 (RFC 0002-revised-2)**:
- ❌ frontend `app/mcp` 不直接调 `commands/session::write_session` 等业务 IPC
- ❌ frontend `app/mcp` 不直读 backend `session_manager` / `attach_registry` 状态
- ✅ frontend `app/mcp` 仅通过 `listen` 事件 + `invoke` 控制 MCP transport 启停

## 3. 内部结构

```
modules/mcp/
├── api.ts            ⭐ 唯一对外入口 (useMcpListener hook)
├── listener.ts       ⭐ listen('mcp-*') 4 类事件 + dispatch 到 store
├── store.ts          zustand store 镜像 backend MCP 状态
├── index.ts          barrel: 只 re-export api.ts
└── ui/               React 组件
    ├── McpStatusPanel.tsx
    └── McpAttachBanner.tsx
```

**强制规则**:
- `index.ts` 只 export `api.ts`
- 其他 module `import { X } from "@/app/modules/mcp/api"`
- ❌ 禁止 import `listener.ts` / `store.ts` / `ui/*` 内部

## 4. listen 事件契约

| 事件 | payload 类型 | UI 影响 |
|---|---|---|
| `mcp-attach-changed` | `{ sessionId: number, clientId: string, action: 'attach' \| 'detach' \| 'force_detach' }` | `McpAttachBanner` 显示/隐藏 |
| `mcp-tool-called` | `{ tool: string, params: any, clientId: string, requestId: string, timestamp: number }` | `McpStatusPanel` 添加 tool 入口日志 |
| `mcp-tool-returned` | `{ tool: string, result?: any, error?: McpError, latencyMs: number, requestId: string, timestamp: number }` | `McpStatusPanel` 更新 tool 状态 (ok/error/耗时) |
| `mcp-server-status` | `{ httpRunning: boolean, stdioRunning: boolean, activeStdioClients: number, port: number, timestamp: number }` | `McpStatusPanel` 显示 server 状态 (offline/http-only/stdio-active/both) |

详见:
- [`INTERFACE.md`](INTERFACE.md) — listener API + zustand store 类型
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图 + 强约束 grep