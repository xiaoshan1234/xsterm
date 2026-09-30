# xsterm → ai-terminal：目标架构（Target Architecture）

> **目的**：在 01-gap-analysis.md 确定的缺口上，给出 xsterm 演进后的目标架构。这是 dev 实施的契约，tm 验收的依据。
>
> **决策点对应**：本文采用以下决议（pdm 2026-09-11 拍板，详见 `doc/adr/legacy-rfcs/`）：
> - **D-α** tmux 实现：**保留 xsterm -CC 全量实现**，对标 iTerm2（RFC 0001）
> - **D-β** MCP server 拆分：**MVP 阶段单二进制 + 内部模块**（RFC 0002）
> - **D-γ** 配置格式：**保留 `tauri-plugin-store` JSON 格式**（RFC 0003-revised）
> - **D-δ** 命名：**保留 `xsterm` 品牌**，对外宣传用 "AI Terminal"（RFC 0004）

---

## 1. 仓库布局（终态）

```
xsterm/
├── apps/
│   └── desktop/                  Tauri 主项目（当前 xsterm/ 主体）
│       ├── src/                  React + TS + Vite 前端
│       │   └── ...
│       ├── src-tauri/            Rust 主进程（编译产物 xsterm.exe）
│       │   ├── Cargo.toml
│       │   ├── tauri.conf.json
│       │   ├── capabilities/
│       │   │   ├── default.json
│       │   │   ├── mcp-stdio.json         # NEW
│       │   │   └── mcp-http.json          # NEW（按需启用）
│       │   └── src/
│       │       ├── main.rs                 # 主进程入口
│       │       ├── lib.rs                  # 主进程 Tauri builder
│       │       ├── commands/               # Tauri IPC commands
│       │       ├── services/
│       │       │   ├── session_manager.rs  # 现有，复用
│       │       │   ├── local_session/      # 现有
│       │       │   ├── ssh_session/        # 现有
│       │       │   ├── tmux/               # 现有 (tmux -CC)
│       │       │   ├── session_log.rs      # 现有
│       │       │   ├── attach/             # NEW: attach/detach 状态机
│       │       │   ├── subscribe/          # NEW: 序号环形缓冲
│       │       │   └── config/             # NEW (revised): tauri-plugin-store JSON + 联动更新（RFC 0006 内联到 commands/persistence.rs）
│       │       ├── infrastructure/
│       │       │   ├── pty.rs
│       │       │   ├── ssh.rs              # 现有（host key 校验开关化）
│       │       │   ├── tmux/               # 现有
│       │       │   ├── app_backend.rs      # 现有
│       │       │   └── reverse_tunnel.rs   # NEW: russh 反向隧道
│       │       └── models/                 # 新增 profile.rs / attach.rs
│       ├── bin/
│       │   └── xsterm-mcp.rs               # NEW: MCP stdio 子进程入口
│       └── ...
├── crates/
├── pty-bridge/               # 抽出 portable-pty（可选，第一阶段不抽）
├── mcp-server/               # 抽出 rmcp 实现（可选；先在 src-tauri 内）
├── ssh-client/               # 抽出 russh（可选）
├── ssh-tunnel/               # NEW: 反向 SSH 隧道
└── updater/                  # NEW: 应用内更新
├── ui/                           # 前端组件库（独立 npm package，v1.1）
├── docs/                         # VitePress 文档站（v1.0 必出）
│   ├── index.md
│   ├── quickstart.md
│   ├── mcp.md
│   ├── privacy-policy.md
│   ├── SECURITY.md
│   ├── CONTRIBUTING.md
│   └── CHANGELOG.md
├── doc/                          # 现有架构/需求/维护文档（保留）
│   ├── ai-terminal-migration/    # NEW: 迁移三件套
│   │   ├── 01-gap-analysis.md
│   │   ├── 02-target-architecture.md
│   │   └── 03-migration-roadmap.md
│   └── ...
├── prd.md                        # 现有
├── mvp-checklist.md              # 现有
├── acceptance.md                 # 现有
├── compliance.md                 # 现有
├── dev-handoff.md                # 现有
├── LICENSE                       # NEW: MIT
├── NOTICE                        # NEW: cargo-about 生成
├── README.md                     # 更新（含 xsterm → AI Terminal 命名）
└── .github/
    └── workflows/
        ├── ci.yml                # NEW: cargo test + npm test + clippy
        ├── mcp-compat.yml        # NEW: 跑 mcp 协议兼容性测试
        └── store-check.yml       # NEW: MSIX 打包 + WACK 模拟

```

