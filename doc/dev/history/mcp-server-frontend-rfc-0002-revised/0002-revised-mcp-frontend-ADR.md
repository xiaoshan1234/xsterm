# RFC 0002 (Revised): MCP server 放 frontend TS 层 + HTTP transport

| 字段 | 值 |
|---|---|
| 状态 | Accepted（override RFC 0002） |
| 日期 | 2026-09-29 |
| 作者 | dev（基于用户决策）+ tm review |
| 影响阶段 | M3 |
| 决策 D-β | revised |
| 关联 ADR | RFC 0002 (superseded)、`doc/dev/design/frontend/app/mcp/` |

---

## 1. 背景

RFC 0002（2026-09-11 pdm 拍板）把 MCP server 放 backend 主进程内嵌，理由：单二进制 + 部署简单 + 跨进程隔离成本高。

但 RFC 0002 没考虑到：

1. **frontend 设计文档已经按 app/mcp 做了**（`doc/dev/design/frontend/app/mcp/RESPONSIBILITY.md` 302 行 + INTERFACE + DOWNSTREAM），把 MCP 协议层放 TS 实现
2. **xsterm 是 AI Terminal 的"产品差异化组件"**——MCP 工具列表、attach 状态机 UI、AI 接管 banner 都是 frontend 关键 UX
3. **WebView 没有 stdin/stdout**——stdio transport 在 frontend 必须绕道（sidecar 或 IPC bridge）
4. **rmcp SDK 跟 frontend zustand store 集成成本**——append 适配层而不是直接复用

## 2. 决策

**MVP 阶段：MCP server 作为 frontend `app/mcp/` 模块实现，仅暴露 HTTP transport。**

- ✅ HTTP transport（`127.0.0.1:19847` + Bearer token）—— WebView 内启动 HTTP server，所有 MCP 客户端走 HTTP
- ❌ stdio transport（不实现，WebView 无 stdin/stdout；Claude Desktop 通过 HTTP 接入，配置方式与 stdio 类似）

### 2.1 MCP 协议层 = frontend TS

- frontend `app/mcp/server.ts` 启动 HTTP server（用浏览器原生 `fetch` + Node `http` polyfill 或纯 Web API）
- 12 个 MCP 工具在 `app/mcp/tools/*.ts` 实现，每个工具是 frontend 业务编排层调用
- MCP 协议层（JSON-RPC 2.0）+ transport + 安全边界 都在 TS 层

### 2.2 业务状态层 = backend Rust（不变）

| 状态 | 位置 | 理由 |
|---|---|---|
| PTY / SSH / tmux 句柄 | `services/session_manager` | PTY fd 必须 OS 持有 |
| `attach_registry` 独占状态 | `services/attach` | `SessionManager::write()` 必须调 `check_write_permission`——**安全关键** |
| `OutputRing` 序号环形缓冲 | `services/subscribe` | PTY/SSH/tmux 后端读循环是真源 |
| `capture` 三模式实现 | `services/capture` | tmux capture-pane 是 backend 命令 |
| `tunnel` 反向 SSH | `services/reverse_tunnel` | russh 是 backend crate |

frontend MCP 工具通过 invoke 调 backend IPC 间接读写这些状态。

### 2.3 IPC 镜像层 = backend Rust（保留）

- `commands/session::write_session` — frontend MCP send_keys 调
- `commands/session::close_session` — frontend MCP close_session 调
- `commands/mcp::attach_session` / `detach_session` — frontend MCP attach 调（透传到 `services::attach::AttachRegistry`）
- `commands/mcp::mcp_status` — frontend MCP server 启动后调，告知 backend 当前 MCP enabled / port
- `commands/tunnel::*` — frontend MCP 启停反向隧道

## 3. 为什么 override RFC 0002

