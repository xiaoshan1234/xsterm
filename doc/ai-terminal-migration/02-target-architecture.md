# xsterm → ai-terminal：目标架构（Target Architecture）

> **目的**：在 01-gap-analysis.md 确定的缺口上，给出 xsterm 演进后的目标架构。这是 dev 实施的契约，tm 验收的依据。
>
> **决策点对应**：本文采用以下推荐（需 pdm / owner 在 README §5 拍板）：
> - **D-α** tmux 实现：保留 `tmux -CC`，规格 M2 简化为"通过 MCP `create_session(type=\"tmux\")` 自动 attach 现有或新建 server"
> - **D-β** MCP server 拆分：`xsterm.exe`（主 UI）+ `xsterm-mcp.exe`（stdio 子进程），单 workspace + 多 binary
> - **D-γ** 配置格式：迁移 `config.toml`（`serde + toml`），启动时一次性迁移旧 store JSON
> - **D-δ** 命名：保留 `xsterm` 品牌，产品对外宣传可叫"AI Terminal"（README 改名 + 商店 listing 名）

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
│       │       │   ├── capture/            # NEW: screen capture
│       │       │   └── config/             # NEW: toml + 热更新
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
│   ├── pty-bridge/               # 抽出 portable-pty（可选，第一阶段不抽）
│   ├── mcp-server/               # 抽出 rmcp 实现（可选；先在 src-tauri 内）
│   ├── ssh-client/               # 抽出 russh（可选）
│   ├── ssh-tunnel/               # NEW: 反向 SSH 隧道
│   ├── config/                   # NEW: toml 配置加载
│   └── updater/                  # NEW: 应用内更新
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

## 3. 数据模型（终态）

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

### 3.2 配置（终态）

**文件路径**：`%APPDATA%\xsterm\config.toml`（D-γ 推荐迁移 toml）

```toml
# 注释友好；启动时由 store JSON 一次性迁移
version = 1

[general]
product_name = "xsterm"
theme = "dark"
default_profile = "pwsh"

[terminal]
font_size = 14
font_family = "Cascadia Code"
scrollback = 10000
copy_on_select = true
bracketed_paste_default = true

[profiles.pwsh]
type = "local"
shell = "pwsh.exe"
cwd = "%USERPROFILE%"

[profiles.ssh-dev]
type = "ssh"
host = "dev.example.com"
port = 22
user = "loner"
auth = "agent"  # password | key | agent

[profiles.wsl-ubuntu]
type = "wsl"
distro = "Ubuntu"

[profiles.docker-node]
type = "docker"
container_id = ""

[mcp]
destructive_keys.policy = "deny"  # deny | ask | allow
idle_timeout_seconds = 3600
audit.enabled = false

[mcp.http]
enabled = false
host = "127.0.0.1"
port = 19847

[ssh]
host_key_verify = "ask"  # NEW：默认开启验证（覆盖 AGENTS.md 标注的"已知 gap"）
known_hosts_path = "%APPDATA%\\xsterm\\ssh\\known_hosts"

[updater]
channel = "github"  # store | github | disabled
auto_check = true

[privacy]
telemetry = false
```

### 3.3 持久化（迁移路径）

| 现有（store JSON） | 终态（toml） | 迁移 |
|---|---|---|
| `sessions.json` (SavedSessionConfig[]) | `config.toml [profiles.*]` | 启动时检测到旧 store → 一次性转换 |
| `settings.json` | `config.toml` | 同上 |
| `groups.json` | `config.toml [groups.*]` | 同上 |
| `attached_tmux.json` | `config.toml [tmux.attached.*]` | 同上 |
| log config | `config.toml [logging]` | 同上 |

**迁移代码位置**：`src-tauri/src/services/config/migration.rs`（NEW）。
**触发**：`lib.rs::run()` 启动时检测 `config.toml` 不存在但 `*.json` 存在 → 调用迁移 → 写 `config.toml` → 保留旧 JSON 30 天后清理。
**回滚**：30 天内用户删除 `config.toml` 即回退到 JSON（用于验证迁移正确性）。

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

### 4.2 终态结构

```rust
// session_manager.rs 扩展
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
    
    // NEW：attach / subscribe / capture 状态
    attach_state: DashMap<u32, AttachState>,           // session_id → AttachState
    output_rings: DashMap<u32, Arc<OutputRing>>,       // session_id → ring buffer
    subscribers: DashMap<u32, Vec<Subscriber>>,         // session_id → N subscribers
    profiles: DashMap<String, Profile>,                 // profile_name → Profile（NEW）
    quota: Arc<SessionQuota>,                          // 100 sessions max
    
    // NEW：审计
    audit_log: Option<Arc<AuditLog>>,                  // mcp.audit.enabled 时启用
}
```

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

### 5.1 子进程入口

```rust
// src-tauri/src/bin/xsterm-mcp.rs (NEW)
use xsterm_lib::mcp_server::{run_stdio, run_http};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("--stdio") => run_stdio(),
        Some("--http") => run_http(),
        _ => {
            eprintln!("Usage: xsterm-mcp --stdio | --http");
            std::process::exit(1);
        }
    }
}
```

### 5.2 MCP server 模块结构