**注意**：xsterm 当前是单 crate 单 app，**第一阶段不抽 workspace**——保持 `apps/desktop/` = `xsterm/` 现状，把目录结构先按 `apps/desktop/` 在 README 里描述；workspace 拆分留到 v1.1（理由：抽 crate 会显著拖慢编译，不在 MVP ROI 内）。

---

## 2. 进程模型（终态）

```
┌──────────────────────────────────────────────────────────┐
│ xsterm.exe (Tauri 主进程，Rust)                            │
│                                                          │
│  ┌─────────────┐   tokio::mpsc    ┌──────────────────┐   │
│  │ pty/ssh/tmux │ ──────────────▶ │ SessionManager   │   │
│  │ backends     │ ◀────────────── │ (DashMap<u32,…>) │   │
│  └─────────────┘                 └──────────────────┘   │
│           ▲                                ▲             │
│           │                                │             │
│           │                       ┌────────┴───────┐     │
│           │                       │ attach/subscribe│    │
│           │                       │ /capture state │    │
│           │                       └────────┬───────┘     │
│           │                                │             │
│           │                       ┌────────▼───────┐     │
│           │                       │ Tauri events   │     │
│           │                       │ + MCP notif.   │     │
│           │                       └────────┬───────┘     │
│  ┌────────┴─────────┐                       │             │
│  │ WebView2 (UI)    │ ◀──── invoke/listen ──┘             │
│  │ React + xterm.js │                                     │
│  └──────────────────┘                                     │
│           │                                               │
│           │  spawn (tokio::process)                       │
│           ▼                                               │
│  ┌──────────────────────────────┐                         │
│  │ xsterm-mcp.exe (stdio)       │  (NEW)                  │
│  │  ├─ stdin/stdout JSON-RPC    │                         │
│  │  ├─ handler 转发到 core 总线 │                         │
│  │  └─ 共享内存 / pipe 与主进程 │                         │
│  └──────────────────────────────┘                         │
│                                                          │
│  可选 (mcp.http.enabled):                                 │
│  ┌──────────────────────────────┐                         │
│  │ xsterm-mcp HTTP 端点         │  (NEW)                  │
│  │  ├─ 127.0.0.1:19847          │                         │
│  │  ├─ POST/GET/DELETE /mcp     │                         │
│  │  └─ Bearer token 鉴权        │                         │
│  └──────────────────────────────┘                         │
└──────────────────────────────────────────────────────────┘
```

### 2.1 关键决策

- **MCP 子进程 vs 同进程**：选**独立二进制** `xsterm-mcp.exe`（推荐 D-β-3）。Claude Desktop / Cursor / Codex 都直接 `command: "xsterm-mcp"`，零额外配置。
- **通信机制**：子进程通过 `tokio::process::Command::spawn` 启动，主进程持有 child handle；MCP handler 在子进程内收到 RPC 后通过 **stdin/stdout pipe** 与主进程通信（自定义轻协议，例如 newline-delimited JSON `{ "kind": "call", "id": ..., "method": ..., "params": ... }`）。这是规格 §1.1 的实现方式，但允许一种简化变体——**MCP 子进程只处理 MCP 协议层，所有 session 操作通过 RPC 转发到主进程**，子进程不持有任何 session 状态。
- **attach 状态**：放主进程 SessionManager（不是 MCP 子进程）。原因：attach 屏蔽用户键盘输入是 UI 行为 + PTY 写入互斥，单一进程内一致。
- **stdio 进程生命周期**：与主进程同生共死；主进程退出 → child 收到 SIGPIPE → MCP server 优雅退出。

---
| 数据模型（终态）
|---|

