# Frontend · 顶层架构（唯一权威 README）

> **位置**：`src/` 下的 5 个并列顶层目录
> **关注点**：5 层架构（app / ui / model / service / infra）
> **目标平台**：Tauri 2 + WebView2 + React 19 + TypeScript 5.8 + Vite 7
> **MCP server 位置**（RFC 0002-revised）：frontend `app/mcp/`（协议层）+ backend `services/{attach, subscribe, capture, tunnel}`（业务状态层）

> **文档策略**：本文档是 frontend 唯一权威 README。各 module 的 RESPONSIBILITY / INTERFACE / DOWNSTREAM 独立保留。子层 README 已合并到本文档。

## 1. 一句话架构

**frontend = 5 个正交关注点（按职责切分）**

```
src/
├── app/             业务编排（5+1 module 按产品功能切分）
├── ui/              视图渲染（5 module 按产品功能切分）
├── model/           数据 + 算法（5 + 1 = 6 domain）
├── service/         运行时状态 + IPC 桥（6 domain）
└── infra/           物理适配（唯一允许直跳 @tauri-apps/api）
```

**frontend ↔ backend 对应**：

| frontend 层 | backend 对应 | 边界 |
|---|---|---|
| `app/<module>/` | `commands/<module>` | IPC 入参 / 返回类型必须一致 |
| `service/<domain>/` | `services/<domain>` | zustand store 镜像 backend 状态（不直接读） |
| `infra/tauri/commands/*` | `commands/*` | 一对一 IPC 函数 |
| `infra/tauri/events/*` | backend `app.emit("...")` | 事件名 + payload 类型一致 |
| `model/<domain>/types.ts` | `models/<domain>.rs` | TS interface = Rust struct（serde 派生） |

## 2. 各层职责

### 2.1 `app/` — 业务编排（6 module）

**6 module 按产品功能切分**（跟 ui 5 module 一一对应 + 独立 mcp module）：

| module | 职责 | 文档 |
|---|---|---|
| `shell` | app 启动序列 + 关闭序列 | RESPONSIBILITY + INTERFACE + DOWNSTREAM |
| `workspace` | 主视图业务（workspace + window + pane + group） | 3 docs |
| `terminal` | tmux + terminal preferences | 3 docs |
| `session` | session 全生命周期业务 | 3 docs + ai_takeover.md |
| `settings` | 设置持久化 + 跨 module 应用 | 3 docs |
| `mcp` | ⭐ AI agent 接入（RFC 0002-revised：MCP 协议层） | 3 docs |

**依赖规则**：
- `shell` → 任何 module（启动编排）
- `workspace` → `terminal`（tmux split）+ `session`（session 装到 pane）
- `terminal` → `session`（读 session 元数据）
- `session` → 任何（核心）
- `settings` → 任何（横切）
- `mcp` → `service/session` + `service/tmux` + `commands/*`（facade over invoke）

**每个 module 内部结构**：
```
modules/<name>/
├── api.ts            ⭐ 唯一对外入口（其他 module 只能 import 这个）
├── usecases/         业务编排（每个 useCase 一个文件 + .test.ts）
│   ├── <domain>/     按子域分子目录
│   └── composition/  跨 module 协调的 useCase
├── ipc.ts            module 专用的 IPC 命令封装（如有）
├── model.ts          module 专属类型（如果需要）
├── index.ts          barrel：只 re-export api.ts
└── *.test.ts
```

**强制规则**：
- `index.ts` 只 export `api.ts`
- 其他 module `import { X } from "@/app/modules/<name>/api"`
- **禁止** import `usecases/*` / `ipc.ts` / `model.ts` 内部文件

### 2.2 `ui/` — 视图渲染（5 module）

**5 module 按产品功能切分**（跟 app 5 module 一一对应）：

| module | 范围 | 备注 |
|---|---|---|
| `shell` | app 物理壳（标题栏 / 布局 / 初始化） | primitives 归入 |
| `workspace` | 主视图（工作区 + tab + 侧栏） | sidebar 归入 |
| `terminal` | 终端渲染（xterm + pane + tmux） | tmux 并入 |
| `session` | session 全生命周期 | 独立 module——核心数据实体 |
| `settings` | 应用设置 | 5 tab 抽屉 |