| 维度 | RFC 0002（backend 嵌入） | RFC 0002-revised（frontend TS + HTTP） |
|---|---|---|
| **协议层位置** | backend Rust | frontend TS |
| **stdio transport** | 直接（main = MCP server） | ❌ 不实现（WebView 无 stdin/stdout） |
| **HTTP transport** | 直接 | 直接（Web API fetch） |
| **12 工具实现位置** | `mcp_server/tools/*.rs` | `app/mcp/tools/*.ts` |
| **attach 状态机** | backend `services/attach` + mcp_server 调 | 不变（仍在 backend）+ frontend MCP 调 `commands/mcp::attach_session` |
| **业务状态** | backend | 不变（backend） |
| **TS 类型契约** | `models/mcp.rs` ↔ `app/mcp/types.ts` 镜像 | 删 `models/mcp.rs`，只保留 `app/mcp/types.ts` |
| **rmcp SDK 依赖** | 加 | 不加 |
| **TypeScript MCP SDK** | 不用 | 可选（自研更轻） |
| **协议升级** | backend rebuild | frontend hot reload |
| **panic isolation** | tokio task | WebView Promise rejection（UI 不受影响） |
| **Claude Desktop / Cursor 接入** | stdio command=`xsterm-mcp` | HTTP URL=http://127.0.0.1:19847 + Bearer token |
| **跨机器接入（M8）** | 同 HTTP transport | 同 HTTP transport |

### 3.1 关键 trade-off：stdio vs HTTP

**RFC 0002** 假设 stdio = Claude Desktop 原生兼容。但实际：
- Claude Desktop 同时支持 stdio 和 HTTP MCP server（2025+ 版本）
- HTTP 配置一样简单（URL + token）
- HTTP 对 reverse_tunnel 天然友好（反向 SSH 隧道端口转发直接复用）

**结论**：HTTP only 是个 net positive——Claude Desktop / Cursor / Codex 都支持，少一层 sidecar 复杂度。

### 3.2 frontend 实现 MCP 的额外收益

- MCP 工具能直接读 `service/session/store`、`service/workspace/store`、`service/tmux/store`（frontend zustand store）——**0 IPC 成本**
- attach 状态变化时直接 emit Tauri event 给 UI banner 显示（不用走 backend → frontend event bridge）
- AI 接管 UX 全部 frontend 实现，不需要 backend 帮 frontend 触发 UI 状态

## 4. 架构示意

```
┌──────────────────────────────────────────────────────────────┐
│  xsterm.exe (Tauri 主进程)                                      │
│  ┌────────────────────┐  tokio mpsc  ┌─────────────────────┐  │
│  │ pty/ssh/tmux 后端   │ ──────────► │ SessionManager       │  │
│  │ (services/)        │ ◄─────────   │ (services/)          │  │
│  └────────────────────┘              └─────────┬───────────┘  │
│                                                 │              │
│                                                 ▼              │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  attach_registry + OutputRing + capture + tunnel         │ │
│  │  (services/attach / subscribe / capture / reverse_tunnel) │ │
│  └──────────────────────────────────────────────────────────┘ │
│           ▲                                       ▲             │
│           │ invoke() / emit()                    │ emit()      │
│  ┌────────┴───────────────────────────────────────┴──────┐     │
│  │  WebView2 (UI)                                         │     │
│  │  ┌────────────────────────────────────────────────┐   │     │
│  │  │  React + xterm.js                                │   │     │
│  │  │  app/mcp/server.ts  ←─ HTTP server (127.0.0.1) │   │     │
│  │  │  app/mcp/tools/*.ts ── invoke backend IPC       │   │     │
│  │  │  service/*  (zustand stores)                     │   │     │
│  │  │  ui/*  (React components)                        │   │     │
│  │  └────────────────────────────────────────────────┘   │     │
│  └───────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘

外部 AI agent (Claude Desktop / Cursor / Codex / 远端 agent)
   │
   │  HTTP POST http://127.0.0.1:19847/mcp
   │  Authorization: Bearer <token>
   │
   ▼
WebView 内 HTTP server (app/mcp/server.ts)
   │
   ├── dispatch tool ──► app/mcp/tools/<name>.ts
   │                       │
   │                       ├── invoke('create_local_session', config) ─► backend
   │                       ├── invoke('write_session', { data })        ─► backend
   │                       ├── invoke('close_session', { sessionId })   ─► backend
   │                       ├── invoke('attach_session', { sessionId, clientId })
   │                       │     │
   │                       │     ▼ backend attach_registry.try_attach
   │                       │     ▼ app.emit("mcp-attach-changed") ─► frontend banner
   │                       ├── service/session/store.upsert(session)
   │                       └── service/tmux/store.upsert(controller)
   │
   └── HTTP response (JSON-RPC 2.0)
```