> **2026-09 更新**：本文 §3-§7 的具体后端模块拆分已经在 [`doc/dev/design/backend/`](../design/backend/) 中细化。详见：
> - 顶层架构：[backend/README.md](../design/backend/README.md)
> - MCP server 子系统：[backend/mcp_server/README.md](../design/backend/mcp_server/README.md)
> - attach / subscribe / capture / config / reverse_tunnel 5 个新 service：[backend/services/README.md](../design/backend/services/README.md)
> - SessionManager 扩展：[backend/services/session_manager_extension.md](../design/backend/services/session_manager_extension.md)
> - commands 拆分（4 个 → 5 个）：[backend/commands/README.md](../design/backend/commands/README.md)
> - models 拆分（3 个 → 8 个）：[backend/models/README.md](../design/backend/models/README.md)

### 3.1 后端

```rust
// models/session.rs —— 扩展现有
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SessionType {
    Local { shell: String, cwd: String },
    Ssh { host: String, port: u16, user: String },
    TmuxCc { controller_id: u32, pane_id: String, session_name: String, socket_name: Option<String> },
    // NEW (规格 M2):
    TmuxSimple { tmux_session: String },  // 普通 tmux 子进程（非 -CC）
    Docker { container_id: String, shell: String },  // NEW
}

// models/session.rs —— 新增 SessionInfo.attached
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: u32,
    pub name: String,
    pub session_type: SessionType,
    pub is_connected: bool,
    pub capabilities: CapabilityFlags,
    pub tmux_pane_id: Option<String>,
    pub tmux_controller_id: Option<u32>,
    pub tmux_window_id: Option<String>,
    pub is_hidden: bool,
    // NEW:
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attached: Option<AttachState>,  // None = 未被 AI attach
    // NEW: 与 MCP session_id 双向对应
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp_session_id: Option<String>,  // "tab-7f3a9b"
}

// models/attach.rs —— NEW
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachState {
    /// 来自 MCP initialize 阶段的 client_info.name
    pub agent_name: String,
    /// MCP 进程 pid（stdio 模式下就是子进程 pid；HTTP 模式下是 server 内部 session id）
    pub agent_pid: u32,
    /// ms epoch —— 用于 60min 自动释放
    pub attached_at: u64,
    /// ms epoch —— 最后一次 send_keys / capture_screen，刷新自动释放计时
    pub last_activity_at: u64,
}

// models/capabilities.rs —— 扩展
pub struct CapabilityFlags {
    // 现有字段...
    // NEW:
    pub image_protocol: bool,  // Kitty graphics 是否启用
    pub unicode11: bool,
}

// models/profile.rs —— NEW（用于 MCP list_profiles）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    pub profile_type: ProfileType,  // local/ssh/wsl/docker/tmux
    pub description: Option<String>,
    pub default: bool,
}

// models/subscription.rs —— NEW（环形缓冲）
pub struct OutputRing {
    /// 100000 行环形缓冲
    buffer: Mutex<VecDeque<RingEntry>>,
    /// 单调递增序号
    next_seq: AtomicU64,
}

pub struct RingEntry {
    pub seq: u64,
    pub data: Vec<u8>,  // 原始字节（include_ansi=false 时前端解析为文本）
    pub timestamp: u64,
}
```

### 3.2 配置（终态）—— ⚠️ RFC 0003-revised：保留 JSON 格式

> **2026-09 决策**：保留 `tauri-plugin-store` JSON 格式，**不迁移到 toml**。理由：frontend 直存场景下 JSON 比 toml 简单（少 4 个 crate 依赖 + 无 migration + frontend 集成更直接）。
>
> 详见 [`doc/dev/adr/0003-revised-config-json.md`](../adr/0003-revised-config-json.md)。

**文件路径**：`%APPDATA%\xsterm\settings.json`（tauri-plugin-store）