**每个 module 内部结构**：
```
modules/<name>/
├── api.ts            ⭐ 唯一对外入口
├── view/             React 组件（仅本 module 内部用）
├── store.ts          本 module 状态（跨 module 状态进 service 层）
├── model.ts          类型 + 派生（如果需要）
├── index.ts          barrel：只 re-export from api.ts
└── *.test.ts
```

**强制规则**：
- `index.ts` 只 export `api.ts`，**不**直接 export view / store / model
- 其他 module `import { X } from "@/ui/modules/<name>/api"`
- **禁止**直接 import `view/*` 或 `store.ts` 或 `model.ts`

### 2.3 `model/` — 数据 + 算法（5 + 1 = 6 domain）

**5 + 1 = 6 个目录**：

```
src/model/
├── session/        Session / SessionConfig / SessionDisplayConfig
├── workspace/      Workspace / Window / Group / PaneNode（含 paneTree 算法）
├── terminal/       TerminalTheme / 5 个 ANSI 调色板
├── settings/       Settings / SettingsCategory / LogLevel（含 TerminalTheme / 5 个 ANSI 调色板）
├── tmux/           TmuxController / AttachedServer / TmuxPane / TmuxWindow
└── common/         跨域纯函数（textTransform / constants / generateId）
```

**每个 domain 文件模板**（template）：
```typescript
model/<domain>/
├── types.ts          # 数据 shape / enum / union
├── repository.ts     # Repository 接口（service 实现）
├── events.ts         # event 契约（event name + payload 类型）
├── accessor.ts       # query 纯函数（getActiveXxx(items)）
├── rules.ts          # mutation 纯函数（applyXxx(item, patch)）
└── *.test.ts
```

**例外**：
- `cross-cutting/`：无 types / repository / events / accessor / rules——只有 helper 文件
- `settings/terminal/`：terminal 是 settings 的视觉子集，不独立成 domain
- `workspace/rules/`：按子域分子目录（paneTree 是最大子目录）

**accessor vs rules 区别**：
| 维度 | accessor | rules |
|---|---|---|
| 操作类型 | query（不修改数据） | mutation（产生新数据） |
| 返回 | 原数据 + 派生值 | 新数据（immutable） |
| 命名习惯 | `get*` / `find*` / `is*` | `apply*` / `with*` / `create*` / `merge*` |

**关键**：rules 函数**不可变**——返回新对象，旧对象可安全丢弃。这让 zustand store 触发 re-render 时引用比较正常工作。

### 2.4 `service/` — 运行时状态 + IPC 桥（6 domain）

**6 个 domain 划分**：
- 业务 domain：`session` / `workspace` / `tmux` / `settings` / `persistence`
- 工具 domain：`logger`（基础设施辅助）

```
src/service/
├── session/          session store（跨 module 状态）
├── workspace/        workspace / window / pane 树 store
├── tmux/             backend tmux control mode 镜像
├── settings/        应用配置
├── persistence/     ⭐ frontend-only 持久化（v5.1：sessions/groups 直存主入口；backend 只持 attached_tmux + log_config）
└── (已合并到其他位置) — theme/output/terminal/logger
```

**已删除/合并**：
- ❌ `theme` → 并入 `service/settings/`（theme 是 settings 的子集）
- ❌ `output` → 归 `ui/terminal/view/OutputBuffer.ts`（output 是 ui 渲染队列，不是跨 module 状态）
- ❌ `terminal` → 归 `ui/terminal/view/TerminalRegistry.ts`（xterm 实例是 ui 实现细节）
- ❌ `logger` → 归 `infra/logger/`（logger 是底层原语）

**每个 domain 内部约定**：
```typescript
service/<domain>/
├── api.ts            ⭐ 唯一对外入口（useXxxService hook）
├── store.ts          zustand store（或 ring buffer / Map 等）
├── bridge.ts         listen backend 事件 → store mutation
├── types.ts          domain 内部类型
└── *.test.ts
```