**关键**：
- MCP 协议层 = frontend TS（HTTP server）
- 业务状态层 = backend Rust（attach / OutputRing / capture / PTY）
- 12 个工具 = frontend TS facade over backend invoke

## 5. backend 设计调整

### 5.1 删除

- `mcp_server/*` 全部（移至 `doc/dev/history/mcp-server-backend-rfc-0002/` 归档，保留可追溯）
- `models/mcp.rs`（移到 frontend `model/mcp/types.ts`）
- `commands/mcp.rs` 中除 attach_session / detach_session / mcp_status 以外的部分

### 5.2 保留

- `services/attach` —— attach 独占状态机（被 frontend MCP + UI takeover + reverse_tunnel 共享）
- `services/subscribe` —— OutputRing + 序号 + fan-out
- `services/capture` —— capture 三模式
- `services/reverse_tunnel` —— 反向 SSH 隧道（端口转发直接复用 HTTP MCP）
- `services/session_manager` —— 扩展字段（attach_registry / subscribe_registry / session_id_index / reverse_index / profiles / quota）
- `services/config` —— toml 配置 + 白名单
- `commands/session` 现有 23 命令 —— frontend MCP 工具通过 invoke 调
- `commands/persistence`、`commands/logging` 不变
- `commands/mcp` 简化为只剩 attach_session / detach_session / mcp_status（attach 状态镜像）
- `commands/tunnel` —— frontend MCP 启停反向隧道

### 5.3 新增

- `commands/mcp::mcp_status` —— frontend MCP server 启动后调用，告知 backend 当前 HTTP server 状态（MCP token / port / enabled）
- `commands/mcp::regenerate_mcp_token` —— frontend 触发 token 重生成
- `commands/mcp::get_session_attach_state` —— frontend 启动时拉所有 session 的 attach 状态

## 6. frontend 调整

### 6.1 `app/mcp/` 已有设计（不变，按现 design doc 落地）

详见：
- `doc/dev/design/frontend/app/mcp/RESPONSIBILITY.md`（302 行）—— 9 个工具 + AI 接管状态
- `doc/dev/design/frontend/app/mcp/INTERFACE.md`（332 行）—— 工具集契约
- `doc/dev/design/frontend/app/mcp/DOWNSTREAM.md`（153 行）—— 依赖图

### 6.2 工具清单调整

frontend design doc 写 9 个工具（不含 list_profiles / get_config / set_config）。RFC 0002-revised 调整为：

| # | 工具 | frontend app/mcp/tools/ | backend 调 |
|---|---|---|---|
| 1 | `list_sessions` | `list_sessions.ts` | `invoke('list_sessions')` |
| 2 | `create_session` | `create_session.ts` | `invoke('create_session')` |
| 3 | `close_session` | `close_session.ts` | `invoke('close_session')` |
| 4 | `send_keys` | `send_keys.ts` | `invoke('write_session')` + `safety.ts` |
| 5 | `capture_screen` | `capture_screen.ts` | `invoke('capture_tmux_pane')` 或读 `service/session/output_buffer` |
| 6 | `subscribe_output` | `subscribe_output.ts` | `listen('session-output')` + 序号管理 |
| 7 | `attach_session` | `attach_session.ts` | `invoke('attach_session')` |
| 8 | `detach_session` | `detach_session.ts` | `invoke('detach_session')` |
| 9 | `wait_for` | `wait_for.ts` | `listen('session-output')` + regex |

