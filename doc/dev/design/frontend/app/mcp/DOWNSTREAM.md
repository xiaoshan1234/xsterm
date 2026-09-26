# Module · App MCP — 对下依赖

> **位置**：`src/app/modules/mcp/`

## 1. 依赖图

```typescript
app/mcp/
├── server.ts               ────►  node:child_process (stdio transport); net (TCP listener)
├── server.ts               ────►  @tauri-apps/api/event (emit Tauri events)
├── tools/list_sessions.ts  ────►  service/session/store (读 session metadata)
├── tools/create_session.ts ────►  invoke('create_session') → commands/session/api
├── tools/close_session.ts  ────►  invoke('close_session') → commands/session/api
├── tools/send_keys.ts      ────►  app/mcp/safety::isDestructiveCombo + invoke('write_session')
├── tools/capture_screen.ts ────►  service/session/store (output_buffer) + invoke('capture_tmux_pane') for tmux
├── tools/subscribe_output.ts ► invoke('get_session_output_channel') + service/eventBus
├── tools/attach_session.ts ────►  app/mcp/client_state::tryAttach + emit 'mcp-attach-changed'
├── tools/detach_session.ts ────►  app/mcp/client_state::detach
├── tools/wait_for.ts       ────►  service/session/output_buffer + regex 匹配
├── auth.ts                 ────►  (pure function) token 验证
├── safety.ts               ────►  (pure function) 破坏性快捷键白名单
├── client_state.ts         ────►  Map<string, AttachEntry> (独占状态)
├── errors.ts               ────►  custom Error class
└── *.test.ts               ────►  MCP JSON-RPC 协议兼容性测试
```

## 2. 外部模块 / IPC 依赖

| module | 用途 |
|---|---|
| `service/session` | 读 session metadata（list / output_buffer）；调 `service/eventBus` 订阅 output channel |
| `service/tmux` | 读 tmux controller 镜像（attach_session / detach_session UI 状态） |
| `@tauri-apps/api/core` | `invoke()` 调 backend IPC（write_session / create_session / close_session / capture_tmux_pane 等） |
| `@tauri-apps/api/event` | `listen()` 接收 backend 推过来的 session-output 事件 |
| `@tauri-apps/api/event` | `emit()` 通知 frontend UI（attach-changed 触发 banner） |
| `node:child_process` | stdio transport 启动子进程（如果选 MCP SDK 子进程模式） |
| `node:net` | TCP transport 监听 127.0.0.1 |

## 3. 跟 backend module 的依赖

| module | 怎么用 |
|---|---|
| `commands/session` | 工具 `create_session` / `close_session` / `send_keys` 调 `invoke('create_session', ...)` / `invoke('close_session', ...)` / `invoke('write_session', ...)` |
| `commands/terminal` | 工具 `capture_screen` 对 tmux session 调 `invoke('capture_tmux_pane', ...)` |
| `commands/shell` | 不直接调，但需要 `commands/shell::emit "mcp-attach-changed"` 事件协议 |
| `infra/tauri/mcp_transport.rs` (未来) | 如果 MCP server 跑独立进程，backend 提供 stdio transport adapter；MVP 不需要 |
| `domain::session` | 不直接调 domain —— 通过 backend IPC 桥接 |
| `domain::terminal` | 不直接调 —— 通过 backend IPC 桥接 |

**关键**：
- MCP **不**直接 import backend domain——所有 backend 调用都通过 `invoke()`
- MCP **不**绕过 `service/session` store 直读 session state
- MCP server panic isolation 由 frontend try/catch + 重连机制承担（Node EventEmitter）

## 4. 跨层依赖规则

- ❌ `app/mcp/` → `domain::*` (backend Rust 模块)——MCP 在 frontend，不应触碰 backend domain
- ❌ `app/mcp/` → `service/*` 内部 helper（必须经过 `service/<domain>/api.ts` 边界）
- ❌ `app/mcp/` → `ui/*` 组件（必须经过 app/ui api 边界）
- ✅ `app/mcp/` → `service/*` 公开 api（service/session, service/tmux 等）
- ✅ `app/mcp/` → `@tauri-apps/api`（调用 backend IPC）

## 5. 内部依赖关系

```typescript
app/mcp/
├── server.ts       ← 持有 McpServer 实例 + 启动 stdio/TCP listener
├── client_state.ts ← McpAttachState 状态机（自包含）
├── safety.ts       ← pure function（自包含）
├── auth.ts         ← pure function（自包含）
├── tools/          ← 每个 tool 持有 service/api + invoke 调用
├── errors.ts       ← 被 server/tools 共享
└── types.ts        ← 被 tools 共享
```

**关键约束**：
- `tools/` 互相**不**依赖——每个 tool 是独立 MCP `@tool` 函数
- `client_state.ts` / `safety.ts` / `auth.ts` 是 leaf 模块——不被 server/tools 反向依赖
- `server.ts` 是 orchestrator——组装所有 pieces