**强制规则**：
- `api.ts` 是**唯一对外入口**——其他 module 只 import 这个
- `store.ts` **不**对外暴露——只能通过 api.ts 的 hook 读写
- service 之间不互相调（除 session→output 的边缘 case）

**api.ts 标准接口模板**：
```typescript
export interface XxxService {
  list(): ReadonlyArray<Xxx>;              // 命令式（不发 re-render）
  get(id: KeyType): Xxx | undefined;
  useXxxs(): ReadonlyArray<Xxx>;           // 响应式订阅
  useXxx(id: KeyType): Xxx | undefined;
  upsert(item: Xxx): void;                // mutation（业务无关）
  remove(id: KeyType): void;
  create(config: Config): Promise<KeyType>;  // IPC 触发
  close(id: KeyType): Promise<void>;
  onEvent(callback: (event: XxxEvent) => void): () => void;  // 事件订阅
}
export function useXxxService(): XxxService;
```

**关键设计**：
1. **响应式 vs 命令式分离**——bridge 用命令式，UI 用响应式
2. **mutation vs IPC 分离**——`upsert` 不调 IPC，`create` 调 IPC
3. **事件订阅语义化**——`onOutput(cb)` 而不是 `eventBus.on("xxx", ...)`

### 2.5 `infra/` — 物理适配（4 子模块）

**唯一允许直跳 `@tauri-apps/api` 的层**：

```
src/infra/
├── tauri/         IPC 适配（invoke 封装 + listen 封装 + Repository 实现 + 事件总线）
├── store/         tauri-plugin-store 包装（持久化底层）
├── clipboard/     剪贴板读写
└── logger/        日志（命令式 API，全局单例）
```

**每个子模块内部结构**（INTERFACE / DOWNSTREAM / RESPONSIBILITY 独立保留）：
- `infra/tauri/`：最大、最核心的 IPC 适配子模块
  - `commands/` invoke 封装（按 backend domain 拆）
  - `events/` listen 封装（按 backend event name 拆）
  - `repositories/` Repository 接口实现（对应 model/repository.ts）
  - `eventBuses/` 事件总线（双层：底层通用 + 上层 typed）
  - `api.ts` 对外入口（聚合 commands + events + repositories）

**IPC wire 契约**：
- invoke：`@tauri-apps/api/core` 的 `invoke()` —— 入参 / 返回类型严格对应 backend `#[tauri::command]`
- listen：`@tauri-apps/api/event` 的 `listen()` —— 事件名 + payload 类型严格对应 backend `app.emit()`

**二进制 session-output wire 格式**（与 backend `binary_frame.rs` 同步）：
```
[A1] [01] [session_id BE 4B] [payload_len BE 4B] [payload]
```
- magic 必须 `0xA1`（0xDEADBEEF 是占位符——实际是 0xA1）
- version 必须 `0x01`（不匹配抛错）

## 3. 依赖方向

```
app  ──►  ui     (UI 通过 useXxxApi() hook 调 app)
 │     │
 └──┬──┘
    ├──►  model      (读 types + 调 accessor + 调 rules)
    ├──►  service    (读写 store + 调 IPC 桥)
    └──►  infra      (实际只有 service 间接调；app/ui 不直跳)
```

**详细规则**：
- **app ↔ ui**：ui 通过 `useXxxApi()` 调 app；app **不** import ui 内部组件
- **app / ui → model**：自由 import
- **app / ui → service**：通过 service 的 api.ts 边界
- **app / ui → infra**：**禁止直跳**，必须经过 service
- **model → 任何**：禁止（model 是最底层）
- **service → infra / model**：允许
- **infra → 任何**：禁止（infra 只依赖 `@tauri-apps/api`）

## 4. 跟 backend 设计的对应

