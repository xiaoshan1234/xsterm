# doc/dev/design/ · 总体架构（前后端贯通）

> **For Hermes:** 设计阶段纯文档 (doc-only), 不动代码。
> **受众**: dev (改任一半前先读这个)、tm (验收)、pdm (理解能力映射)
> **关系**:
> - **本文件** = 跨进程视角 (cross-cutting)。描述前后端**怎么对话**: IPC 契约、wire format、event 流、attach / MCP / session-output / reverse_tunnel 端到端机制。
> -  [`backend/README.md`](backend/README.md) = backend 单边 4 层细节 (`commands/ services/ infrastructure/ models/`)
> -  [`frontend/README.md`](frontend/README.md) = frontend 单边 5 层细节 (`app/ ui/ model/ service/ infra/`)
> -  [`doc/dev/architecture/`](../../architecture/README.md) = 4+1 视图 (logical/process/dev/physical/scenarios), 跟代码快照对齐
> -  本文件**不**复制两侧 README 的层细节, 只在需要端到端时才引用

---

## 0. 一句话架构

```
xsterm = Tauri 2 WebView (frontend TS/React, 5 层) + 原生 binary (backend Rust, 4 层)
         两边通过 2 类 wire 对话:
           (a) invoke('command', args) → Result<T, String>   (frontend→backend 请求/响应, 单跳)
           (b) listen('event', handler)   ← Unlisten           (backend→frontend 推流, 单源多订阅)
```

**为什么这样切**:
- 前端需要快速 UI 迭代 + 复杂业务编排 (5 层划分) → TS/React 优势
- 后端需要稳定状态机 + 系统资源持有 (PTY/SSH/tmux/process/binary protocol) → Rust 优势
- 跨进程边界 = Tauri IPC (typed invoke + emit/listen), 不引入 HTTP/gRPC 额外复杂度

---

## 1. 两个半边的对照表

| 维度 | backend (Rust) | frontend (TS) | 边界 |
|---|---|---|---|
| **顶层目录** | `src-tauri/src/` | `src/` | (跨进程) |
| **分层数** | 4 层 | 5 层 | 两侧各自分层, 通过 IPC 互通 |
| **业务编排** | `commands/<m>.rs` (按 frontend app module 镜像切) | `app/<m>/usecases/` | 一一对应 (命令名 ↔ usecase 名) |
| **业务状态** | `services/registry/{session,attach,subscribe,profile,mcp}_manager.rs` (DashMap 真源) | `service/<domain>/store.ts` (zustand, 仅 UI 渲染) | backend 真源, frontend 镜像 |
| **纯数据契约** | `models/<domain>.rs` (serde 派生) | `model/<domain>/types.ts` (TS interface) | serde 镜像 |
| **平台抽象** | `infrastructure/{pty,ssh,tmux,session_backend,app_backend,clipboard,logging_setup}.rs` | `infra/{tauri,store,clipboard,logger}/` | backend 持有 OS 句柄, frontend 持有 WebView API |
| **UI 渲染** | (无) | `ui/<m>/view/*.tsx` + xterm.js + React 19 | (无) |
| **运行时** | tokio runtime + Tauri main | Tauri WebView (chromium 内核) | 1 个 process, 2 个 runtime |

**关键不变量**:
- backend `services/registry/*` 是**业务状态真源** (session 列表 / attach 状态 / OutputRing / profile)
- frontend `service/<domain>/store.ts` 是**仅 UI 渲染用镜像**, 与 backend 状态必须通过 Tauri events 同步 (`mcp-attach-changed` / `session-output` / `session-closed` / `config-reloaded` / `tunnel-status-changed` / `mcp-tool-*` / `mcp-server-status`)
- frontend **不能**直读 backend 内部字段 (e.g. 不能 `session_manager.sessions.get(...)`), 必须通过 `invoke()` 公开 IPC + `listen()` 事件

---

## 2. 跨进程 wire 契约

### 2.1 frontend→backend: Tauri invoke 单跳

```typescript
// frontend
import { invoke } from "@tauri-apps/api/core";
const sessions = await invoke<SessionInfo[]>("list_sessions");
```
```rust
// backend
#[tauri::command]
pub async fn list_sessions(state: State<'_, Arc<SessionManager>>) -> Result<Vec<SessionInfo>, String> {
    state.list_all().map_err(|e| e.to_string())
}
```