```json
{
  "settings": {
    "theme": "dark",
    "terminalFontFamily": "Cascadia Code",
    "terminalFontSize": 14,
    "terminalScrollback": 10000,
    "terminalCopyOnSelect": true,
    "terminalBracketedPasteDefault": true,
    "logLevel": "info",
    "sidebarWidth": 240,
    "showSidebar": true,
    "keybindings": {
      "newTab": "Ctrl+T",
      "closeTab": "Ctrl+W",
      "splitHorizontal": "Ctrl+Shift+D",
      "splitVertical": "Ctrl+Shift+E"
    },
    "mcp": {
      "enabled": true,
      "httpEnabled": false,
      "httpPort": 19847,
      "httpToken": null,
      "destructiveKeysPolicy": "deny",
      "idleTimeoutSeconds": 3600,
      "rateLimitRps": 100
    },
    "ssh": {
      "hostKeyVerify": "ask",
      "keepaliveIntervalSecs": 15,
      "connectTimeoutSecs": 10
    },
    "tunnel": {
      "enabled": false,
      "sshHost": "",
      "sshUser": "",
      "sshPort": 22,
      "localMcpPort": 19847,
      "remotePort": 19848,
      "allowedRemoteUsers": []
    }
  }
}
```

**关键**：
- frontend `@tauri-apps/plugin-store` 直接读写
- backend `services/config` 包装 store + 联动更新子系统
- 每个字段 `#[serde(default)]` —— 向前兼容（旧 settings.json 缺字段用 default）
- **不**用 `deny_unknown_fields` —— JSON 容忍前端新增字段
- 配套独立 store：`sessions.json` / `groups.json` / `attached_tmux.json` / `log_config.json`（已有，各自独立 key）

### 3.3 持久化（无迁移）

> **RFC 0003-revised**：store JSON 一直是权威文件，**无迁移路径**。

```
%APPDATA%\xsterm\
├── settings.json                # Settings（应用配置）
├── sessions.json                # SavedSessionConfig 列表
├── groups.json                  # Group 列表
├── attached_tmux.json           # AttachedTmuxServer 列表
├── log_config.json              # logging 配置
├── ssh\known_hosts               # SSH known_hosts（已有）
├── cache\                        # 主题/字体缓存（已有）
└── logs\                         # 应用日志（已有）
```

**单一权威文件 = settings.json**（应用配置）。
**独立 store file** = 各业务领域独立 key（sessions / groups / attached_tmux / log_config）。

**无迁移代码**（`services/config/migration.rs` 不存在）。
**无 .bak 回退**（无格式变化）。
**无 notify 监听**（frontend 是唯一写入入口，不需要外部文件监听）。

---

## 4. SessionManager 扩展（关键）

### 4.1 当前结构

```rust
// session_manager.rs (2717 行)
pub(crate) enum ActiveSession {
    Pty(Box<dyn SessionBackend + Send>),
    Ssh(Box<SshSessionWrapper>),
    TmuxPane(Box<TmuxPaneHandle>),
}
pub struct SessionManager {
    sessions: DashMap<u32, Arc<ActiveSession>>,
    next_id: AtomicU32,
    tmux_controllers: DashMap<u32, Arc<TmuxController>>,
}
```

### 4.2 终态结构（RFC 0006 调整后）

```rust
// session_manager.rs 扩展（无 capture state —— capture 算法层在 models/capture.rs）
pub(crate) enum ActiveSession {
    Pty(Box<dyn SessionBackend + Send>),
    Ssh(Box<SshSessionWrapper>),
    TmuxPane(Box<TmuxPaneHandle>),
    Docker(Box<DockerHandle>),  // NEW
    TmuxSimple(Box<TmuxSimpleHandle>),  // NEW（可选）
}

pub struct SessionManager {
    sessions: DashMap<u32, Arc<ActiveSession>>,
    next_id: AtomicU32,
    tmux_controllers: DashMap<u32, Arc<TmuxController>>,
    docker_containers: DashMap<u32, Arc<DockerHandle>>,  // NEW

    // NEW：attach / subscribe 状态（RFC 0006：capture 算法下移到 models）
    attach_registry: Arc<AttachRegistry>,           // friend with services/attach
    subscribe_registry: Arc<SubscribeRegistry>,     // friend with services/subscribe
    session_id_index: DashMap<String, u32>,        // mcp_session_id → u32
    reverse_index: DashMap<u32, String>,            // u32 → mcp_session_id
    profiles: DashMap<String, Profile>,              // profile_name → Profile（NEW）
    quota: Arc<SessionQuota>,                        // 100 sessions max

    // NEW：审计
    audit_log: Option<Arc<AuditLog>>,                // mcp.audit.enabled 时启用
}
```