| frontend (本文档) | backend 对应 | 关系 |
|---|---|---|
| `app/session` + `service/session` | `commands/session` + `services/session_manager` | 一一映射（IPC 契约） |
| `app/workspace` (frontend 持有) | `services/session_manager` (backend 不感知 workspace) | workspace 是 frontend 状态 |
| **`app/mcp`** (MCP 协议层) | **无 mcp_server module** + `services/{attach,subscribe,capture,tunnel}` + `commands/mcp` (4 个 attach 状态镜像) | **MCP server 在 frontend TS 层**（RFC 0002-revised） |
| `app/settings` | `commands/persistence.rs` 扩展 | settings.json 直存 + `after_settings_changed` 联动 |
| `infra/tauri/commands/*` | `commands/*` (rust `#[tauri::command]`) | IPC 入参 / 返回类型必须一致 |
| `infra/tauri/events/*` | backend `app.emit("...")` | 事件名 + payload 类型一致 |
| `model/session/types.ts` | `models/session.rs` | TS interface = Rust struct（serde 派生） |
| `model/mcp/types.ts` | ~~`models/mcp.rs`~~（删除） | MCP 工具类型**只**在 frontend——backend 无镜像 |

### 4.1 ⚠️ MCP server 位置（RFC 0002-revised）

| 维度 | 旧 RFC 0002 | 新 RFC 0002-revised（当前） |
|---|---|---|
| **协议层位置** | backend Rust (`mcp_server/`) | **frontend TS (`app/mcp/`)** |
| **stdio transport** | 直接（main = MCP server） | ❌ 不实现（WebView 无 stdin/stdout） |
| **HTTP transport** | 直接 | **直接**（Web API fetch） |
| **12 工具实现位置** | `mcp_server/tools/*.rs` | `app/mcp/tools/*.ts` |
| **业务状态** | backend | 不变（backend）——attach / OutputRing / capture / tunnel 仍 backend |
| **backend ↔ frontend 桥** | mcp_server in-process | IPC：`invoke('write_session')` / `invoke('attach_session')` |
| **rmcp 依赖** | 加 | 不加（frontend 自研 ~200 行 TS） |
| **协议升级** | backend rebuild | frontend hot reload |

**backend 必须保留的 4 个 service**（frontend MCP 间接依赖）：
- `services/attach/` —— attach 状态机（frontend MCP `attach_session` / UI takeover / reverse_tunnel 共享 IPC）
- `services/subscribe/` —— OutputRing（PTY/SSH/tmux 后端读循环是真源，frontend MCP `subscribe_output` 通过 `listen('session-output')` + 序号管理）
- `services/capture/` —— ❌ 不存在（RFC 0006 下沉到 `models/capture.rs`）—— capture 算法在 models
- `services/reverse_tunnel/` —— 反向 SSH 隧道（端口转发直接复用 frontend MCP HTTP server）

详见 [`doc/dev/adr/0002-revised-mcp-frontend.md`](../../adr/0002-revised-mcp-frontend.md)。

### 4.2 backend 支撑契约（frontend 必须遵守）

| backend IPC | frontend 调用 | 用途 |
|---|---|---|
| `invoke('create_local_session', config)` | `app/session` 创建 | 启动 PTY |
| `invoke('write_session', { sessionId, data })` | `app/mcp send_keys` + UI 键盘输入 | 写入 PTY |
| `invoke('close_session', { sessionId })` | `app/session.close` + MCP close_session | 关闭 session |
| `invoke('attach_session', { sessionId, clientId })` | `app/mcp attach_session` + UI takeover | 独占 session |
| `invoke('detach_session', { sessionId, clientId })` | `app/mcp detach_session` | 释放 |
| `invoke('list_attached_sessions')` | `app/mcp list_sessions` | 列表 |
| `invoke('mcp_status')` | `app/mcp/server.ts` 启动 | 读 mcp.http 配置 |
| `listen('session-output')` | `service/session/bridge` + UI xterm | PTY 输出流 |
| `listen('session-closed')` | UI + MCP subscribe | session 关闭事件 |
| `listen('mcp-attach-changed')` | UI banner + MCP mirror state | attach 状态变化 |
| `listen('config-reloaded')` | `service/settings` 同步 | 配置变化 |
| `listen('tunnel-status-changed')` | UI tunnel status | 反向隧道状态 |

## 5. 关键流程

### 5.1 启动序列（frontend）

