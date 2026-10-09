# RFC 0002 (Revised-2): MCP server 放 backend services/mcp/ (HTTP + stdio 双 transport)

> **For Hermes:** 设计阶段纯文档 (doc-only),不动代码。
> **状态**: SUPERSEDES RFC 0002-revised (frontend 方案)。10-09 user 复盘: MCP 回到 backend services/ 子 module, frontend 退化为"监听 backend MCP 事件 + 实时显示 MCP 操作"。
> **时间**: 2026-10-09

## 1. 背景

RFC 0002-revised (2026-09-29, frontend 方案) 实施后发现问题:

1. **stdio 支持缺失**: WebView 无 stdin/stdout,Claude Desktop 通过 stdio 配置 MCP 走不通。
2. **frontend 责任过重**: frontend TS 既是 HTTP server 又是 12 个工具实现,既有 UI 又有协议层,代码膨胀+ 调试复杂。
3. **调试链路过长**: MCP tool → frontend HTTP server → frontend IPC → backend → backend service,4 跳。每跳都需独立追踪,前端 dev console 与后端 tracing 互相对不齐。
4. **attach banner / 实时显示需求未变**: frontend 仍需看到 MCP 操作 (哪个 agent 接管了哪个 session / 写入什么 key / subscribe 什么 output),但**只需要 listen 不需要 serve**。

user (2026-10-09) 决策: **MCP server 坐回 backend,frontend 只监听事件 + 显示**。

## 2. 决策

**MVP: MCP server 作为 backend `services/mcp/` 子 module,与 `attach_registry` / `subscribe_registry` 同级;支持 HTTP + stdio 双 transport。frontend `app/mcp/` 退化为"`mcp_status_listener.ts` + UI banner + MCP 事件订阅"。**

## 3. 架构变化对比

| 维度 | RFC 0002-revised (frontend) | RFC 0002-revised-2 (本方案) |
|---|---|---|
| 协议层位置 | frontend TS (`app/mcp/`) | **backend Rust (`services/mcp/`)** |
| HTTP transport | frontend HTTP server | backend HTTP server (127.0.0.1:19847) |
| stdio transport | ❌ 不实现 (WebView 无 stdin/stdout) | ✅ sidecar subprocess 跑 stdio → IPC 转发到本机 HTTP |
| 12 工具实现位置 | `app/mcp/tools/*.ts` (frontend TS) | `services/mcp/tools/*.rs` (backend Rust) |
| 业务状态 (attach / OutputRing) | backend | 不变 (backend) |
| frontend MCP 工具 facade | 真实工具实现 | ❌ 删除 (backend 已实现) |
| frontend 角色 | **协议层 + UI 显式** | **仅 UI 显式 (监听 backend MCP 事件)** |
| backend ↔ MCP client 桥 | frontend HTTP server in WebView | backend HTTP server (tokio) + 可选 stdio sidecar |

## 4. backend `services/mcp/` 子 module 设计

```\nsrc-tauri/src/services/mcp/\n├── mod.rs                 ⭐ 入口 + transport 选择\n├── http.rs               ⭐ HTTP server (127.0.0.1:19847 + Bearer token)\n├── stdio.rs              ⭐ stdio transport (spawn xstdiod-sidecar.exe\n│                          转发 stdin/stdout ↔ HTTP 本机端口)\n├── tools/                ⭐ 12 个 MCP 工具实现\n│   ├── mod.rs            tools registry\n│   ├── list_sessions.rs\n│   ├── close_session.rs\n│   ├── send_keys.rs\n│   ├── capture_screen.rs (text/ansi/screenshot 3 mode)\n│   ├── subscribe_output.rs\n│   ├── attach_session.rs\n│   ├── detach_session.rs\n│   ├── wait_for.rs\n│   ├── list_attached_sessions.rs\n│   ├── list_profiles.rs   (RFC 1.1)\n│   ├── get_config.rs      (RFC 1.1)\n│   └── get_session_attach_state.rs\n├── auth.rs               ⭐ Bearer token 验证 + 速率限制 (rate_limit 100/s)\n├── safety.rs             ⭐ 破坏性快捷键白名单 (Ctrl+C / Ctrl+D / Ctrl+Z / Ctrl+Break)\n├── audit.rs              ⭐ AuditLog (复用 services/audit 框架)\n├── types.rs              ⭐ MCP wire types (req/resp/error 与 SDK 对齐)\n├── events.rs             ⭐ emit `mcp-tool-called` / `mcp-tool-returned`\n│                          / `mcp-attach-changed` 给 frontend listen\n└── service_init.rs       (ReqContext 注入 attach / subscribe / capture)\n```