> **⚠️ RFC 0006 调整**：原设计 `output_rings / subscribers` DashMap 已下沉到 `services::subscribe::SubscribeRegistry`（独立 module）。SessionManager 只持有 `Arc<SubscribeRegistry>` 引用。capture 算法层（strip_ansi regex）在 `models/capture.rs`——没状态、pure function，不进 SessionManager。

### 4.3 SessionBackend 扩展

```rust
// infrastructure/session_backend.rs 现有 + 扩展
pub trait SessionBackend: Send + Sync {
    fn info(&self) -> &SessionInfo;
    fn capabilities(&self) -> &CapabilityFlags;
    fn write(&self, data: &[u8]) -> Result<(), String>;
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String>;
    fn close(self: Box<Self>) -> Result<(), String>;
    // NEW:
    fn capture_text(&self, start: i32, end: i32, strip_ansi: bool) -> Result<String, String>;
    fn capture_ansi(&self, start: i32, end: i32) -> Result<String, String>;
    fn upload_image(&self, filename: &str, data: &[u8]) -> Result<String, String>;  // 已在 SSH 上有，提到 trait
}
```

**实现细节**：
- `LocalSession`：capture_text 通过 xterm.js grid（前端调用更便宜，不走后端），但后端 trait 也要有 fallback 实现（PTY 暂时输出流只暴露 bytes，capture 走前端更准——规格 §3.5 注释了此点）。决定：**capture 由前端 xterm.js 处理**（off-screen renderer），后端只负责把 buffer bytes 推给前端。
- `SshSession`：同 LocalSession，capture 走前端。
- `TmuxPaneHandle`：已有 `capture_tmux_pane`（后端），capture 走 tmux 的 `capture-pane -p -e -J`。
- `DockerHandle`：capture 由 PTY 流推；前端接管 capture。

**取舍**：capture 路径分裂——tmux 走后端，其他走前端。规格允许（"text 模式直接读 terminal grid"——前端就是 grid 的持有者）。详见 03 §P1-1。

---

## 5. MCP Server（核心模块设计）

> **⚠️ 2026-09 更新**：MCP server 已从 backend 迁到 frontend TS 层（RFC 0002-revised）。
>
> 详见：
> - **决策**：[`doc/dev/adr/0002-revised-mcp-frontend.md`](../adr/0002-revised-mcp-frontend.md) —— override 原 RFC 0002
> - **frontend MCP 设计**：[`doc/dev/design/frontend/app/mcp/`](../design/frontend/app/mcp/)（RESPONSIBILITY 302 行 + INTERFACE 332 行 + DOWNSTREAM 153 行）
> - **backend 支撑**：[`doc/dev/design/backend/README.md`](../design/backend/README.md) —— attach / subscribe / tunnel 3 个 service + capture 算法在 models（RFC 0006）
>
> ### 5.1 frontend MCP server 位置（已迁移）
>
> ```
> src/app/mcp/
> ├── server.ts               HTTP server + JSON-RPC 2.0
> ├── tools/                  9 个 MCP 工具实现
> ├── transport/http.ts       HTTP transport（127.0.0.1:19847 + Bearer token）
> ├── auth.ts                 Bearer token 验证
> ├── safety.ts               破坏性快捷键白名单
> ├── client_state.ts         attach 独占状态（mirror backend attach_registry）
> ├── context.ts              依赖注入（service store + invoke + emit）
> ├── types.ts                MCP wire 类型（无 backend 镜像）
> └── errors.ts               McpError → JSON-RPC error 映射
> ```
>
> ### 5.2 backend 支撑（保留）
>
> - `services/attach/` —— attach 状态机（backend 唯一真相源）
> - `services/subscribe/` —— OutputRing 环形缓冲 + 序号（backend 唯一真源）
> - `services/capture/` —— capture 三模式（tmux 走 capture-pane backend 命令）
> - `services/reverse_tunnel/` —— 反向 SSH 隧道（端口转发直接复用 frontend MCP HTTP）
>
> ### 5.3 IPC 镜像（保留）
>
> - `commands/session::write_session` —— frontend MCP send_keys 调
> - `commands/session::close_session` —— frontend MCP close_session 调
> - `commands/mcp::attach_session / detach_session` —— frontend MCP attach / UI takeover / reverse_tunnel 透传
> - `commands/tunnel::*` —— frontend MCP 启停反向隧道
>
> ### 5.4 stdio transport（不实现）
>
> WebView 没有 stdin/stdout，stdio transport 不可行。Claude Desktop / Cursor / Codex 都支持 HTTP MCP 接入（2025+ 版本），配置方式：`http://127.0.0.1:19847` + Bearer token。如未来需要 stdio，Tauri sidecar spawn `xsterm-mcp-stdio.exe` + stdio pipe 桥接（详见 ADR §10）。
>
> ---
>
> **以下原 §5.1-§5.5 子进程 / IPC 转发 / 状态机内容已 archived 到 [`doc/dev/history/mcp-server-backend-rfc-0002/`](../history/mcp-server-backend-rfc-0002/backend-design/README.md)（RFC 0002 决策保留可追溯）**。