```typescript
// main.tsx → App.tsx → useShellApi().initialize()
await useShellApi().initialize();
// 1. service/infra.invoke('shell_initialize_logging')  → backend logging
// 2. service/session/bridge.setupSessionOutputListener()  → listen('session-output')
// 3. service/session/bridge.setupAttachListener()         → listen('mcp-attach-changed')
// 4. ⭐ app/mcp/server.ts::startServer(ctx)              → frontend HTTP server @ 127.0.0.1:19847
//    - 读 settings.json [mcp.http] 决定 port + token
//    - spawn HTTP server
//    - register 9 个 MCP 工具
// 5. app/settings.load() + app/workspace.loadLastWorkspace() + app/terminal.autoAttachTmuxServers()
// 6. readiness.setReady(true)
```

### 5.2 用户创建 session 流程

```
ui/workspace: 用户点 "+"
    ↓
ui/session: shell.openDialog({ kind: "createSession", payload: {...} })
    ↓
app/session/usecases/createLocal.ts
    ↓
1. service/session/createLocal(config)  → invoke('create_local_session', config)
    ↓ Tauri IPC
2. backend commands/session::create_local_session
    ↓
   a. SessionManager::create_local → 分配 u32 session_id + mcp_session_id
   b. services::local_session::spawn_pty → PTY handle
   c. backend read_loop: ring.push(bytes) + emit_binary(BinaryFrame)
    ↓
3. service/session/store.upsert(SessionInfo)
4. 如果 shouldSave: service/persistence 写入 saved config
    ↓
5. app/session/usecases/openInWorkspace → app/workspace::openSession
    ↓
6. service/workspace/store 更新 pane 树
    ↓
ui/workspace: re-render → pane 显示 terminal
```

### 5.3 MCP subscribe_output 流程（frontend TS + backend 支撑）

```
AI agent POST http://127.0.0.1:19847/mcp
   ↓ HTTP + Bearer token
frontend app/mcp/server.ts handler
   ↓
1. token verify (auth.ts)
2. JSON-RPC 2.0 parse (server.ts)
3. dispatch → app/mcp/tools/subscribe_output.ts
   ↓
4. ctx.resolveSessionId("tab-7f3a9b")  → 查 service/session/store
5. ctx.requireAttached(sessionId, callerClientId)  → 本地 mirror state 检查
6. ctx.serviceSession.subscribeOutput(sessionId, sinceSeq, callback)
   ↓
7. service/session/bridge:
   - listener 已 listen('session-output', ...)
   - 解析 BinaryFrame → (sessionId, seq, bytes, timestamp)
   - 跟 sinceSeq 比较，只推 > sinceSeq 的 entry
   - 通过 callback 推回 MCP tool
    ↓
8. app/mcp/tools/subscribe_output 推回 MCP client (HTTP SSE / notification)
```

**关键**：subscribe_output 数据源是 backend `session-output` BinaryFrame 事件，frontend 通过 service/session/bridge 解析；MCP 工具、UI xterm render 共享同一份事件源。

### 5.4 AI 接管（attach）流程（M7）

```
ui/session: 用户点 "🤖 AI 接管"
    ↓
app/session/usecases/ai_takeover/attach.ts
    ↓
1. invoke('attach_session', { sessionId, clientId: "ui-takeover" })
    ↓ Tauri IPC
2. backend commands/mcp::attach_session → services::attach::AttachRegistry::try_attach
   - 检查互斥（CAS）
   - emit "mcp-attach-changed" 事件
    ↓
3. frontend service/session/bridge 收到事件 → 更新 store
    ↓
4. ui/session: 渲染 banner "🤖 AI Agent 接管中"
5. ui/workspace: PaneHeader 显示 🤖 标识
6. Terminal.tsx: useEffect 订阅 attachState → keydown capture 阶段 preventDefault()
    ↓
7. ⭐ MCP send_keys 路径（关键：同步显示）：
   frontend app/mcp/tools/send_keys.ts:
     - ctx.requireAttached(sessionId, "mcp-client-uuid")
     - safety.isDestructive(keys, policy)
     - bytes 序列化
     - invoke('write_session', { sessionId, data })
   ↓
   backend commands/session::write_session:
     - ⭐ attach_registry.check_write_permission(sessionId, "mcp-client-uuid")
       → 已 attach 且 caller == attach_client → 允许
     - write to PTY
   ↓
   PTY shell 产生输出
   ↓
   backend read_loop:
     - ring.push(bytes)
     - emit_binary(BinaryFrame)
   ↓
   frontend xterm.js 接收 BinaryFrame → render()
   ↓
   ⭐ 跟人敲键盘完全一致 —— 同一份 backend write path + 同一份 frontend render path
```

