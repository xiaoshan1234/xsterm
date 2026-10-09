# Services · MCP — 对下依赖

> **位置**: `src-tauri/src/services/mcp/`
> **状态**: ⭐ NEW (RFC 0002-revised-2)

## 1. 依赖图

```
services/mcp/
├── crates
│   ├── tokio (async runtime + process::Command spawn + Http listener)
│   ├── axum (HTTP routing)
│   ├── rmcp (MCP protocol SDK, RFC 0002-revised-2 重新启用)
│   ├── schemars (tool input_schema 派生, RFC 0002-revised-2 重新启用)
│   ├── serde (JSON derive)
│   ├── serde_json
│   ├── dashmap (rate_limit per-tool counter)
│   ├── uuid (MCP requestId / clientId)
│   └── regex (wait_for 正则)
├── tauri (AppHandle + Emitter)
├── services/registry/attach_registry (try_attach / detach / check_write_permission)
├── services/registry/session_manager (create_local / write / close / mcp_session_id 双向映射)
├── services/registry/subscribe_registry (get_or_create OutputRing + 序号管理)
├── services/capture/{ansi,tmux} (screen capture 路由)
├── services/audit (AuditLog 真源复用)
└── services/transport/tunnel (reverse_tunnel — 端口转发到本机 MCP HTTP)
```

## 2. 被调方 (上游)

| caller | 调用方式 | 用途 |
|---|---|---|
| `lib.rs::setup()` | `services::mcp::http::start(state, app, cfg)` | 启动 HTTP server |
| `lib.rs::setup()` | `services::mcp::stdio::spawn_sidecar(state, port)` | spawn stdio sidecar |
| `commands/mcp::attach_session` | `services::mcp.dispatch` 内 dispatch 到 `tools/attach_session.rs` | frontend UI takeover |
| `commands/mcp::detach_session` | dispatch 到 `tools/detach_session.rs` | frontend 释放按钮 |
| `commands/mcp::get_session_attach_state` | dispatch 到 `tools/get_session_attach_state.rs` | 读 attach 状态 |
| `commands/mcp::list_attached_sessions` | dispatch 到 `tools/list_attached_sessions.rs` | 列 attach 列表 |
| `commands/mcp::mcp_status` | 读 `mcp.http` / `mcp.stdio` config | UI 显示 server 状态 |
| `commands/mcp::regenerate_mcp_token` | `services::mcp::auth::regenerate_token()` | 重新生成 Bearer token |
| `commands/mcp::mcp_http_start/stop` | `services::mcp::http::start/stop()` | UI 控制 HTTP server |
| `commands/mcp::mcp_stdio_start/stop` | `services::mcp::stdio::spawn_sidecar/kill()` | UI 控制 stdio |
| `commands/tunnel::tunnel_start` | 启动 tunnel 时自动 enable stdio bridge | reverse_tunnel + stdio 协同 |
| `app/mcp/listener.ts` (frontend) | `listen('mcp-tool-*' / 'mcp-attach-changed' / 'mcp-server-status')` | UI 实时显示 MCP 操作 |

## 3. emit 事件 (下游 frontend listen)

| 事件名 | payload | frontend listener | UI 组件 |
|---|---|---|---|
| `mcp-tool-called` | `{ tool, params, clientId, requestId }` | `app/mcp/listener.ts` | `McpStatusPanel` (tool 入口日志) |
| `mcp-tool-returned` | `{ tool, result?, error?, latencyMs, requestId }` | `app/mcp/listener.ts` | `McpStatusPanel` (tool 返回 + 耗时) |
| `mcp-server-status` | `{ httpRunning, stdioRunning, activeStdioClients, port }` | `app/mcp/listener.ts` | `McpStatusPanel` (server 启停状态) |
| `mcp-attach-changed` | `{ sessionId, clientId, action }` | `app/mcp/listener.ts` | `McpAttachBanner` (attach 状态) |

## 4. 配置

`settings.json` mcp section:

```json
{
  "mcp": {
    "http": {
      "enabled": true,
      "port": 19847,
      "bindAddress": "127.0.0.1",
      "token": "<bearer-token-uuid>"
    },
    "stdio": {
      "enabled": false,
      "sidecarPath": "xstdiod-sidecar.exe"
    },
    "rateLimitPerTool": 100,
    "destructiveKeys": {
      "policy": "whitelist",
      "allowed": ["Ctrl+C", "Ctrl+D", "Ctrl+Z", "Ctrl+Break"]
    },
    "idleTimeoutSeconds": 300
  }
}
```

## 5. 启动序列 (lib.rs::run()::setup)