---

## 6. 前端架构变更

### 6.1 状态扩展

```typescript
// src/contexts/session/types.ts 扩展
export interface Session {
  // 现有字段...
  // NEW:
  attached?: AttachState | null;
  mcpSessionId?: string;
}

// NEW: src/contexts/AttachContext.tsx
// 维护 attach 状态 + banner UI + AI 接管按钮触发
```

### 6.2 新组件

| 文件 | 职责 |
|---|---|
| `components/ai/AiTakeoverButton.tsx` | "🤖 AI 接管" 按钮（M7） |
| `components/ai/AiTakeoverBanner.tsx` | 顶部 banner（M7） |
| `components/ai/AiTakeoverConfig.tsx` | 释放口令配置（M7） |
| `components/mcp/McpConfig.tsx` | TCP 端点开关 + token 重置（M6） |
| `components/mcp/McpTunnelScripts.tsx` | 生成反向 SSH 脚本（M8） |
| `components/dialogs/PathUrlDetector.tsx` | 选中即悬浮按钮（M4） |
| `hooks/useAttachState.ts` | attach state 订阅（与 useTauriListeners 并列）|
| `hooks/useSubscribeOutput.ts` | MCP 模式下的序号管理（M6）|
| `hooks/useWaitFor.ts` | pattern 匹配（M6）|

### 6.3 主题与快捷键可配

- **主题**：现有 `ThemeContext` + 5 个 ANSI 预设，**新增 shell chrome 主题**（按 design-system.md）；通过 `settings.json` (theme 字段) 切换。
- **快捷键可配**：引入 `src/config/keymap.ts`，把硬编码的快捷键提到 `settings.json`（keybindings 字段），运行时读取。详见 03 §P1-3。

---

## 7. 关键接口契约（MCP tools — 实现骨架）

### 7.1 `list_sessions`

```rust
// mcp_server/tools/list_sessions.rs
#[derive(Deserialize, JsonSchema)]
pub struct ListSessionsParams {
    #[serde(default)]
    filter: Option<Filter>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    #[serde(rename = "type")]
    type_: Option<String>,  // tab | pane | ssh | wsl | docker | tmux
    profile: Option<String>,
    attached: Option<bool>,
}

pub async fn list_sessions(
    params: ListSessionsParams,
    ctx: &McpContext,
) -> Result<ListSessionsResult, McpError> {
    let manager = ctx.session_manager.clone();
    let sessions = manager.list_with_filter(params.filter);
    Ok(ListSessionsResult { sessions })
}
```

### 7.2 `send_keys`

```rust
// mcp_server/tools/send_keys.rs
#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SendKeysParams {
    pub session_id: String,
    pub text: Option<String>,
    pub keys: Option<Vec<KeySpec>>,
    pub press_enter: Option<bool>,
    pub bracketed: Option<bool>,
    pub delay_ms: Option<u64>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum KeySpec {
    Char { value: String },
    Key { value: KeyName },
    Combo { modifiers: Vec<Modifier>, value: String },
    Raw { bytes: String },  // base64
}

pub async fn send_keys(
    params: SendKeysParams,
    ctx: &McpContext,
) -> Result<SendKeysResult, McpError> {
    // 1. session_id 解析 u32
    let id = ctx.session_manager.lookup_by_mcp_id(&params.session_id)?;
    
    // 2. attach 检查
    ctx.require_attached(id, "send_keys")?;
    
    // 3. 破坏性快捷键检查
    if let Some(ref keys) = params.keys {
        ctx.check_destructive_keys(keys)?;
    }
    
    // 4. 序列化 payload
    let bytes = encode_payload(&params)?;
    
    // 5. 写入
    let bytes_sent = ctx.session_manager.write(id, &bytes)?;
    
    Ok(SendKeysResult {
        delivered: true,
        bytes_sent,
        warnings: None,
    })
}
```