### 5.5 反向 SSH 隧道流程（M8）

```
config.json [tunnel] enabled = true
    ↓
services/reverse_tunnel::start_if_enabled(state)
    ↓
1. spawn russh client 连 ssh.example.com
2. open forward channel (-R remote_port:127.0.0.1:local_mcp_port)
    ↓
AI agent 在 remote 通过 ssh.example.com:remote_port 连入
    ↓ TCP → forward
3. reverse_tunnel 检测新连接 → forward bytes → local 127.0.0.1:19847
    ↓
4. ⭐ local frontend MCP HTTP server（app/mcp/server.ts）收到请求
   - frontend HTTP server 跑在 Tauri WebView 内
   - 远端 agent 通过反向 SSH 隧道连到本机 WebView 内的 HTTP server
   - 复用同一份 9 个工具 + Bearer token
    ↓
5. 连接断开 → russh reconnect 指数退避（1/2/4/8/16s × 5 次）
   → emit "tunnel-status-changed" → UI toast
```

## 6. 跨语言 wire 契约（与 backend 同步）

### 6.1 Rust → TS 镜像规则

| Rust 类型 | TS 镜像 | 同步工具 |
|---|---|---|
| `#[derive(Serialize, Deserialize)]` struct | `interface X` | 手写（现状，ts-specta 未启用） |
| `#[tauri::command] fn` 签名 | `invoke<T>(name, args)` | 手写（IPC 契约见 `commands/*/INTERFACE.md`） |
| `app.emit(name, payload)` | `listen<T>(name, cb)` | 事件契约见 backend `infrastructure/events/CONTRACT.md` |
| `models::config::Settings` | `Settings` interface | serde_json 序列化 |

### 6.2 Rust 事件名（backend emit → frontend listen）

| 事件名 | payload 类型 | 何时 emit |
|---|---|---|
| `session-output` | `Vec<u8>`（BinaryFrame `[0xA1][0x01][sid BE 4B][len BE 4B][data]`） | PTY / SSH / tmux 有新输出 |
| `session-output-channel` | `Channel<Vec<u8>>` | setup 一次，前端 subscribe |
| `session-closed` | `u32`（session_id） | session 关闭 |
| `tmux-events` | `TmuxEvent` 枚举 | tmux 控制模式事件 |
| `mcp-attach-changed` | `{ sessionId, clientId, action }` | MCP attach 状态变化 |
| `config-reloaded` | `Settings` | settings.json 写后 / 启动加载 |
| `system-theme-changed` | `String` | OS 主题切换 |
| `tunnel-status-changed` | `TunnelStatus` | 反向隧道连接状态变化 |

**前端事件名**（emit → backend listen）：无——frontend 不 emit 给 backend。

### 6.3 关键 IPC 契约（重点）