```
src-tauri/src/mcp_server/
├── mod.rs                    # 公开 run_stdio / run_http / shared protocol
├── transport/
│   ├── mod.rs
│   ├── stdio.rs              # JSON-RPC over stdin/stdout
│   └── http.rs               # Streamable HTTP（SSE + Bearer token）
├── ipc/                      # 与主进程通信
│   ├── mod.rs                # 协议定义
│   ├── client.rs             # 子进程侧：发请求到主进程
│   └── server.rs             # 主进程侧：接收 MCP handler 调用
├── tools/
│   ├── mod.rs                # 注册所有工具
│   ├── list_sessions.rs
│   ├── create_session.rs
│   ├── close_session.rs
│   ├── send_keys.rs
│   ├── capture_screen.rs
│   ├── subscribe_output.rs
│   ├── unsubscribe_output.rs
│   ├── attach_session.rs
│   ├── detach_session.rs
│   ├── wait_for.rs
│   ├── list_profiles.rs
│   ├── get_config.rs
│   └── set_config.rs
├── schema.rs                 # JSON Schema（由工具派生）
├── error.rs                  # MCPError → JSON-RPC error code 映射
├── audit.rs                  # 可选审计日志
└── rate_limit.rs             # 100 req/s per MCP session
```

### 5.3 主进程 ↔ MCP 子进程协议

**方向 1**：MCP 子进程 → 主进程（RPC 转发）

```json
{ "kind": "call", "id": 1, "method": "list_sessions", "params": {} }
{ "kind": "response", "id": 1, "result": { "sessions": [...] } }
{ "kind": "response", "id": 1, "error": { "code": "INTERNAL_ERROR", ... } }
```

**方向 2**：主进程 → MCP 子进程（推送通知）

```json
{ "kind": "notify", "method": "session-output", "params": { "session_id": 42, "seq": 12345, "delta": "..." } }
{ "kind": "notify", "method": "session-closed", "params": { "session_id": 42 } }
{ "kind": "notify", "method": "output-overflow", "params": { "session_id": 42, "full": "..." } }
```

**实现**：
- 子进程 stdout 写入 `Arc<Mutex<dyn Write + Send>>`（被 RMCP 的 stdio transport 持有）；子进程再启一个 task 读 stdin（主进程推过来的 notify），dispatch 到本地 `subscriptions` map。
- 主进程持有 `Child` handle；通过 child.stdin 写 notify，通过 child.stdout 读 RPC 响应。**两条 pipe 各自一个 task**。
- 鉴权：stdio 模式靠 OS 进程隔离；HTTP 模式靠 Bearer token（规格 §6.1）。

### 5.4 MCP session_id 命名

规格要求 `"{type}-{uuid_short}"`，例如 `tab-7f3a9b`。xsterm 内部用 u32。

**映射策略**：
- 首次 create / list 时，主进程生成 `uuid_short`（`uuid::Uuid::new_v4().simple()[..6]`）并存到 `SessionInfo.mcp_session_id`。
- MCP 工具收到的 `session_id` 全部按字符串处理；主进程内部维护 `String → u32` 双向 map（`session_id_index: DashMap<String, u32>` + `reverse_index: DashMap<u32, String>`）。
- 持久化（attached_tmux.json / savedConfigs 等）继续用 u32，**不要**持久化字符串 id（避免 id 变化导致存档失效）。

### 5.5 状态机（attach）

```text
(none) ──attach_session──▶ (attached by agent-A)
(attached by agent-A) ──attach_session(force=true)──▶ (attached by agent-B)
(attached) ──detach_session──▶ (none)
(attached) ──close_session──▶ (closed, force-detaches)
(attached) ──idle > 60min──▶ (none, auto-released)
(attached) ──agent EOF──▶ (none, auto-released)
```

**实现位置**：`src-tauri/src/services/attach/mod.rs`
- `attach_state: DashMap<u32, AttachState>` 由 `SessionManager` 持有
- `attach_session(session_id, agent_name)`：CAS 设置；如果已 attach 且不是同一个 agent → `SESSION_ALREADY_ATTACHED`
- 用户键盘输入路径：`Terminal.tsx` 在 `useEffect` 里查 `attachState`，非 null → `e.preventDefault()` + emit toast
- 自动释放：tokio interval 每分钟扫一遍，超过 `idle_timeout_seconds` 强制 detach
- 写入 PTY 时检查：`state.write(session_id, ...)` 如果 `attach_state.get(session_id)` 不是 None 且 agent 是 caller → 允许；其他情况 → 拒（PERMISSION_DENIED）

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

- **主题**：现有 `ThemeContext` + 5 个 ANSI 预设，**新增 shell chrome 主题**（按 design-system.md）；通过 `config.toml [general.theme]` 切换。
- **快捷键可配**：引入 `src/config/keymap.ts`，把硬编码的快捷键提到 `keymap.toml`，运行时读取。详见 03 §P1-3。

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

**实现**：复用 russh-keys 的 `parse_known_hosts` + 写回。`config.toml [ssh]` 控制行为。

### 8.4 反向 SSH tunnel

- 默认关闭；UI 明示"暴露 19847 端口到远端"。
- 远端用户 / 端口白名单（`config.toml [ssh.tunnel.allowed_remote_users]`）。
- 文档警告（`docs/security.md`）：暴露给不受信用户的风险。

---

## 9. 持久化与迁移

### 9.1 数据迁移

```
xsterm.exe 启动
  ↓
检查 %APPDATA%\xsterm\config.toml 是否存在
  ├─ 是 → 加载
  └─ 否 → 检查 *.json
       ├─ 是 → 调 migration::from_store_json() → 写 config.toml → 保留 JSON 30 天
       └─ 否 → 首次启动 → 写默认 config.toml
```

### 9.2 热更新

`notify 6.x` 监听 `config.toml`：
- 修改 → 重新 parse → 通知 SessionManager / SessionContext / ThemeContext
- schema 校验失败 → 拒绝更新 + UI toast（不重启）

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
| 配置 toml 解析失败 | schema 校验 | 拒绝更新；保留旧 config；UI 提示 |
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