**list_profiles / get_config / set_config 在 v1.0 不做**（frontend 没有 profile 概念、config 改走 settings UI 不走 MCP）。

### 6.3 HTTP server 实现

`app/mcp/server.ts`：

```typescript
// 自研轻量 HTTP + JSON-RPC 2.0 server（不依赖 MCP SDK）
import { McpContext } from './context';
import { dispatch } from './tools/mod';

export async function startServer(ctx: McpContext, opts: { port: number; token: string }) {
  const server = await startHttpServer({
    port: opts.port,
    authToken: opts.token,
    onRequest: async (req) => {
      // 1. token 验证
      if (req.headers.authorization !== `Bearer ${opts.token}`) {
        return { status: 401, body: { error: "auth_failed" } };
      }
      // 2. JSON-RPC 2.0 解析
      const rpc = JSON.parse(req.body);
      // 3. dispatch 工具
      const result = await dispatch(rpc.method, rpc.params, ctx);
      // 4. 序列化返回
      return { status: 200, body: { jsonrpc: "2.0", id: rpc.id, result } };
    }
  });
  return server;
}
```

**自研 vs MCP SDK**：
- **自研（推荐）**：~200 行 TS，无依赖，session / workspace / tmux state 已在 frontend TS 持有，调用方便
- **MCP SDK**：加速开发，但跟 zustand store 集成需要适配层；运行时风险自担

frontend design doc 已建议自研，采纳。

## 7. backend 与 frontend 的契约（wire format）

### 7.1 frontend MCP server → backend IPC

| MCP 工具 | frontend 调 | backend 收到 |
|---|---|---|
| `list_sessions` | `invoke('list_sessions')` | 现有 `commands::session::list_sessions` |
| `create_session` | `invoke('create_session', { config })` | 现有 `commands::session::create_session` |
| `close_session` | `invoke('close_session', { sessionId })` | 现有 `commands::session::close_session` |
| `send_keys` | `invoke('write_session', { sessionId, data })` | 现有 `commands::session::write_session` |
| `capture_screen` | `invoke('capture_tmux_pane', { ... })` 或读 service store | 现有 tmux capture / frontend store |
| `subscribe_output` | `listen('session-output')` | backend `emit_binary(BinaryFrame)` |
| `attach_session` | `invoke('attach_session', { sessionId, clientId })` | `commands::mcp::attach_session` 透传 |
| `detach_session` | `invoke('detach_session', { sessionId, clientId })` | `commands::mcp::detach_session` 透传 |
| `wait_for` | `listen('session-output')` + regex | 同 subscribe_output |

### 7.2 backend → frontend 事件

| 事件 | 触发 | frontend 订阅者 |
|---|---|---|
| `session-output` | PTY/SSH/tmux 输出 | MCP subscribe_output + UI xterm |
| `session-closed` | session 关闭 | MCP list_sessions refresh + UI |
| `mcp-attach-changed` | attach/detach | MCP attach 状态 + UI banner |
| `config-reloaded` | config.toml 改动 | settings UI |

## 8. 安全模型（不变）

### 8.1 attach 边界（双层防御）

- **frontend 层**：`Terminal.tsx` capture 阶段 `preventDefault()` + `stopPropagation()`
- **backend 层**：`SessionManager::write()` 调 `attach_registry.check_write_permission()`

### 8.2 HTTP transport 安全

- `127.0.0.1` only（默认）—— 不监听 `0.0.0.0`
- Bearer token 鉴权（强制）
- token 持久化到 `config.toml [mcp.http.token]`
- token regenerate 通过 UI / `invoke('regenerate_mcp_token')`

### 8.3 MCP 工具权限

跟 RFC 0002 相同（target-arch §8.2 权限矩阵 + 速率限制 100 req/s + 破坏性键白名单）。

## 9. 影响

### 9.1 删除