**完整 12 个工具的实现骨架**见 03 §P0-1。

---

## 8. 安全模型

### 8.1 attach 边界

- 用户键盘输入路径在 `Terminal.tsx` 检查 attach 状态（事件 capture 阶段），非 null 直接 `preventDefault` + `stopPropagation`。
- PTY 写入路径在 `SessionManager::write()` 检查 attach 状态：未 attach 的 session 接受 user 写入；已 attach 的 session 只接受 attach agent 的写入。
- 鼠标可选屏蔽（`mcp.attachment_block_mouse: bool`，默认 true）。

### 8.2 MCP 工具权限

| 工具 | 未认证 | 认证 | 限速 | 备注 |
|---|---|---|---|---|
| list_sessions | ✅ | ✅ | 100/s | 只读 |
| create_session | ❌ | ✅ | 100/s | 配额 100 |
| close_session | ❌ | ✅（自己的 session） | 100/s | force 才能关 attach 的 |
| send_keys | ❌ | ✅（attach 自己的） | 100/s | 破坏性键拦截 |
| capture_screen | ❌ | ✅ | 100/s | screenshot 单独限速 1/s |
| subscribe_output | ❌ | ✅ | 100/s | 订阅上限 100/session |
| attach_session | ❌ | ✅ | 100/s | 单 session 单 attach |
| detach_session | ❌ | ✅（自己的） | 100/s | |
| wait_for | ❌ | ✅ | 100/s | timeout_ms ≤ 60000 |
| list_profiles | ❌ | ✅ | 100/s | |
| get_config | ❌ | ✅ | 100/s | 白名单字段 |
| set_config | ❌ | ✅ | 100/s | 白名单字段（v1）|

### 8.3 SSH host key 验证

**当前**：禁用（AGENTS.md 标注为已知 gap）。

**终态**：默认 `ask`（首次连接 prompt，accept 后写入 `%APPDATA%\xsterm\ssh\known_hosts`；变更时警告）。规格 §6.1 C2 要求。

- **实现**：复用 russh-keys 的 `parse_known_hosts` + 写回。`settings.json` (ssh 字段) 控制行为。

### 8.4 反向 SSH tunnel

- 默认关闭；UI 明示"暴露 19847 端口到远端"。
- 远端用户 / 端口白名单（`settings.json` 中 tunnel.allowedRemoteUsers 字段）。
- 文档警告（`docs/security.md`）：暴露给不受信用户的风险。

---

## 9. 持久化 —— ⚠️ RFC 0003-revised：无迁移

### 9.1 启动加载

```
xsterm.exe 启动
  ↓
检查 %APPDATA%\xsterm\settings.json 是否存在
  ├─ 是 → 读 settings key → Settings::deserialize
  └─ 否 → Settings::default()（首次启动）
  ↓
apply_to_subsystems(&settings, &handles)
  ├─ attach_idle_timeout / log_level / ssh_host_key_verify / tunnel_enable
  ↓
return ConfigStore
```

### 9.2 写更新

`tauri-plugin-store` 自身 reactive API：
- frontend `invoke('patch_settings', { patch })` → backend `ConfigStore::write(patch)`
- write 内部 merge + atomic save + apply_to_subsystems + emit `config-reloaded` 事件
- **不**监听文件——frontend 是唯一写入入口

schema 校验：
- frontend `service/settings` 用 zod 校验（用户输入前）
- backend `Settings::deserialize` 容忍未知字段（`#[serde(default)]`）

---

## 10. 性能预算（沿用规格 §13）