## 6. 设计意图：MCP 是 facade，不是独立业务

反模式：
- MCP 直接 import `commands::*::create_local_session` 的内部 `#[tauri::command]` handler —— 跳过 pure function 层
- MCP 自己持有 session 注册表 —— 跟 `domain::session::SessionManager` 重复
- MCP 内部维护 attach 状态但不让 frontend 感知 —— UI banner 无法显示

边界：
- MCP 是**纯 facade**——所有底层操作委托给 `commands/<module>/api::*` + `domain::*`
- MCP 唯一新增状态：`McpAttachState`（attach 独占）—— 因为这是 MCP 独有的语义（PRD M7）
- MCP 通过 emit 事件让 frontend 感知 attach 状态变化——保持单向数据流

## 7. 强制约束（可机械校验）

```bash
# app/mcp 不依赖 backend domain
grep -rn 'from "@tauri-apps/api' src/app/modules/mcp/ | grep -v '@tauri-apps/api/core\|@tauri-apps/api/event'
# 必须为空（只允许 core/event 用于 IPC）

# MCP tools 不直读 TmuxController 字段（bug 0009 防御）
grep -rnE 'tmuxControllers\.(get|iter).*\.(paneBindings|windowBindings|initialState|dispatchTask)' src/app/modules/mcp/
# 必须为空

# MCP tools 不直调 backend IPC handler 内部（必须走 invoke 公开接口）
grep -rnE 'tauri::command|executeCommand' src/app/modules/mcp/
# 必须为空

# MCP 不写 attached_tmux.json（attached_tmux 归 backend domain/terminal）
grep -rn 'saveAttachedTmux\|attached_tmux\.json' src/app/modules/mcp/
# 必须为空
```

## 8. 测试

每个文件都有 `*.test.ts`：

- `server.ts::start` 集成测试（spawn child_process,stdin 喂 MCP JSON-RPC 协议字节,stdout 验证响应）
- `tools/list_sessions` 单测（mock service/session store）
- `tools/send_keys` 单测（破坏性快捷键白名单 + bytes 合并）
- `tools/capture_screen` 单测（text/ansi 模式剥离 + tmux 路由）
- `tools/wait_for` 单测（正则 + 超时）
- `client_state.ts::tryAttach` 并发测试（多 client 竞争）
- `safety.ts::isDestructiveCombo` 边界测试（白名单 vs 拒绝）
- `auth.ts::verifyToken` 单测（TCP 鉴权）

**为什么 MCP 测试最重要**：
- MCP 是 AI agent 的入口——协议兼容性 bug = 整个产品差异化失效
- 工具集 9 个，每个都要独立测
- MCP JSON-RPC 协议兼容性测试——锁 MCP 协议 1.x,CI 跑兼容性测试

## 9. 依赖变更流程

1. **新增 MCP 工具** → 加 `tools/<name>.ts` + `@tool` 装饰器 + INTERFACE.md §3 一节 + `types.ts` 加返回类型 + 测试
2. **修改工具签名** → ⚠️ breaking 协议变更——同步更新 INTERFACE.md §3 + 测试 + 通知 client
3. **删除工具** → 从 `tools/<name>.ts` 删除 + INTERFACE.md 删除对应一节 + ⚠️ breaking 协议变更
4. **新增 transport**（如 Unix socket）→ 加 `server.ts` 内部 helper + settings 选项 + 测试
5. **升级 MCP 协议版本** → ⚠️ 跑兼容性测试 + INTERFACE.md 同步

## 10. 安全警告

- **stdin/stdout 不隔离 sandbox**——任何能注入 stdin 的进程都可能调用 MCP 工具。建议生产环境加 stdio 输入来源校验（settings 选项）。
- **TCP 鉴权必须 127.0.0.1 + token**——禁止监听 `0.0.0.0` 或省略 token
- **send_keys 破坏性快捷键默认拒绝**——白名单之外都拒
- **AI attach 独占**——MCP 工具 set `attached_by_mcp` 后，user 键盘被屏蔽——detach_session / 释放口令 / UI 按钮三选一才能解除
- **panic isolation**——MCP server panic 不影响 UI,但 panic 信息要 redact（不能泄露 ssh password 等敏感字段）

## 11. 不允许的依赖

- ❌ `app/mcp/` → `domain::*` (backend Rust 模块)——MCP 在 frontend,所有 backend 调用走 `invoke()`
- ❌ `app/mcp/` → `service/*` 内部 helper（必须经过 `service/<domain>/api.ts` 边界）
- ❌ `app/mcp/` → `ui/*` 组件（必须经过 app/ui api 边界）
- ❌ `app/mcp/` → backend `commands/<module>` 内部 IPC handler（必须通过 `invoke()`）
- ❌ `app/mcp/` → 直接写 `attached_tmux.json`（归 backend domain/terminal）
- ❌ `app/mcp/` → backend `domain::terminal::TmuxController` 字段直读（bug 0009 防御）