```rust
// 1. logging setup (already done)
// 2. ConfigStore load (already done)
// 3. OutputChannel register (already done)
// 4. reverse_tunnel start_if_enabled (already done)
// 5. ⭐ services/mcp start (NEW position, RFC 0002-revised-2)
let mcp_port = services::mcp::http::start(state.clone(), app.handle().clone(), cfg.mcp.http.clone()).await?;
if cfg.mcp.stdio.enabled {
    services::mcp::stdio::spawn_sidecar(state.clone(), mcp_port)?;
}
```

## 6. 强约束 (pre-commit 必跑)

```bash
# 1. services/mcp 不能 import commands
grep -rn 'use\s\+crate::commands' src-tauri/src/services/mcp/
# 必须为空

# 2. services/mcp 不能直连 infrastructure/pty/ssh/tmux (穿 session_manager)
grep -rnE 'use\s\+crate::infrastructure::(pty|ssh|tmux)' src-tauri/src/services/mcp/
# 必须为空

# 3. services/mcp 不能直读 SessionManager 字段 (用公开 API)
grep -rnE 'session_manager\.(sessions|tmux_controllers|attach_state|output_rings)\.(get|iter)' src-tauri/src/services/mcp/
# 必须为空

# 4. services/mcp 不能直读 attach_registry.inner (用公开 API)
grep -rnE 'attach_registry\.(inner|attach_states)' src-tauri/src/services/mcp/
# 必须为空

# 5. ❌ frontend app/mcp/ 不再是 MCP server (RFC 0002-revised-2)
find src/app/mcp/ -name 'server.ts' -o -name 'tools.ts' -o -name 'transport.ts'
# 必须为空

# 6. ❌ frontend app/mcp/ 不能 import rmcp SDK (RFC 0002-revised-2)
grep -rnE '@modelcontextprotocol/sdk' src/app/mcp/
# 必须为空

# 7. emit 事件必须在 services/mcp/ 内 (避免散落)
grep -rnE 'app\.emit\("(mcp-tool|mcp-server-status)' src-tauri/src/
# 必须只在 services/mcp/{events.rs,stdio.rs,http.rs,tools/*.rs} 出现

# 8. ❌ stdio sidecar 不能 spawn 同一个 binary 多次 (1 client 1 sidecar)
# cargo 单元测试覆盖
```

## 7. 不允许的依赖

- ❌ `services/mcp` → `services/capture/transport.rs` (旧 RFC 1923,已被 RFC 0006 下沉到 models/capture)
- ❌ `services/mcp` → `commands/*` (services 不能反向依赖 commands)
- ❌ `services/mcp` → `infrastructure/pty / ssh / tmux` 直接 (穿过 session_manager)
- ❌ `services/mcp` → `models::session` 直读元数据 (用 SessionInfo 公开字段)
- ❌ `services/mcp` → frontend 代码 (services 是纯 Rust)
- ❌ `services/mcp::tools/*` → `services/mcp::http.rs` / `stdio.rs` 直调 (走 dispatch)

## 8. 生命周期

```
lib.rs::run() -> setup():
  services::mcp::http::start() -> tokio HTTP listener (长跑 task)
  services::mcp::stdio::spawn_sidecar() -> tokio::process::Child (1 client 1 process)

服务运行时 (per MCP client request):
  1. HTTP/stdio 接 request
  2. token verify
  3. rate_limit check
  4. JSON-RPC parse
  5. dispatch 到 tools/<name>.rs
  6. emit "mcp-tool-called" 给 frontend
  7. tools/<name> 调 attach_registry / session_manager / etc.
  8. tools/<name> 返回 result
  9. emit "mcp-tool-returned" 给 frontend
  10. 返 response 给 client

shutdown:
  services::mcp::http::stop() -> abort HTTP listener
  services/mcp::stdio::kill_all() -> kill 所有 sidecar child
```

## 9. 依赖变更流程

新增 1 个 MCP tool:
1. `services/mcp/tools/<name>.rs` (impl handle fn + per_tool/: types.rs)
2. `services/mcp/tools/mod.rs::tool_registry` 注册
3. `services/mcp/INTERFACE.md` 加 tool schema
4. `services/mcp/RESPONSIBILITY.md` §3 工具列表 + 1
5. `commands/mcp.rs` 不需要新 IPC (走 dispatch)
6. `app/mcp/listener.ts` 自动看到新 tool (emit mcp-tool-called/returned)
7. `doc/dev/design/frontend/app/mcp/INTERFACE.md` 加 schema 给 AI agent prompt

删除 1 个 MCP tool:
1. 上述反向