# Services · MCP — 职责

> **位置**: `src-tauri/src/services/mcp/`
> **状态**: ⭐ NEW (RFC 0002-revised-2, 2026-10-09; supersede RFC 0002-revised frontend 方案)
> **RFC**: [`doc/dev/adr/0002-revised-2-mcp-services-module.md`](../../../adr/0002-revised-2-mcp-services-module.md)
> **职责**: MCP server (协议层 + transport + 12 工具) 在 backend 实现; frontend `app/mcp/` 退化为 listener

## 1. 这个 module 负责什么

承载 MCP (Model Context Protocol) server 的 backend 实现,提供:

1. **HTTP transport**: tokio HTTP listener @ `127.0.0.1:19847` + Bearer token 鉴权
2. **stdio transport**: spawn `xstdiod-sidecar.exe` 子进程转发 stdin/stdout ↔ 本机 HTTP 端口
3. **12 个 MCP 工具**: list_sessions / close_session / send_keys / capture_screen (text/ansi/screenshot 3 模式) / subscribe_output / attach_session / detach_session / wait_for / list_attached_sessions / list_profiles / get_config / get_session_attach_state
4. **auth + safety + rate_limit + audit**: Bearer token 验证 / 破坏性快捷键白名单 (Ctrl+C/D/Z/Break) / 100/s per tool 限速 / AuditLog 复用 services/audit
6. **emit MCP 事件给 frontend**: `mcp-tool-called` / `mcp-tool-returned` / `mcp-server-status` (frontend `app/mcp/listener.ts` listen 做 UI 实时显示)

## 2. 与其他 module 的关系

```
依赖 (调入):
├── services/registry/attach_registry (try_attach / detach / check_write_permission)
├── services/registry/session_manager (create_local / write / close / mcp_session_id 双向映射)
├── services/registry/subscribe_registry (get_or_create OutputRing + 序号管理)
├── services/capture/{ansi,tmux} (screen capture 路由)
├── services/audit (AuditLog 真源复用)
└── services/transport/tunnel (reverse_tunnel — 端口转发到本机 MCP HTTP)

被调 (调出):
├── commands/mcp::attach_session / detach_session / get_session_attach_state
│   / list_attached_sessions / mcp_status / regenerate_mcp_token (6 个透传 IPC)
├── commands/mcp::mcp_http_start / mcp_http_stop / mcp_stdio_start / mcp_stdio_stop
│   (4 个 transport 控制 IPC, RFC 0002-revised-2 新增)
├── commands/tunnel::* (启动 tunnel 时自动 enable stdio bridge)
└── app/mcp/listener.ts (frontend) — listen('mcp-attach-changed' / 'mcp-tool-*' / 'mcp-server-status')
```

## 3. 内部结构

```
src-tauri/src/services/mcp/
├── mod.rs                 ⭐ 入口 + transport 选择 + 启动序列
├── http.rs                ⭐ tokio HTTP server (127.0.0.1:19847 + Bearer token + axum)
├── stdio.rs               ⭐ stdio transport (spawn xstdiod-sidecar.exe)
├── auth.rs                ⭐ Bearer token 验证 + 速率限制 (100/s per tool, DashMap<tool, AtomicU32>)
├── safety.rs               ⭐ 破坏性快捷键白名单 (Ctrl+C/D/Z/Break)
├── audit.rs               ⭐ AuditLog 复用 (调 services/audit)
├── types.rs               ⭐ MCP wire types (req/resp/error, 与 rmcp SDK 对齐)
├── events.rs              ⭐ emit mcp-tool-called / mcp-tool-returned / mcp-server-status
├── service_init.rs        ⭐ 注入 attach_registry / session_manager / subscribe_registry
│                          / capture / audit 依赖 (McpContext struct)
└── tools/                 ⭐ 12 个 MCP 工具实现
    ├── mod.rs             tools registry (HashMap<String, McpTool>)
    ├── list_sessions.rs   -> session_manager.list_all()
    ├── close_session.rs   -> session_manager.close()
    ├── send_keys.rs       -> session_manager.write() + attach check + safety check
    ├── capture_screen.rs  -> services/capture/{ansi,tmux}.capture()
    ├── subscribe_output.rs -> subscribe_registry.subscribe()
    ├── attach_session.rs  -> attach_registry.try_attach(AttachSource::Mcp)
    ├── detach_session.rs  -> attach_registry.detach()
    ├── wait_for.rs        -> OutputRing 阻塞 + regex 匹配
    ├── list_attached_sessions.rs -> attach_registry.list_attached()
    ├── list_profiles.rs   -> session_manager.list_profiles() (v1.1)
    ├── get_config.rs      -> services/persistence/store.read() (v1.1)
    └── get_session_attach_state.rs -> attach_registry.get_state()
```

## 4. 职责边界

### 4.1 这个 module 做

- 接受 MCP client (HTTP 或 stdio) 请求
- 解析 JSON-RPC 2.0
- 调 attach_registry / session_manager / subscribe_registry / capture / audit / tunnel 等 backend service
- 速率限制 + Bearer token 验证 + 破坏性快捷键拦截
- emit `mcp-tool-called` / `mcp-tool-returned` / `mcp-server-status` 给 frontend listen

### 4.2 这个 module 不做

- ❌ UI 渲染 (frontend `app/mcp/ui/McpStatusPanel.tsx` / `McpAttachBanner.tsx`)
- ❌ frontend zustand store 管理
- ❌ Tauri IPC 处理 (`commands/mcp.rs` 是 IPC handler)
- ❌ stdio 物理实现 (`xstdiod-sidecar.exe` 是独立 cargo binary, 本 module 只 spawn)

## 5. 禁止事项

- ❌ 直读 `session_manager.sessions` / `tmux_controllers` 等私有字段 (用公开 API)
- ❌ 直读 `attach_registry.inner` (走 `try_attach` / `detach` / `check_write_permission`)
- ❌ 调 `commands/*` (services 不能反向依赖 commands)
- ❌ 直连 PTY/SSH/tmux (`infrastructure/pty` / `ssh` / `tmux` — 穿过 session_manager)
- ❌ 跳过 attach 检查直接 `write` (破坏 attach 状态机)
- ❌ 跳过 safety 检查直接 send 破坏性键 (Ctrl+C/D/Z/Break 默认允许, 其他需 settings 配置)
- ❌ 不加 Bearer token 鉴权 (除 localhost stdio bridge)
- ❌ 监听 `0.0.0.0` (只 127.0.0.1)

## 6. 与 frontend 关系

backend `services/mcp/` 是 MCP 协议层 + transport + 工具实现。
frontend `app/mcp/listener.ts` 仅 listen 3 类事件做 UI 实时显示:

- `listen('mcp-attach-changed')` → attach banner (来自 attach_registry 直接 emit, 本 module 透传)
- `listen('mcp-tool-called')` → McpStatusPanel 显示 tool 入口 (来自本 module events.rs)
- `listen('mcp-tool-returned')` → McpStatusPanel 显示 tool 返回 + 耗时
- `listen('mcp-server-status')` → McpStatusPanel 显示 HTTP/stdio 启停状态

frontend 不发起任何 MCP tool 调用 (那是 AI agent 的工作)。frontend 仅 UI 观察。

详见:
- [`INTERFACE.md`](INTERFACE.md) — 公开 API + 类型 + 函数签名
- [`DOWNSTREAM.md`](DOWNSTREAM.md) — 依赖图 + 强约束 grep