| IPC 命令 | frontend 调用 | backend 接收 |
|---|---|---|
| `create_local_session` | `invoke('create_local_session', { config })` | `commands::session::create_local_session` |
| `write_session` | `invoke('write_session', { sessionId, data: Uint8Array })` | `commands::session::write_session`（自动 attach 权限检查） |
| `close_session` | `invoke('close_session', { sessionId })` | `commands::session::close_session` |
| `attach_session` | `invoke('attach_session', { sessionId, clientId: "ui-takeover" \| "mcp-<uuid>" })` | `commands::mcp::attach_session` 透传 |
| `detach_session` | `invoke('detach_session', { sessionId, clientId })` | `commands::mcp::detach_session` 透传 |
| `list_attached_sessions` | `invoke('list_attached_sessions')` | `commands::mcp::list_attached_sessions` |
| `get_session_attach_state` | `invoke('get_session_attach_state', { sessionId })` | `commands::mcp::get_session_attach_state` |
| `mcp_status` | `invoke('mcp_status')` | `commands::mcp::mcp_status` |
| `regenerate_mcp_token` | `invoke('regenerate_mcp_token')` | `commands::mcp::regenerate_mcp_token` |
| `load_settings` | `invoke('load_settings')` | `commands::persistence::load_settings` |
| `save_settings` | `invoke('save_settings', { settings })` | `commands::persistence::save_settings` |
| `patch_settings` | `invoke('patch_settings', { patch })` | `commands::persistence::patch_settings` |
| `capture_text` | `invoke('capture_text', { sessionId, lines })` | `commands::session::capture_text`（RFC 0006） |
| `capture_ansi` | `invoke('capture_ansi', { sessionId, lines })` | `commands::session::capture_ansi`（RFC 0006） |
| `tunnel_start / stop / status / generate_script` | 详见 `app/mcp/tools/` 或 `ui/settings` | `commands::tunnel::*` |

### 6.4 settings.json 直存契约（RFC 0003-revised）

frontend 不再走 `service/persistence` 的 `config` 子模块（已删除），直接：
```typescript
// 读
const settings = await invoke<Settings>("load_settings");

// 整替换
await invoke("save_settings", { settings });

// 部分更新
const newSettings = await invoke<Settings>("patch_settings", { patch });
```

backend 字段变更 → frontend zod 校验 + UI 提示。

## 7. 强约束（pre-commit 必跑）

```bash
# 1. model 不能 import 业务层
grep -rnE 'from\s+"(app|ui|service)' src/model/ --include='*.ts'
# 必须为空

# 2. model 不能 import React
grep -rn 'from\s+"react"' src/model/ --include='*.ts'
# 必须为空

# 3. model 不能 import @tauri-apps/api
grep -rn 'from\s+"@tauri-apps' src/model/ --include='*.ts'
# 必须为空

# 4. infra 是唯一允许直跳 @tauri-apps/api 的层
grep -rn 'from\s+"@tauri-apps' src/ --include='*.ts' --include='*.tsx' | grep -v 'src/infra/'
# 必须为空（除 infra 外）

# 5. infra 不能依赖 app / ui / service
grep -rnE 'from\s+"\.\./(app|ui|service)' src/infra/ --include='*.ts'
# 必须为空

# 6. infra 可以依赖 model（仅类型）
grep -rnE 'from\s+"\.\./model/' src/infra/ --include='*.ts'
# 应当出现（类型）

# 7. ui 不可以直跳 infra/tauri（必须经过 service）
grep -rn 'from\s+"@/infra/tauri' src/ui/ --include='*.ts' --include='*.tsx'
# 必须为空（除 ui/terminal 通过 props 间接使用）

# 8. ui 可以直跳 infra/clipboard 和 infra/logger（特例）
grep -rn 'from\s+"@/infra/(clipboard|logger)' src/ui/ --include='*.ts' --include='*.tsx'
# 应当出现（特例）

# 9. cross-cutting 是最底层——不能 import 其他 domain
grep -rnE 'from\s+"\.\./(session|workspace|tmux|settings)' src/model/cross-cutting/ --include='*.ts'
# 必须为空

# 10. model/<domain>/ 之间不能互相调（除 settings → settings/terminal 子目录）
grep -rnE 'from\s+"\.\./(session|workspace|tmux|settings)/' src/model/{session,workspace,tmux,settings,cross-cutting}/ --include='*.ts'
# 必须为空
```

## 8. 设计系统约束

所有 UI 改动必读 [`../../../design-system.md`](../../../design-system.md)。

三层校验 grep（pre-commit 必跑）：

```bash
grep -rn -E "(--bg-primary|--bg-secondary|--bg-tertiary|--text-primary|--text-secondary|--text-muted|--border-color|#0e639c|#1177bb|linear-gradient)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "font-weight: ?(600|700|bold)" src/ --include="*.ts" --include="*.tsx" --include="*.css"
grep -rn "box-shadow:" src/components/ --include="*.css"
```