### 4.1 与现有 service 的关系

- `services/mcp` → `services/registry/attach_registry` (调 `try_attach` / `detach` / `check_write_permission`)
- `services/mcp` → `services/registry/session_manager` (调 `create_local` / `write` / `close`)
- `services/mcp` → `services/registry/subscribe_registry` (调 `get_or_create` OutputRing + 序号管理)
- `services/mcp` → `services/capture` (text / ansi / tmux 路由)
- `services/mcp` → `services/audit` (复用 AuditLog 框架)

### 4.2 transport 选择

启动序列 (`lib.rs::run()::setup`):

```\nlet mcp_port = services::mcp::http::start(state, app.handle(), settings.mcp.http)?;\nif settings.mcp.stdio.enabled {\n    services::mcp::stdio::spawn_sidecar(state, mcp_port)?;  // spawn xstdiod-sidecar.exe\n}\n```

- `xstdiod-sidecar.exe` 是 backend 编译产物 (Rust binary,独立 main),负责 `stdin.readline()` → POST `/mcp/stdin-bridge` (本机 127.0.0.1:19847) → HTTP 响应 → `stdout.writeline()`。
- 一个 stdio client 一个 sidecar (避免多客户端 stdin 复用)。

### 4.3 IPC 命令暴露

`commands/mcp.rs` (已 6 commands) 扩到 10 commands:

```\n[existing]\nattach_session / detach_session / get_session_attach_state\nlist_attached_sessions / mcp_status / regenerate_mcp_token\n[new, MCP transport 控制]\nmcp_http_start / mcp_http_stop / mcp_stdio_start / mcp_stdio_stop\n```

## 5. frontend `app/mcp/` 退化

frontend **不再**有 server.ts / tools 12 实现。新的 `app/mcp/` 只剩:

```\nsrc/app/mcp/\n├── index.ts                    barrel re-export\n├── api.ts                      ⭐ 唯一对外入口 (listen 事件 + 调 IPC)\n├── listener.ts                 ⭐ listen('mcp-tool-called' / 'mcp-tool-returned' / 'mcp-attach-changed')\n├── banner.ts                   UI banner "🤖 AI 接管中" 状态机 (from listener.ts)\n├── ui/                         React 组件\n│   ├── McpStatusPanel.tsx      显示 MCP server 状态 / tool 调用日志\n│   └── McpAttachBanner.tsx     attach 状态 banner\n└── *.test.ts                   vitest: 监听事件 + UI 状态转换测试\n```

frontend 不再具备 HTTP server / 12 工具实现 / JSON-RPC 2.0 解析。

## 6. wire 契约变化

### 6.1 backend emit → frontend listen (新增)

| 事件名 | payload 类型 | 何时 emit |
|---|---|---|
| `mcp-tool-called` | `{ tool, params, clientId, requestId }` | MCP client 调用 tool 入口 |
| `mcp-tool-returned` | `{ tool, result, error?, latencyMs, requestId }` | MCP client 调用 tool 返回 |
| `mcp-attach-changed` | `{ sessionId, clientId, action: 'attach'/'detach'/'force_detach' }` | attach 状态变化 (attach_registry 直接 emit, 已有) |
| `mcp-server-status` | `{ httpRunning, stdioRunning, activeStdioClients, port }` | MCP HTTP / stdio server 启停 |

(保留已有事件 `mcp-attach-changed` / `config-reloaded` / `tunnel-status-changed`)

### 6.2 frontend → backend IPC

不变:`invoke('attach_session')` / `invoke('detach_session')` / `invoke('mcp_status')` / `invoke('regenerate_mcp_token')` 等 6 个 commands/mcp IPC。

新增:`invoke('mcp_http_start')` / `mcp_http_stop` / `mcp_stdio_start` / `mcp_stdio_stop` (由 ui/settings 抽屉触发)。

## 7. 安全模型 (与 RFC 0002-revised 同)

- HTTP: 127.0.0.1 only, Bearer token (强制), token 持久化 settings.json
- stdio sidecar: localhost IPC, 不暴露网络
- 速率限制: 100/s per tool
- attach 双层防御: frontend keydown capture + backend `check_write_permission`

## 8. 影响清单

### 8.1 删除 / 退化