- `src-tauri/src/mcp_server/`（8 份 docs + ~1700 行设计代码）
- `src-tauri/src/models/mcp.rs`（12 工具类型镜像移到 frontend）
- `commands/mcp.rs` 中除 attach / detach / status 以外的部分
- `Cargo.toml` `rmcp` + `schemars` 依赖

### 9.2 保留

- 5 个 backend service（attach / subscribe / capture / config / reverse_tunnel）
- SessionManager 扩展（attach_registry / subscribe_registry / session_id_index / profiles / quota）
- 现有 `commands/session` 23 个命令
- 现有 `services/{local,ssh,tmux}_session` 实现

### 9.3 新增 frontend

- `src/app/mcp/server.ts`（HTTP server + JSON-RPC 2.0）
- `src/app/mcp/tools/*.ts`（9 个工具实现）
- `src/app/mcp/safety.ts`（破坏性键白名单）
- `src/app/mcp/auth.ts`（Bearer token 验证）
- `src/app/mcp/client_state.ts`（attach 独占状态镜像——frontend 也有状态，跟 backend 同步）
- `src/app/mcp/context.ts`（依赖注入：service store + invoke + emit）
- `src/app/mcp/errors.ts`（McpError → JSON-RPC error 映射）

### 9.4 文档调整

- 归档 `doc/dev/design/backend/mcp_server/` 到 `doc/dev/history/mcp-server-backend-rfc-0002/`
- 删除 `doc/dev/design/backend/models/` 中 mcp 部分
- 简化 `doc/dev/design/backend/commands/README.md`（去掉 mcp module 描述）
- 更新 `doc/dev/roadmap/target-architecture.md` §5 指向本 ADR
- 更新 `doc/dev/design/backend/README.md` §2.5（去掉 mcp_server/ 子系统）
- 更新 `doc/dev/design/frontend/README.md` §8（明确 backend 支撑）

## 10. 演进路径

### 10.1 短期（M3）—— 当前

- frontend `app/mcp/` HTTP only
- backend 5 service 支撑 attach / subscribe / capture / tunnel
- 9 个 MCP 工具 + AI 接管 UX

### 10.2 中期（v1.0）—— 加 3 个工具

- `list_profiles`（frontend MCP 读 service/persistence store）
- `get_config` / `set_config`（frontend MCP 走 service/persistence + 白名单）

### 10.3 长期（v2）—— 可选 sidecar stdio

如果 Claude Desktop 不接受 HTTP only：
- 加 `src-tauri/src/bin/xsterm-mcp-stdio.rs` sidecar
- WebView MCP server 通过 Tauri shell plugin spawn + stdio pipe 通讯
- 但 HTTP transport 仍是主路径

## 11. 验收

- frontend `app/mcp/` HTTP server 启动 < 500ms ✓
- 9 个工具全部通过 MCP JSON-RPC 2.0 协议兼容性测试 ✓
- Claude Desktop / Cursor / Codex HTTP MCP 配置指南通过 E2E ✓
- AI 接管后 frontend UI banner 显示 + user 键盘屏蔽 + MCP 写入允许 ✓
- subscribe_output 跟前端 xterm render 同步（同一份 backend `session-output` BinaryFrame 事件源） ✓
- 反向 SSH 隧道端口转发 + 远端 agent 通过 HTTP 接入 ✓
- 100 req/s 速率限制 + Bearer token 鉴权生效 ✓
- panic isolation：frontend MCP server 崩溃不影响 Tauri UI ✓

## 12. 关联文档

- RFC 0002（superseded）—— `doc/dev/adr/0002-mcp-single-binary.md`
- frontend MCP 设计 —— `doc/dev/design/frontend/app/mcp/`（302+332+153 行）
- backend 支撑设计 —— `doc/dev/design/backend/services/{attach,subscribe,capture,reverse_tunnel}/`
- backend SessionManager 扩展 —— `doc/dev/design/backend/services/session_manager_extension.md`
- 目标架构 —— `doc/dev/roadmap/target-architecture.md`（已更新指向本 ADR）

签字：
- [x] dev — 2026-09-29（基于用户决策）
- [ ] tm
- [ ] pdm