- 入参 / 返回类型**严格对应** (serde 派生 + TS interface)
- 错误统一 `Result<T, String>` (Tauri IPC 强制)
- 命名风格: `<verb>_<noun>` (e.g. `create_local_session`, `attach_session`, `capture_text`)
- 详见 [backend/README §6 跨语言 wire 契约](backend/README.md#6-跨语言-wire-契约) + [frontend/README §6.3 关键 IPC 契约](frontend/README.md#63-关键-ipc-契约重点)

### 2.2 backend→frontend: Tauri event 推流

```rust
// backend
app.emit("session-output", BinaryFrame { magic: 0xA1, version: 0x01, session_id, len, data });
```
```typescript
// frontend
import { listen } from "@tauri-apps/api/event";
const unlisten = await listen<Uint8Array>("session-output", (e) => { /* parse BinaryFrame */ });
```

- 事件名**前后端必须一致** (kebab-case, 全小写)
- payload 类型镜像 backend 序列化结果
- 详见 §6 事件名总表

### 2.3 binary session-output wire format

BinaryFrame 是 session-output 的特殊高效编码 (避免每次 emit 都 JSON 序列化):

```
[A1] [01] [session_id BE 4B] [payload_len BE 4B] [payload bytes]
```

- `magic = 0xA1` (frontend 严格校验, 错误抛错)
- `version = 0x01` (协议版本; 未来 v2 加字段向后兼容)
- `session_id` big-endian u32 (4 bytes)
- `payload_len` big-endian u32 (4 bytes)
- `payload` 任意字节 (PTY 输出原始 UTF-8)

详见 [backend `infrastructure/binary_frame.rs`](backend/infrastructure/) + [frontend `hooks/sessionOutputFrame.ts`](frontend/) — **前后端必须完全同步**, 改一边必同步另一边。

---

## 3. 端到端机制 (跨进程的子系统)

### 3.1 Session 生命周期 (M1-M2: 标签页 + 5 种环境)

```
ui/workspace: 用户点 "+"
    ↓
ui/session: shell.openDialog({ kind: "createSession", payload: {...} })
    ↓
app/session/usecases/createLocal.ts (frontend 业务编排)
    ↓
service/session/createLocal(config)
    ↓ invoke('create_local_session', config) — IPC #1
backend commands/session::create_local_session (4-layer boundary, 不持状态)
    ↓ 调
services::registry::session_manager::create_local(config, backend)
    ↓
   a. SessionIdSource::allocate() → u32 session_id
   b. mcp_session_id 生成 ("tab-7f3a9b") + session_id_index 注册 (RFC 0002-revised-2)
   c. subscribe_registry::get_or_create(session_id) → OutputRing
   d. lifecycle::local::create(&config, ring.clone()) → PTY handle
      └─ infrastructure::pty::NativePtySystem.open()
   e. backend.spawn(read_loop: ring.push(bytes) + emit_binary(BinaryFrame))
    ↓
return SessionInfo { id, name, session_type, capabilities, attached: None, mcp_session_id }
    ↓ IPC #1 返回
service/session/store.upsert(SessionInfo)       // zustand 真源
app/session/usecases/openInWorkspace(sessionId, configId, workspaceId)
    ↓
app/workspace::openSession(sessionId, configId, workspaceId) → service/workspace/store 更新 pane 树
    ↓
ui/workspace: re-render → pane 显示 terminal (xterm.js)
```

**关键观察**:
- backend `commands/session` **不持有状态**, 状态全在 `services/registry/session_manager`
- frontend `service/session/store` 是 zustand mirror, 真源仍是 backend
- session 创建**只 1 次 IPC 单跳** (frontend → backend, 同步返回), 后续 PTY 输出走 `session-output` BinaryFrame 推流

### 3.2 Session 输出推流 (data plane, 后台持续)

```
backend PTY read_loop (长跑 tokio task):
  bytes = pty.read()  →  ring.push(bytes)  →  app.emit("session-output", BinaryFrame{...})
                                                                   ↓
                                  frontend service/session/bridge (startup 时 listen 1 次)
                                                                   ↓
                                       BinaryFrame parse → (sessionId, seq, bytes, ts)
                                                                   ↓
                                       3 个订阅者共享同一份事件:
                                       (1) ui/terminal/Terminal.tsx xterm.js render
                                       (2) app/mcp/listener.ts → MCP 操作日志 (RFC 0002-revised-2)
                                       (3) ui/session/* 状态镜像
```

**关键观察**:
- 数据源是 backend `services/output/ring.rs` (环形缓冲 + 序号); frontend `service/session/bridge` 是解析层
- **同一份 BinaryFrame 事件被多个 frontend 订阅者共享**, 不重复 IPC
- backend OutputRing 是 MCP `subscribe_output` 工具的真源 — frontend 通过 listen 拿到同一份数据, 不再走 IPC

### 3.3 MCP server (M6, M7, M8 — RFC 0002-revised-2)

```
AI agent (Claude Desktop / Cursor / 自研)
  → stdin: JSON-RPC 2.0 请求 (stdio transport)
  或 → HTTP POST http://127.0.0.1:19847/mcp + Bearer token (HTTP transport)

backend services/mcp/http.rs    ─┐
        或                       ├─→  token verify (services/mcp/auth.rs)
backend services/mcp/stdio.rs   ─┘           ↓
                                  rate_limit check (100/s per tool)
                                          ↓
                                  JSON-RPC parse (services/mcp/types.rs + rmcp SDK)
                                          ↓
                                  dispatch → services/mcp/tools/<name>.rs (12 工具)
                                          ↓
                                  调 services/registry/{attach,session_manager,subscribe}_registry / services/capture / services/audit
                                          ↓
                                  return result
                                          ↓
                                  emit "mcp-tool-called" + "mcp-tool-returned" 给 frontend
                                                                  ↓
                                                  frontend app/mcp/listener.ts
                                                                  ↓
                                                  store.addToolCall / completeToolCall
                                                                  ↓
                                                  zustand re-render → ui/mcp/McpStatusPanel.tsx
```

**frontend 退化原因 (RFC 0002-revised-2 supersede RFC 0002-revised)**:
- WebView 无 stdin/stdout, Claude Desktop stdio 配置走不通
- 调试链路: client → backend tokio → attach_registry (2 跳) vs 原 frontend 方案 (4 跳)
- 业务状态 (attach / OutputRing / capture / tunnel) 已在 backend; MCP server 也放 backend 避免跨进程状态同步

详见:
- [`backend/services/mcp/{R,I,D}.md`](backend/services/mcp/) — backend MCP server 完整契约
- [`frontend/app/mcp/{R,I,D}.md`](frontend/app/mcp/) — frontend listener only (退化)
- [`doc/dev/adr/0002-revised-2-mcp-services-module.md`](../../adr/0002-revised-2-mcp-services-module.md) — 决策记录

### 3.4 AI 接管 / attach 状态机 (M7)

```
ui/session: 用户点 "🤖 AI 接管" 按钮
    ↓
app/session/usecases/ai_takeover/attach.ts
    ↓ invoke('attach_session', { sessionId, clientId: "ui-takeover" })
backend commands/mcp::attach_session  (4-layer boundary)
    ↓ 调
services::registry::attach_registry::try_attach(session_id, AttachSource::Ui { client_id })
    ↓
   (1) check 互斥 (DashMap CAS): 已 attach by 不同 client → 拒绝
   (2) insert AttachState { sessionId, clientId, attachedAt, source }
   (3) emit "mcp-attach-changed" { sessionId, clientId, action: "attach" }
       ↓
       frontend app/mcp/listener.ts → store.setAttachBanner(sessionId, ...)
       ↓
       zustand re-render → ui/session/* + ui/workspace/PaneHeader 显示 🤖 标识
       ↓
       ui/terminal/Terminal.tsx: useEffect 订阅 attachState
         → attached → keydown capture 阶段 preventDefault() + stopPropagation()
         → user 键盘输入被前端屏蔽 (immediate UI response, 不等 backend 往返)
       ↓
   return AttachState
    ↓ IPC 返回
ui/session: 渲染 banner "🤖 AI Agent 接管中 (ui-takeover)"
```

**关键**: 双层防御
- **前端层**: Terminal.tsx `keydown` capture 阶段 `preventDefault()` (immediate, 不等 IPC)
- **后端层**: `session_manager.write()` 内调 `attach_registry.check_write_permission(session_id, caller_client_id)`, 未授权拒绝 write

详见:
- [`backend/services/registry/attach_registry/{R,I,D}.md`](backend/services/registry/attach_registry/)
- [`frontend/app/session/ai_takeover.md`](frontend/app/session/ai_takeover.md)

### 3.5 反向 SSH 隧道 (M8)

```
config.json [tunnel] enabled = true
    ↓
backend services::transport::tunnel::start_if_enabled(state) (lib.rs setup 时调一次)
    ↓
   spawn russh client 连 ssh.example.com
    ↓
   open forward channel (-R remote_port:127.0.0.1:local_mcp_port)
    ↓
AI agent 在 remote 通过 ssh.example.com:remote_port 连入
    ↓ TCP → forward
reverse_tunnel 检测新连接 → forward bytes → local 127.0.0.1:19847
    ↓
backend services/mcp/http.rs 收到请求 (复用 §3.3 全部链路)
    ↓
emit "tunnel-status-changed" → frontend ui/tunnel/* 显示状态
```

**关键**:
- 远端 agent 通过反向 SSH 隧道连到本机 backend tokio HTTP server, 复用同一份 12 个工具 + Bearer token
- 连接断开 → russh reconnect 指数退避 (1/2/4/8/16s × 5 次)
- frontend `ui/tunnel/*` 通过 `listen('tunnel-status-changed')` 显示连接状态 + 自动重连 toast

---

## 4. 启动序列 (端到端)

```
lib.rs::run() (backend main)
    ↓
tauri::Builder::default()
    ├── plugin(tauri_plugin_opener)
    ├── plugin(tauri_plugin_store)
    ├── plugin(tauri_plugin_clipboard_manager)
    ├── manage(Arc<SessionManager>)               // core registry
    ├── apps::manage(...)
    ├── setup(|app| {
    │       1. logging setup
    │       2. ⭐ services/persistence::store::ConfigStore::load
    │       3. ⭐ OutputChannel register (RealAppBackend)
    │       4. ⭐ reverse_tunnel::start_if_enabled
    │       5. ⭐ services/mcp::http::start (RFC 0002-revised-2, new)
    │       6. ⭐ services/mcp::stdio::spawn_sidecar (RFC 0002-revised-2, new, 可选)
    │   })
    ├── invoke_handler(commands::all_handlers())  // 注册全部 71 个 IPC 命令
    └── run(generate_context!())

WebView 内 frontend (main.tsx → App.tsx → AppLayout)
    ↓
useShellApi().initialize()
    ↓
   1. invoke('shell_initialize_logging')           // backend logging
   2. listen('session-output', handler)            // backend BinaryFrame 推流
   3. listen('session-closed', handler)
   4. ⭐ app/mcp/listener.ts::startListening(ctx)   // listen mcp-attach-changed + mcp-tool-* + mcp-server-status
   5. ⭐ app/session/bridge.setupSessionOutputListener()
   6. ⭐ app/workspace/loadLastWorkspace()
   7. ⭐ app/settings/load()
   8. ⭐ app/terminal/autoAttachTmuxServers()
   9. readiness.setReady(true)
```

**关键观察**:
- backend 启动 5 步 (4 个已有 + 2 个 RFC 0002-revised-2 新增 MCP server 步骤)
- frontend 启动 9 步 (8 个 listen/load + 1 个 readiness)
- **WebView ready (frontend step 9) 之前, backend 已经能接受 MCP client 连接** — AI agent 可在 frontend UI 完全显示前就开始接管 session

---

## 5. 关键依赖方向 (跨进程)

```
[frontend TS]                          [backend Rust]
    ↓ invoke() (request/response)
commands/<module>                     ──→   frontend 业务编排
    ↓
services/<lifecycle/registry/...>     ──→   backend 业务编排 (持有真源状态)
    ↓
infrastructure/<pty/ssh/tmux/...>     ──→   backend 平台抽象
    ↓
models/<domain>                       ──→   backend 纯数据契约

[backend Rust]                        [frontend TS]
    ↓ emit() / app.emit() (event push)
listen('event-name', cb)              ←──   frontend 事件订阅 (mirror 渲染)
    ↓
service/<domain>/store               ←──   zustand mirror (UI 渲染)
```

**禁止**:
- ❌ frontend 直跳 backend Rust module (`import src-tauri`)
- ❌ frontend 直读 backend `session_manager` / `attach_registry` 内部字段
- ❌ backend 反向依赖 frontend (services 不能 import commands/mcp/etc)
- ❌ models 依赖业务 crate (models 只用 serde)

详见 [backend/README §3 依赖方向](backend/README.md#3-依赖方向) + [frontend/README §3 依赖方向](frontend/README.md#3-依赖方向)

---

## 6. 跨进程事件名总表 (frontend listen 入口)

所有事件名 **frontend 必须 listen, backend 必须 emit**, 命名一致 (kebab-case)。

| 事件名 | 方向 | payload 类型 | 何时 | 用途 |
|---|---|---|---|---|
| `session-output` | backend → frontend | `Vec<u8>` (BinaryFrame `[0xA1][0x01][sid BE 4B][len BE 4B][data]`) | PTY/SSH/tmux 有新输出 | UI xterm render + MCP subscribe_output (RFC 0002-revised-2) |
| `session-output-channel` | backend → frontend | `Channel<Vec<u8>>` | setup 1 次 | frontend 拿订阅 channel |
| `session-closed` | backend → frontend | `u32` (session_id) | session 关闭 | UI cleanup + MCP subscribe cleanup |
| `tmux-events` | backend → frontend | `TmuxEvent` 枚举 | tmux 控制模式事件 | ui/terminal/* tmux UI 更新 |
| `mcp-attach-changed` | backend → frontend | `{ sessionId, clientId, action }` | attach 状态变化 | attach banner + UI takeover 镜像 |
| `mcp-tool-called` | backend → frontend | `{ tool, params, clientId, requestId, timestamp }` | MCP client 调用 tool 入口 | UI McpStatusPanel tool 日志 (RFC 0002-revised-2) |
| `mcp-tool-returned` | backend → frontend | `{ tool, result?, error?, latencyMs, requestId, timestamp }` | MCP client 调用 tool 返回 | UI McpStatusPanel tool 完成 (RFC 0002-revised-2) |
| `mcp-server-status` | backend → frontend | `{ httpRunning, stdioRunning, activeStdioClients, port, timestamp }` | MCP HTTP/stdio 启停 | UI McpStatusPanel server 卡片 (RFC 0002-revised-2) |
| `config-reloaded` | backend → frontend | `Settings` | settings.json 写后 / 启动加载 | frontend zustand store 同步 |
| `system-theme-changed` | backend → frontend | `String` | OS 主题切换 | UI 主题切换 |
| `tunnel-status-changed` | backend → frontend | `TunnelStatus` | 反向隧道连接状态变化 | UI tunnel status toast |

**frontend→backend 事件**: 无 (frontend 不 emit 给 backend; frontend 通过 invoke 单向调用)。

详见:
- [backend/README §6 跨语言 wire 契约 (Rust 事件名)](backend/README.md#6-跨语言-wire-契约)
- [frontend/README §6.2 Rust 事件名 (backend emit → frontend listen)](frontend/README.md#62-rust-事件名backend-emit--frontend-listen)

---

## 7. IPC 命令总表 (frontend invoke 入口)

所有 IPC 命令 **frontend 可 invoke, backend 命令注册**, 类型严格镜像。

按 frontend app module 镜像切 9 个 backend commands/ 子 module:

| backend commands/ | frontend app/ | IPC 命令数 (实证) | 关键命令 |
|---|---|---|---|
| `session.rs` | `app/session` | 15 | create_local_session / create_ssh_session / create_tmux_session / write_session / close_session / capture_text / capture_ansi / capture_screenshot |
| `workspace.rs` | `app/workspace` | 13 | create_workspace / load_workspace / save_workspace / create_group / delete_group / move_config_to_group |
| `terminal.rs` | `app/terminal` | 4 | resize_terminal / set_theme / get_terminal_capabilities |
| `tmux.rs` | `app/terminal` | 13 | create_tmux_pane / kill_tmux_pane / capture_tmux_pane / attach_tmux_session / auto_attach_tmux_servers |
| `settings.rs` | `app/settings` | 3 | load_settings / save_settings / patch_settings |
| `mcp.rs` | `app/mcp` | 10 | attach_session / detach_session / get_session_attach_state / list_attached_sessions / mcp_status / regenerate_mcp_token + mcp_http_start / mcp_http_stop / mcp_stdio_start / mcp_stdio_stop (RFC 0002-revised-2 新增) |
| `persistence.rs` | `service/persistence` | 9 | save_sessions / load_sessions / save_groups / load_groups / save_attached_tmux_servers / load_attached_tmux_servers / + settings (3) |
| `tunnel.rs` | `app/mcp` (stdio bridge) | 4 | tunnel_start / tunnel_stop / tunnel_status / generate_tunnel_script |
| `logging.rs` | `infra/logger` | 4 | log_message / get_log_config / set_log_config / get_log_dir |

**总计**: 75 个 IPC 命令实证注册 (vs §1 README 中声称的 "71" 已修正; 详见 [backend/README §5.1 命令数 table](backend/README.md#51-commands-子模块9-module45-ipc-命令))

每个 IPC 命令的入参 / 返回类型镜像 backend `#[tauri::command]` 签名, 详见 [backend/commands/<m>/INTERFACE.md](backend/commands/) 各 module 的契约 docs。

---

## 8. 持久化分布

| 持久化对象 | backend | frontend | 同步 |
|---|---|---|---|
| `settings.json` (应用配置) | `commands/persistence::save/load/patch_settings` + `services/persistence/store.rs` (tauri-plugin-store) | ❌ 不直读, 通过 `invoke('load_settings')` | `listen('config-reloaded')` |
| `sessions.json` (saved profiles) | `commands/persistence::save/load_sessions` + `services/persistence/store.rs` | ❌ 不直读 | ❌ 无显式 event (reload 走 init 时拉) |
| `groups.json` (saved groups) | 同上 | ❌ 不直读 | 同上 |
| `attached_tmux.json` (auto-attach 列表) | 同上 | ❌ 不直读 | 同上 |
| `log_config.json` (日志配置) | `services/io/log.rs` | ❌ 不直读 | ❌ |
| `*` (rolling log files) | `infrastructure/logging_setup.rs` + `services/io/log.rs` | ❌ 不读 | ❌ |

**关键约束 (RFC 0003-revised supersede PRD §2 M9 原文 TOML+watch)**:
- settings 直存 tauri-plugin-store, 每个字段 `#[serde(default)]`
- ❌ 不再有 `services/config/` 模块 (RFC 0006 下沉)
- ❌ 不再有 `commands/config.rs` (设置读写由 `commands/persistence.rs` 扩展承载)
- frontend 是 settings.json 唯一写入入口 (UI 层是受信的)

---

## 9. 安全模型 (跨进程)

### 9.1 attach 双层防御

| 层 | 文件 | 机制 | 延迟 |
|---|---|---|---|
| 前端层 | `ui/terminal/Terminal.tsx` | `useEffect` 订阅 `attachState` → attached 时 `keydown` capture `preventDefault()` | immediate (不等 IPC) |
| 后端层 | `services/registry/session_manager::write` | 调 `attach_registry::check_write_permission(session_id, caller_client_id)` | 1 次 IPC |

### 9.2 MCP transport 安全

| transport | 鉴权 | 监听范围 |
|---|---|---|
| HTTP | Bearer token (强制) | `127.0.0.1:19847` only |
| stdio | localhost IPC (无需 Bearer) | 1 个 client 1 个 `xstdiod-sidecar.exe` |
| 速率限制 | 100/s per tool | `settings.mcp.rateLimitPerTool` |
| 破坏性快捷键 | 白名单 (Ctrl+C / Ctrl+D / Ctrl+Z / Ctrl+Break) | `settings.mcp.destructiveKeys.policy` |

### 9.3 Tauri capabilities

详见 [src-tauri/capabilities/default.json](../../../../src-tauri/capabilities/default.json) (frontend 唯一声明):
- `core:default` (基础 invoke/listen)
- `opener:default` (外部 URL 打开)
- `store:default` (settings.json 直存)
- `clipboard-manager:default` + `clipboard-manager:allow-read-image` (剪贴板读写)
- window 控制: `minimize` / `maximize` / `unmaximize` / `close` / `is-maximized` / `start-dragging`

**新增 IPC 命令必须检查 capabilities 是否覆盖** (frontend 调用会被 Tauri runtime 拒绝)。

---

## 10. 性能预算 (跨进程)

| 路径 | 预算 | 实现 |
|---|---|---|
| `invoke()` 单跳 | < 5ms | Tauri IPC 单跳 |
| `listen()` 事件分发 | < 10ms | Tauri event bus |
| zustand store re-render | < 16ms | 60fps 渲染不丢帧 |
| xterm.js render 100 行 | < 20ms | virtualized render |
| `create_local_session` 启动到返回 | < 200ms | ~150ms 实证 |
| `write_session` 延迟 | < 10ms | Perf 004 |
| `session-output` 事件推送 | < 20ms | Perf 001 |
| backend MCP HTTP server start | < 200ms | tokio listener @ 127.0.0.1:19847 |
| MCP HTTP tool call 延迟 | < 5ms | in-process (无 IPC 跳转) |
| MCP stdio sidecar spawn | < 100ms | `tokio::process::Command::spawn` |
| 100 sessions × 10k 行 OutputRing | ≤ 200MB | OutputRing 100k 行上限 |
| 反向隧道重连 | ≤ 5 次指数退避 | 1/2/4/8/16s |

详见 [backend/README §10 性能预算](backend/README.md#10-性能预算) + [frontend/README §9 性能预算](frontend/README.md#9-性能预算)

---

## 11. 测试策略 (跨进程)

| 层 | 工具 | 覆盖目标 |
|---|---|---|
| **backend models** | cargo test | serde roundtrip + JsonSchema |
| **backend services/registry/** | cargo test + mockall | session_manager / attach_registry / subscribe_registry |
| **backend services/output/** | cargo test | OutputRing 满 + seq 连续 + 多 subscriber |
| **backend services/capture/** | cargo test | text/ansi 模式剥离 + tmux 路由 |
| **backend services/persistence/** | cargo test + tempfile | JSON roundtrip + migration |
| **backend services/mcp/** | cargo test + mockall + tokio_test | 12 工具 + JSON-RPC + auth + safety + stdio sidecar (RFC 0002-revised-2) |
| **backend services/transport/tunnel/** | 集成测试 (需 sshd) | 5 次重连 + token 鉴权 |
| **backend commands/** | cargo test (mock state) | 每个 IPC 命令 happy + error 分支 |
| **backend infrastructure/** | cargo test | pty open + ssh 连接 + binary_frame roundtrip |
| **frontend app/mcp/** (RFC 0002-revised-2) | vitest | listener 4 类事件 + zustand store 状态转换 |
| **frontend app/session/** | vitest | attach banner 状态机 + release 口令检测 |
| **frontend app/terminal/** | vitest | xterm render + tmux UI |
| **集成 (end-to-end)** | Python MCP SDK + Claude Desktop 配置模拟 | HTTP round-trip + stdio via sidecar + AI 接管 UX |
| **TUI 兼容** | vttest | ≥ 90% |

---

## 12. 跟 PRD 对应

| PRD § | 含义 | 跨进程实现 |
|---|---|---|
| **M1** 标签页 + 分屏 | workspace / window / pane CRUD | frontend 持有 workspace 状态 (真源) + backend `commands/workspace` 镜像持久化 |
| **M2** 5 种环境 | local / SSH / tmux | backend `commands/session::create_*_session` + `services/lifecycle/{local,ssh,tmux}` |
| **M3** TUI 完整档 | 24-bit / mouse / paste / kitty / unicode / OSC | frontend xterm.js + backend `services/output/ring.rs` binary_frame 推流 |
| **M4** 复制粘贴 | clipboard | frontend `ui/terminal/*` + backend `infrastructure/clipboard.rs` |
| **M5** 快捷键 + 用户覆盖 | keymap | frontend `app/terminal/keymap` + settings.json |
| **M6** MCP server | AI agent 接入 | backend `services/mcp/` (HTTP + stdio 双 transport, RFC 0002-revised-2) + frontend `app/mcp/listener.ts` |
| **M7** 本地 AI 一键接管 | attach 状态机 | backend `services/registry/attach_registry` + frontend `app/session/usecases/ai_takeover/` |
| **M8** 远程 SSH agent | reverse_tunnel | backend `services/transport/tunnel.rs` + `commands/tunnel.rs` (端口转发到本地 127.0.0.1:19847) |
| **M9** 配置 | settings.json 直存 (supersede PRD 原文 TOML+watch) | backend `commands/persistence::save/load/patch_settings` + frontend `app/settings/` |
| **M10** Microsoft Store 上架 | MSIX / EV 证书 / Store UX | frontend + 平台商店通道; backend 无依赖 |
| **M11** 自动更新 | (未来) | frontend + 平台商店通道 |

---

## 13. 文档地图

```
doc/dev/design/
├── _OVERVIEW.md                      ← 本文件 (跨进程视角, 唯一权威)
├── backend/
│   ├── README.md                     ← backend 4 层细节
│   ├── commands/  9 × {R,I,D}.md     ← IPC 命令契约
│   ├── services/   17 × R/I/D        ← 业务编排
│   ├── infrastructure/ 7 × R/I/D      ← 平台抽象
│   └── models/   (RFC 0007 plan)
└── frontend/
    ├── README.md                     ← frontend 5 层细节
    ├── app/  6 × R/I/D + ai_takeover.md
    ├── ui/   5 × R/I/D
    ├── model/  5 × R/I/D
    ├── service/ 5 × R/I/D
    └── infra/  4 × R/I/D

doc/dev/architecture/                  ← 4+1 视图 (按系统视角, 跟代码快照对齐)
├── README.md
├── 01-logical-view.md
├── 02-process-view.md
├── 03-development-view.md
├── 04-physical-view.md
├── 05-scenarios.md
└── 06-tmux-runtime-architecture.md

doc/dev/adr/                           ← 关键决策记录
├── 0001-keep-tmux-cc.md
├── 0002-mcp-single-binary.md         (superseded)
├── 0002-revised-2-mcp-services-module.md  ← 当前 MCP 决策 (2026-10-09)
├── 0003-revised-config-json.md
├── 0004-product-naming.md
├── 0005-tmux-redesign-v0.md
├── 0006-services-simplification.md
├── 0007-backend-module-restructure.md
└── 0009-tmux-control-window.md

doc/dev/history/                       ← 历史归档 (保留可追溯)
├── mcp-server-backend-rfc-0002/      (RFC 0002 原版)
└── mcp-server-frontend-rfc-0002-revised/  (RFC 0002-revised superseded)
```

---

## 14. 验收 checklist (跨进程视角)

✅ 后端 4 层 + 前端 5 层 + 跨进程 IPC + event 双流
✅ RFC 0002-revised-2: MCP server 在 backend `services/mcp/` (HTTP + stdio 双 transport), frontend 仅 listener
✅ 12 个 MCP 工具 backend Rust 实现
✅ attach 状态机 (双层防御: 前端 keydown capture + 后端 check_write_permission)
✅ reverse_tunnel 端口转发到本地 backend MCP HTTP
✅ session-output BinaryFrame 前后端 wire 同步
✅ settings.json 直存 (RFC 0003-revised, supersede PRD TOML+watch)
✅ Microsoft Store 上架 (M10) 落到 frontend + Store 通道, backend 无依赖

---

## 15. 不在 MVP 范围 (跨进程视角)

- macOS / Linux 移植 — `infrastructure/*` 已抽象, frontend 通过 Tauri 跨平台 (理论可移植)
- 主题商店 / 跨设备同步 — v1.1 / v2
- 会话录像回放 — v1.1 (`services/io/log.rs` 雏形)
- MCP stdio transport **已经在 RFC 0002-revised-2 实现** (不是 v2 工作)
- WebAssembly 插件 — v2 (`services/plugin/` 待加)
- MCP list_profiles / get_config / set_config — v1.0 (services/mcp/tools 已设计, 实施优先级)
- 协议升级 MCP 2.0 — 未来 (rmcp SDK 待跟进)

---

## 16. 演进路径

### 16.1 MCP 升级路径

1. ✅ 当前: HTTP + stdio 双 transport (RFC 0002-revised-2)
2. 拆 crates: `services/audit/` + `services/mcp/` + `services/output/ring.rs` 可独立 crate (独立编译 + 独立单测)
3. 拆 MCP SDK: 当前用 `rmcp` + `schemars` (RFC 0002-revised-2 重新启用), 自研不必要
5. 协议升级 MCP 2.0 — 跟 rmcp SDK 跟进, frontend listener 端兼容

### 16.2 frontend ↔ backend 性能优化

1. 未来大流量场景: BinaryFrame 改用 `Arc<Vec<u8>>` 共享内存, 避免序列化/反序列化 (Tauri 2 支持 `Channel<Vec<u8>>` 流式订阅)
2. 大 session 数: OutputRing 100k 行上限 (当前), 超过时走 capture_screen 主动拉取
3. 远程 agent 反向隧道: 端口压缩 / 连接复用 (后续 HTTP/2 MCP)