| 路径 | 预算 | 现状（xsterm） | 终态 |
|---|---|---|---|
| send_keys 延迟 | <10ms | P0-11 已修 | ✅ |
| capture_screen (text) | <50ms | ❌ | 前端 grid 直读 |
| capture_screen (screenshot) | <500ms | ❌ | xterm.js offscreen renderer |
| subscribe_output 推送 | <20ms | ✅（Perf 001 Channel） | + 序号维护开销 <5ms |
| wait_for 平均 | <30ms | ❌ | 基于 subscribe + 内部 regex |
| 内存 100 sessions × 10000 行 | ≤200MB | ⚠️ 单 session 已优化 | OutputRing 100000 行上限 |

---

## 11. 测试策略

| 层 | 工具 | 覆盖目标 |
|---|---|---|
| 单元（Rust） | cargo test + mockall | session_manager / subscribe / attach / capture |
| 单元（TS） | vitest | 已有 paneUtils / pasteConfirm / formParsers / paneContextMenu；新增 detectPathUrl / keymap |
| 协议（MCP） | 自建 mcp-compat suite（`crates/mcp-server/tests/`）| 12 个工具 + 状态机 + 错误码 |
| 集成 | Python `mcp` SDK + 自带 client | stdio + HTTP round-trip |
| TUI 兼容 | vttest（acceptance §A）| ≥90% |
| E2E | WebDriver（现有 smoke.spec.ts 升级）| UI 交互 |
| 性能 | 自建 benchmark（`test/perf/`）| Perf 001-011 回归 |

---

## 12. 文档站结构

```
docs/
├── index.md              # 首页 + 功能截图 + 下载链接
├── quickstart.md         # 5 分钟上手
├── install/
│   ├── windows.md
│   ├── macos.md          # v1.1
│   └── linux.md          # v1.1
├── usage/
│   ├── tabs-panes.md
│   ├── sessions.md       # local / ssh / wsl / docker / tmux
│   ├── copy-paste.md
│   ├── shortcuts.md      # M5 可配
│   └── ai-takeover.md    # M7
├── mcp/
│   ├── index.md          # MCP 总览
│   ├── tools.md          # 12 个工具完整 schema
│   ├── claude-desktop.md # 集成示例
│   ├── cursor.md
│   ├── codex.md
│   └── reverse-tunnel.md # M8
├── security.md           # SECURITY.md
├── privacy-policy.md     # 中英双语
├── contributing.md       # CONTRIBUTING.md
├── changelog.md          # CHANGELOG.md
└── api/                  # auto-generated from mcp-server/schema.rs
```

---

## 13. 失败模式与降级

| 失败 | 检测 | 降级 |
|---|---|---|
| MCP 子进程崩溃 | 主进程持有 Child，wait 返回 | 重启子进程；UI 提示"AI 接管暂不可用" |
| 反向隧道断 | russh reconnect | 指数退避 1/2/4/8/16s × 5 次；UI toast |
| tmux 进程崩 | `tmux-controller-exit` 事件 | UI 显示 retry banner（现有功能）|
| 配置 JSON 反序列化失败 | schema 校验（`#[serde(default)]`） | frontend zod 校验 + backend default 兜底；UI 提示 |
| 订阅 buffer 满 | OutputRing 满 | 发 `output-overflow` 通知 + `full` 快照 |
| attach agent 失联 | stdio EOF / HTTP stream 关闭 | 自动 detach |
| update 下载失败 | HTTP 4xx/5xx | 重试 3 次；UI 提示"稍后重试" |

---

## 14. 不在 MVP 范围（SHOULD/COULD）

| 项 | 推迟到 |
|---|---|
| 标签页分组（工作区嵌套） | v1.1（xsterm 已有 workspaces 概念；可视为部分实现）|
| 会话录像（asciinema 格式） | v1.1（session_log.rs 已有雏形）|
| 主题商店 | v1.1 |
| 跨设备配置同步 | v2 |
| WebAssembly 插件 | v2 |
| 团队协作 | v2 |
| macOS / Linux 移植 | v2 |
| AI 自动生成快捷键 / 主题 | v2 |

---

文档结束。**下一步**：[03-migration-roadmap.md](03-migration-roadmap.md) — 把这些架构落到 PR 切片。