- (1) 和 (2) 必须返回零匹配
- (3) 必须只匹配 `doc/design-system.md §10.2 + §10.3` 文档化的 5 个例外

违反任何一条不允许 merge。

## 9. 性能预算（与 backend §10 对齐）

| 路径 | 预算 |
|---|---|
| `invoke()` 单跳 | < 5ms |
| `listen()` 事件分发 | < 10ms |
| zustand store re-render | < 16ms |
| xterm.js render 100 行 | < 20ms |
| `service/persistence.get<T>(key)` | < 1ms |
| app/mcp HTTP server 启动 | < 500ms |
| MCP HTTP tool call 往返 | < 50ms |

## 10. 文档地图

> **唯一权威**：本文档。子层 README 已合并。各 module 的 RESPONSIBILITY / INTERFACE / DOWNSTREAM 独立保留（不删）。

| 子系统 | 文档 |
|---|---|
| **顶层架构** | **本文档** |
| `app/<module>/` 详细契约 | `<module>/RESPONSIBILITY.md` + `<module>/INTERFACE.md` + `<module>/DOWNSTREAM.md` |
| `ui/<module>/` 内部约定 | 各 module 的独立 doc（如有） |
| `model/<domain>/` 文件模板 | 本文档 §2.3 |
| `service/<domain>/` 内部约定 | 本文档 §2.4 |
| `infra/tauri/` IPC wire 格式 | backend `infrastructure/binary_frame.rs` + frontend `hooks/sessionOutputFrame.ts`（必须前后端完全一致） |
| **backend 设计** | [`doc/dev/design/backend/README.md`](../../backend/README.md) |
| MCP server 设计（frontend） | [`app/mcp/RESPONSIBILITY.md`](app/mcp/RESPONSIBILITY.md)（302 行） |
| MCP 工具 JSON Schema | [`app/mcp/INTERFACE.md`](app/mcp/INTERFACE.md)（332 行） |

## 11. 不在 MVP 范围

- 会话录像回放（v1.1）
- 主题商店（v1.1）
- 跨设备同步（v2）
- WebAssembly 插件（v2）
- macOS / Linux 移植（v2）—— frontend 通过 Tauri 跨平台抽象，理论可移植
- AI 自动生成快捷键 / 主题（v2）

## 12. 演进路径

### 12.1 v1.0 加功能
- capture_screen screenshot 模式（前端 xterm.js offscreen renderer）
- MCP list_profiles / get_config（v1.0 RFC 0002-revised 留口）
- 团队协作（多人 cursor 共享 session）（v2）

### 12.2 拆分 npm packages
- 当前：`src/` 是单 package
- v1.1：`ui/components/` 抽成独立 npm package（可外部使用）
- v2：`ui-kit` 独立包 + 多个 app project 复用

## 13. 强约束（CSS / 设计系统）

详见 §8 设计系统约束 + `doc/design-system.md`。

所有 UI 改动：
- 必须 token 化（`var(--canvas)` / `var(--ink)` 等）
- 禁止 hex literal 在 component CSS（§10 例外除外）
- 禁止 bold weights（600/700/bold）在 chrome
- 禁止 drop shadows（除 5 个文档化例外）
- 禁止 VSCode blue（`#0e639c` / `#1177bb`）在非 xterm 内容

## 14. 验收

- 5 层 + 6 个 app module + 5 个 ui module + 6 个 model domain + 6 个 service domain + 4 个 infra submodule 全部按设计 ✅
- MCP server 在 frontend TS 层（RFC 0002-revised） ✅
- 9 个 MCP 工具 + AI 接管 UX 完整 ✅
- 同步显示：MCP send_keys 跟键盘走同一 backend write + frontend xterm render ✅
- 反向 SSH 隧道端口转发直接复用 frontend MCP HTTP ✅
- frontend 跟 backend IPC 契约严格同步 ✅
- 强约束 grep 通过 ✅