| 项 | 动作 |
|---|---|
| `doc/dev/design/frontend/app/mcp/server.ts` 设计 | ❌ 删除 (backend 已实现) |
| `doc/dev/design/frontend/app/mcp/tools/*.ts` 设计 | ❌ 删除 (12 tools 在 backend `services/mcp/tools/`) |
| `doc/dev/design/frontend/app/mcp/transport/http.ts` | ❌ 删除 |
| `doc/dev/design/frontend/app/mcp/safety.ts` | ❌ 删除 (backend `services/mcp/safety.rs`) |
| `doc/dev/design/frontend/app/mcp/client_state.ts` | ❌ 删除 (backend attach_registry 是真源) |
| `doc/dev/adr/0002-revised-mcp-frontend.md` | 移到 `doc/dev/history/mcp-server-frontend-rfc-0002-revised/` |
| `doc/dev/history/mcp-server-backend-rfc-0002/` (RFC 0002 原版) | 保留可追溯 |

### 8.2 新增

| 项 | 位置 |
|---|---|
| `doc/dev/adr/0002-revised-2-mcp-services-module.md` | 本 ADR |
| `doc/dev/design/backend/services/mcp/{RESPONSIBILITY,INTERFACE,DOWNSTREAM}.md` | 3 份契约 docs |
| `doc/dev/design/backend/commands/mcp/{INTERFACE}.md` 增 4 commands | MCP transport 控制 |
| `doc/dev/design/frontend/app/mcp/{RESPONSIBILITY,INTERFACE,DOWNSTREAM}.md` 重写 | listener + banner only |
| `doc/dev/design/backend/README.md` §4.x 更新 | 写新 mcp section |
| `doc/dev/design/frontend/README.md` §4.1 更新 | 写新 frontend 角色 |
| `doc/dev/design/backend/services/mcp/http.rs`, `stdio.rs`, `tools/`, `auth.rs`, `safety.rs`, `audit.rs`, `types.rs`, `events.rs` 设计 docs | 详见 §4 |

### 8.3 11 个 commits 需 revert

每个 commit 的"v2 路径" → "v3 路径"映射:

```
ca89efd [v2_revertised] ai_takeover.md 8 处 integration/mcp → services/mcp + commands/mcp
935689e [v2_revertised] attach_registry/DOWNSTREAM self-ref services/attach/ → services/registry/attach_registry (KEEP 不动)
ba71295 [v2_revertised] §5.1 IPC count (KEEP, 与 MCP 无关)
cfc9709 [v2_revertised] §13 doc-count math + models plan (KEEP, 与 MCP 无关)
63a89a7 [v2_revertised] M9 + M10 行 (KEEP)
429f2a3 [v2_revertised] services/capture/README.md (KEEP)
f2c9574 [v2_revertised] frontend §2.3 + §2.4 domain (KEEP)
a1908da [v2_revertised] attach_registry/INTERFACE mcp_server → app/mcp → services/mcp/tools
4c9a9e8 [v2_revertised] ui/ DOWNSTREAM shared/ → model/cross-cutting/ (KEEP)
84a739a [v2_revertised] attach_registry/DOWNSTREAM mcp_server → app/mcp → services/mcp/tools
```

**真正需 re-revert 的 commit**: ca89efd / a1908da / 84a739a (3 个直接反转);其余 8 个 KEEP (与 MCP 位置无关)。

## 9. ADR 时间线 (记录反复)

| 时间 | 决策 | ADR | 状态 |
|---|---|---|---|
| 2026-09-15 | MCP 嵌入 backend 单 binary | 0002-mcp-single-binary.md | superseded |
| 2026-09-29 | MCP 移到 frontend TS (stdio 不要) | 0002-revised-mcp-frontend.md | **superseded by 0002-revised-2** |
| 2026-10-09 | MCP 回到 backend services/mcp/ (HTTP + stdio 都要) | **0002-revised-2-mcp-services-module.md (本 ADR)** | current |

教训: MCP server 是 protocol-layer + transport-layer 的混合,frontend TS / backend Rust 各有得失。
- frontend: WebView 内 fetch 实现简单,但 stdio 无解
- backend: HTTP + stdio 都行,但调试需 backend tracing + frontend 监听双栈

下次选型先问: "stdio 是否是 P0 必选?" 若 yes → backend;若 no → frontend。

## 10. 后续 (出本 ADR 范围)

1. `services/mcp/` 实际代码实现 (本 ADR 仅设计,不写代码)
2. `xstdiod-sidecar.exe` 单独 crate 拆分 (vs in-binary tokio task)
3. frontend McpStatusPanel / McpAttachBanner 组件实现
4. PRD §2 M6 / acceptance F 行更新 (stdio 必选)