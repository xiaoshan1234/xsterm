# Backend · 顶层架构（唯一权威 README）

> **位置**：`src-tauri/src/` 下的 4 层并列顶层目录
> **关注点**：4 层架构按职责切 module（RFC 0007）
> **目标平台**：Windows 10/11 64-bit（Tauri 2 + WebView2 + ConPTY + MSVC）
> **MCP server 位置**（RFC 0002-revised）：frontend `app/mcp/`

> **文档策略**：本文档是 backend 唯一权威 README。每个 module 配 RESPONSIBILITY / INTERFACE / DOWNSTREAM 3 份契约文档（独立保留）。子 module README 不再单独维护——合入本文档 §5.9。

## 1. 一句话架构

**backend = 4 层 + 0 个独立子系统（MCP server 移到 frontend）**

```
src-tauri/src/
├── commands/         Tauri IPC handlers（按 frontend app module 镜像切 9 个 module）
├── services/         业务编排（按 lifecycle / 状态类型 / 资源切 7 子 module）
├── infrastructure/   平台抽象（按平台能力切 8 module）
└── models/           纯数据 + 类型契约（按 data domain 切 8 module）
```

**对应 frontend 5 层**：
| backend 层 | frontend 对应 | 边界 |
|---|---|---|
| `commands/` | `infra/tauri/commands/*` | 一对一 IPC 函数签名 |
| `services/` | `app/<module>/usecases/*` + `service/<domain>/` | 业务编排 + 跨层状态 |
| `infrastructure/` | `infra/tauri/events/*` + `infra/store/clipboard/logger` | 平台 API 封装 |
| `models/` | `model/<domain>/types/*` | 纯类型契约（serde 镜像 TS 类型） |

## 2. 4 层的职责（RFC 0007 重新划分）

每层内部按职责切 module（不是平铺一个大目录）。每个 module 配 3 份契约 docs（RESPONSIBILITY + INTERFACE + DOWNSTREAM）。

### 2.1 `commands/` — Tauri IPC handlers（9 module 按 frontend 镜像切）

| module | IPC 归属 | frontend 对应 | 状态 |
|---|---|---|---|

| `session.rs` | session 全生命周期（create / close / write / resize / capture_text） | `app/session` | ⭐ 重写 |
| `workspace.rs` | workspace / window / pane / group CRUD | `app/workspace` | ⭐ NEW |
| `terminal.rs` | terminal 显示（resize / cursor / theme） | `app/terminal` | ⭐ NEW |
| `tmux.rs` | tmux -CC（controller / pane / window / script） | `app/terminal` | ⭐ NEW |
| `settings.rs` | settings 持久化（load / save / patch） | `app/settings` | ⭐ NEW |
| `mcp.rs` | MCP attach/state/status/token | `app/mcp` | ⚠️ 简化（4→6 命令） |
| `persistence.rs` | 业务持久化（sessions / groups / attached_tmux）+ settings 扩展 | `service/persistence` | ⭐ 扩展 |
| `logging.rs` | logging（log_message / config） | `infra/logger` | ✅ 现有 |
| `tunnel.rs` | reverse_tunnel 启停 | `app/mcp` | ⭐ NEW |
| `mod.rs` | `all_handlers()` 注册 | — | — |

**职责**：
- 每个 module 1 个 `.rs` 文件，按 IPC 命令名分组
- 每个命令 = 1 个 `#[tauri::command]` 函数 + 配套 types（避免跨命令重复定义）
- 命令本身**不持有状态**——所有状态读 `State<'_, Arc<...>>`

**每个命令的固定结构**：
```rust
#[tauri::command]
pub async fn <name>(
    <入参>: <Type>,
    state: State<'_, Arc<SessionManager>>,  // 或 AttachRegistry / AppHandle 等
    app: AppHandle,
) -> Result<<返回 Type>, String> {
    // 1. 调 services/<lifecycle_submodule>/<fn>
    // 2. 错误转 String（Tauri IPC 标准）
    // 3. 返回 Result<T, String>
}
```

**禁止**：
- 命令内 `tokio::spawn` 长跑任务（调 services）
- 命令持有 `Arc<Mutex/RwLock>`（走 `State`）
- 命令跨 IPC 调用其他命令（共享走 services）
- 命令直跳 `infrastructure/pty/ssh/tmux`（穿过 services 抽象）

详见 §5.9.1。

### 2.2 `services/` — 业务编排（7 子 module 按 lifecycle / 状态类型 / 资源切）

**核心**：services 只保留"真有状态需要集中管理"的 module（RFC 0006 原则）。每个 module 配 3 份契约 docs。

```
src-tauri/src/services/
├── registry/                  注册表类（无 IO，全 DashMap + Atomic + 状态机）
│   ├── session_manager.rs     ⭐ 核心注册表（Arc<SessionManager>）
│   ├── attach_registry.rs     attach 独占状态机（DashMap<u32, AttachState>）
│   ├── subscribe_registry.rs  subscribe OutputRing 全局索引（DashMap<u32, Arc<OutputRing>>）
│   └── profile_registry.rs    profile 缓存（DashMap<String, Profile>）
│
├── lifecycle/                 session 生命周期（spawn / read_loop / close / reconnect）
│   ├── mod.rs                 ⭐ 编排入口（统一 create / close 接口）
│   ├── local.rs               ⭐ local PTY 生命周期
│   ├── ssh.rs                 ⭐ SSH session 生命周期
│   └── tmux.rs                ⭐ tmux controller 生命周期
│
├── output/                    输出流处理（OutputRing 实际拥有者）
│   ├── ring.rs                ⭐ OutputRing 环形缓冲（拆分自原 services/subscribe/）
│   └── publisher.rs           ⭐ subscriber fan-out + 50ms 批处理
│
├── capture/                   screen capture 逻辑（路由 + 各 source 实现）
│   ├── mod.rs                 ⭐ 路由（tmux / OutputRing tail / 未来 offscreen）
│   ├── tmux.rs                ⭐ tmux capture-pane backend
│   └── ansi.rs                ⭐ ANSI 处理（thin wrapper，调 models/capture）
│
├── transport/                 网络传输
│   ├── tunnel.rs              ⭐ reverse_tunnel russh -R + 指数退避（拆分自原 services/reverse_tunnel/）
│   └── http.rs                （future）stdio/TCP bridge（为未来 RFC 0002-revised 升级预留）
│
├── persistence/               持久化业务
│   ├── store.rs               ⭐ tauri-plugin-store wrapper（统一所有 store.json 读写）
│   └── migration.rs           ⭐ JSON 版本迁移（RFC 0003-revised 简化为向后兼容）
│
├── io/                        IO 处理
│   ├── log.rs                 ⭐ session_log 文件 writer（拆分自原 services/session_log.rs）
│   └── wire.rs                ⭐ binary_frame encoding/decoding（移自原 infrastructure/binary_frame.rs）
│
└── audit/                     审计日志（MCP 速率限制 + audit）
    └── mod.rs                 ⭐ AuditLog + rate_limit + token 重生成
```

**职责**：
- `registry/`：无 IO 业务协调器（持有 DashMap / Atomic 状态）
- `lifecycle/`：session 全生命周期（spawn / read_loop / close / reconnect）
- `output/`：OutputRing 实际拥有者（memory buffer 状态）
- `capture/`：screen capture 路由（不同 source 的统一入口）
- `transport/`：网络传输（reverse_tunnel + 未来 HTTP bridge）
- `persistence/`：持久化业务（tauri-plugin-store wrapper + migration）
- `io/`：其他 IO（log writer + binary wire 编码）

**3 问判定 service 是否该存在**（防止过度抽象）：
1. 持有可变状态？（DashMap/Mutex/Atomic/长跑 task）→ service
2. pure function？→ model
3. IO wrapper（包装外部库 API）？→ commands / infrastructure

**friend module 模式**：
- `services/registry/session_manager.rs` 直接读 `attach_registry / subscribe_registry / profile_registry` 字段（friend）
- `services/registry/attach_registry.rs` 等不读 `session_manager.sessions`（走公开 API）

**module 命名规则**（统一）：
| 后缀 | 含义 | 例 |
|---|---|---|
| `_registry.rs` | 注册表（无 IO，DashMap/Atomic） | `attach_registry.rs` |
| `_manager.rs` | 核心协调器 | `session_manager.rs` |
| `_service.rs` | 服务（带 IO） | (future) |
| `local.rs` / `ssh.rs` / `tmux.rs` | lifecycle 子模块（无后缀） | `lifecycle/local.rs` |

**禁止**：
- ❌ 子 module 互相调（除 friend module 通过 Arc 共享）
- ❌ 反向依赖 commands / mcp_server / infrastructure
- ❌ 文件名用 `_session.rs` / `_helper.rs` / `_utils.rs` / `_common.rs`（杂物桶，user profile memory 警告）

详见 §5.9.2。

### 2.3 `infrastructure/` — 平台抽象（8 module 按平台能力切）

| module | 平台依赖 | 现状 |
|---|---|---|
| `pty.rs` | portable-pty + ConPTY/winpty | ✅ 现有 |
| `ssh.rs` | russh + known_hosts + 3 种认证 | ✅ 现有 + RFC 0003-revised 修复 host_key_verify |
| `tmux.rs` | tmux -CC 控制模式 | ✅ 现有 |
| `session_backend.rs` | trait SessionBackend + PtyBackend / SshBackend 适配 | ✅ 现有 + RFC 0006 扩展 capture_* |
| `app_backend.rs` | trait AppBackend + RealAppBackend | ✅ 现有 + RFC 0006 扩展 emit |
| `clipboard.rs` | tauri-plugin-clipboard-manager 包装 | ✅ 现有 |
| `logging_setup.rs` | tracing 初始化 | ✅ 现有（独立 module） |
| `mod.rs` | re-exports | — |

**迁移**：
- ❌ `infrastructure/binary_frame.rs` → 移到 `services/io/wire.rs`（更贴近业务，wire 格式是 OutputRing 的输出格式）

**职责**：
- 平台 API 唯一封装点（ConPTY / winpty / russh / notify / 文件 IO）
- `trait` 边界（`PtySystem` / `SshBackend` / `SessionBackend` / `AppBackend`）让 services 不感知具体平台
- **不持有业务状态**——只持有平台句柄

**禁止**：
- ❌ `infrastructure/*` 调 `services/*` 或 `commands/*`（只被动调用）
- ❌ `infrastructure/*` 持有跨调用可变状态（只持有平台句柄）

### 2.4 `models/` — 纯数据 + 类型契约（8 module 按 data domain 切）

| module | 内容 | 现状 |
|---|---|---|
| `session/` | SessionInfo / SessionType / SessionConfig / 4 Config 子 struct | ⭐ 拆分（1167 行混杂） |
| `workspace/` | Workspace / Window / Group / PaneNode + paneTree 算法 | ⭐ NEW（独立 module） |
| `settings/` | Settings + McpSettings / SshSettings / TunnelSettings | ⚠️ 拆分（混杂） |
| `attach/` | AttachState / AttachSource / McpAttachChangedEvent | ✅ 现有 |
| `subscription/` | RingEntry / SubscribeResult / OutputChunk / OutputOverflowEvent | ✅ 现有 |
| `profile/` | Profile / ProfileType / SessionConfig / SshAuthConfig | ✅ 现有 |
| `capture/` | CaptureMode / CaptureResult / 3 个 pure function | ✅ 现有（RFC 0006 下沉自 services） |
| `mod.rs` | re-exports | ⭐ 重写 |

**删除 / 合并**：
- ❌ `capabilities.rs` 单文件 → 合并到 `session/capabilities.rs`（按归属）
- ❌ `group.rs` 单文件 → 合并到 `workspace/group.rs`（按归属）

**每个 module 内部**：
```
models/<domain>/
├── mod.rs               re-exports + 公开 API（types + events）
├── types.rs             enum + struct 定义
└── events.rs            event 契约（如果有）
```

**关键**：
- `mod.rs` 是**唯一对外入口**（跟 frontend model 一致）
- `types.rs` 是数据 shape 定义
- 共享 serde derive + JsonSchema（MCP schema 用）
- **不持有运行时状态**

**serde 约定**：
- `#[serde(rename_all = "camelCase")]` — 所有 struct / 字段
- `#[serde(default)]` — 每个字段，向前兼容
- `#[serde(skip_serializing_if = ...)]` — Option 字段不输出 None
- `#[serde(tag = "type", rename_all = "lowercase")]` — tagged union（Profile）
- ❌ 不用 `deny_unknown_fields` — JSON 直存容忍前端新字段
- ❌ 不用 JsonSchema — schema 校验在 frontend（zod）

**TS 镜像同步**：
- Rust `Settings` ↔ TS `Settings` interface
- Rust `SessionInfo.attached: Option<AttachState>` ↔ TS `attached?: AttachState | null`
- Rust `SessionInfo.mcp_session_id: Option<String>` ↔ TS `mcpSessionId?: string`
- Rust `Profile` ↔ TS `Profile`（替代旧 SavedSessionConfig）

详见 §5.9.4。

## 3. 依赖方向

```
commands ─┬──► services ──► infrastructure ──► (外部 crate)
          │             ╲
          │              ╰──► models (serde 派生)
          ╰──► models
```

**关键**：
- ✅ `commands/<layer>/<module>` 调 `services/<lifecycle/registry>/<submodule>` + `infrastructure/<module>` + `models/<domain>`
- ✅ `services/<layer>/<submodule>` 调 `infrastructure/<module>` + `models/<domain>`
- ✅ `models/<domain>` 只调 serde / serde_json
- ❌ services 不能依赖 commands
- ❌ infrastructure 不能依赖 commands / services / models 业务
- ❌ models 不能依赖任何业务 crate

**frontend ↔ backend 跨进程**：
- frontend `app/mcp/*` 通过 `invoke()` 调 backend `commands/<module>`（不直接调 `services/<submodule>`）
- frontend `service/*`（zustand store）通过 `infra/tauri/repositories/*` 调 backend `commands/<module>`
- backend 不感知 MCP 协议存在——backend 只看到"frontend 调 IPC"

## 4. 关键设计决策

### 4.1 MCP server 在 frontend app 层（RFC 0002-revised）

```
src/app/mcp/                ⭐ frontend TS 层
├── server.ts               HTTP server + JSON-RPC 2.0
├── tools/                  9 个 MCP 工具实现
├── transport/http.ts       HTTP transport（127.0.0.1:19847 + Bearer token）
├── auth.ts                 Bearer token 验证
├── safety.ts               破坏性快捷键白名单
├── client_state.ts         attach 独占状态（mirror backend attach_registry）
├── context.ts              依赖注入（service store + invoke + emit）
├── types.ts                MCP wire 类型（无 backend 镜像）
└── errors.ts               McpError → JSON-RPC error 映射
```

**为什么 frontend 跑**（RFC 0002-revised）：
- MCP 协议层 = UI 层自然延伸（AI 接管 UX + attach banner + tool log 全在 frontend）
- 直接读 `service/session/store`、`service/workspace/store`（frontend zustand store）—— **0 IPC 成本**
- attach 状态变化直接 emit Tauri event 给 UI banner
- WebView 没有 stdin/stdout，但有 fetch —— HTTP transport 天然适配
- Claude Desktop / Cursor / Codex 都支持 HTTP MCP（2025+ 版本）

**backend 不感知 MCP**：
- ❌ backend 没有 `mcp_server/` module
- ✅ backend 提供 IPC 镜像（`commands/session::write_session` / `commands/session::close_session` / `commands/session::create_session` / `commands/mcp::attach_session` / `commands/mcp::detach_session` / `commands/tunnel::*`）
- frontend MCP 工具 = TS facade over invoke

### 4.2 attach 状态机独立 service（不变）

`services/registry/attach_registry.rs` 是**独立 module**（不被前端 MCP 替代）：
- attach 是产品概念（"AI 独占 session"），跟 session 生命周期正交
- attach 状态机复杂（attach / detach / idle timeout / EOF 自动释放 / 互斥）
- 独立 module 便于 mockall 单测
- frontend MCP attach_session + UI takeover + reverse_tunnel 都通过 `commands/mcp::attach_session` 透传

### 4.3 subscribe / capture 独立 service（不变）

- `services/output/ring.rs` + `publisher.rs` = 环形缓冲 + 序号 + fan-out（**真源在 backend**——PTY/SSH/tmux 后端读循环推 entry）
- `services/capture/` = text / ansi / screenshot 三模式（tmux 走 capture-pane backend 命令；text/ansi fallback 走 OutputRing tail + `models/capture`）
- frontend MCP subscribe_output 通过 `listen('session-output')` + OutputRing 序号管理

### 4.4 config 独立 service（简化：JSON 直存，RFC 0003-revised）

settings.json 读写由 `commands/persistence.rs` 扩展承载：
- ❌ 不再有 `services/config/` module（RFC 0006 下沉）
- `commands/persistence::after_settings_changed` helper 函数（不是 service）
- settings 直存 tauri-plugin-store（每个字段 `#[serde(default)]`）

### 4.5 reverse_tunnel 独立 service（不变）

`services/transport/tunnel.rs` 是**独立 module**：
- russh -R 反向隧道 + 指数退避自动重连
- 远端用户 / 端口白名单
- 端口转发直接复用 frontend MCP HTTP server

### 4.6 SessionManager 扩展（合并自原独立 doc，RFC 0007）

`SessionManager` 是 backend 状态机核心，扩展后结构：

```rust
pub struct SessionManager {
    // ============ 现有字段 ============
    sessions: DashMap<u32, Arc<ActiveSession>>,
    session_id_source: Arc<SessionIdSource>,
    pty_system: Box<dyn PtySystem>,
    ssh_backend: Arc<dyn SshBackend>,
    tmux_controllers: DashMap<u32, Arc<TmuxController>>,
    next_controller_id: AtomicU32,

    // ============ ⭐ RFC 0007 扩展字段 ============
    pub attach_registry: Arc<AttachRegistry>,        // friend with services/registry/attach_registry
    pub subscribe_registry: Arc<SubscribeRegistry>,  // friend with services/registry/subscribe_registry
    pub profile_registry: Arc<ProfileRegistry>,      // friend with services/registry/profile_registry
    pub session_id_index: DashMap<String, u32>,       // mcp_session_id → u32
    pub reverse_index: DashMap<u32, String>,          // u32 → mcp_session_id
    pub quota: Arc<SessionQuota>,
    pub audit_log: Option<Arc<AuditLog>>,
}
```

**位置**：`src-tauri/src/services/registry/session_manager.rs`（RFC 0007 重新划分）

**5 个集成点**：

1. **write() 权限检查**（attach 状态机集成）：
```rust
pub async fn write(
    &self,
    session_id: u32,
    bytes: &[u8],
    caller_client_id: Option<&str>,  // ⭐ 新增参数
) -> Result<(), SessionError> {
    // 1. ⭐ attach 权限检查（双层防御后端层）
    if !self.attach_registry.check_write_permission(session_id, caller_client_id) {
        return Err(SessionError::PermissionDenied);
    }
    // 2. 原有 write 逻辑
    let backend = self.sessions.get(&session_id).ok_or(SessionError::NotFound(session_id))?;
    backend.value().write(bytes).map_err(SessionError::WriteFailed)
}
```

2. **close() 清理**（attach + subscribe + mcp_session_id）：
```rust
pub async fn close(&self, session_id: u32) -> Result<(), SessionError> {
    self.attach_registry.force_detach(session_id);
    self.subscribe_registry.remove(session_id);
    if let Some((_, mcp_id)) = self.reverse_index.remove(&session_id) {
        self.session_id_index.remove(&mcp_id);
    }
    // ... 原有 close 逻辑
    self.quota.release();
    Ok(())
}
```

3. **create_local 注入 OutputRing + mcp_session_id**：
```rust
let session_id = self.session_id_source.allocate();
let mcp_session_id = format!("tab-{}", &Uuid::new_v4().simple().to_string()[..6]);
self.session_id_index.insert(mcp_session_id.clone(), session_id);
self.reverse_index.insert(session_id, mcp_session_id.clone());

let ring = self.subscribe_registry.get_or_create(session_id);
services::lifecycle::local::create(&config, ring.clone())?;
```

4. **mcp_session_id 双向映射**：
```rust
pub fn lookup_by_mcp_id(&self, mcp_id: &str) -> Option<u32>;
pub fn mcp_id_for(&self, u32_id: u32) -> Option<String>;
```

5. **quota 检查**：
```rust
pub fn try_create(&self) -> Result<(), SessionError> {
    let current = self.quota.current.fetch_add(1, Ordering::SeqCst);
    if current >= self.quota.max {
        self.quota.current.fetch_sub(1, Ordering::SeqCst);
        return Err(SessionError::QuotaExceeded);
    }
    Ok(())
}
```

**详细设计**已合并到 [`doc/dev/history/backend-module-restructure-rfc-0007/session_manager_extension.md`](../../history/backend-module-restructure-rfc-0007/session_manager_extension.md)（归档可追溯，RFC 0007 把独立 doc 合并进 backend/README.md §4.6）。

## 5. 子模块设计附录

> **设计原则**：backend 顶层 README 是唯一权威。子 module 不再单独维护 README——所有内容合入此处。每个 module 配 RESPONSIBILITY / INTERFACE / DOWNSTREAM 3 份独立契约文档（保留）。

### 5.1 `commands/` 子模块（9 module，~45 IPC 命令）

| module | 命令数 | 职责 | 关联 services / models |
|---|---|---|---|
| `session.rs` | 23 + 3 NEW | create_local_session / create_ssh_session / create_tmux_session / create_session / write_session / resize_pty_session / resize_ssh_session / close_session / list_sessions / upload_image_to_ssh_session / get_session_output_channel / capture_text / capture_ansi / capture_screenshot | `services/registry/session_manager` + `services/lifecycle/{local,ssh,tmux}` + `models/capture` |
| `workspace.rs` | 5 NEW | create_workspace / close_workspace / rename_workspace / save_workspace / load_workspace / load_last_workspace | frontend 持有 workspace 状态（backend 镜像持久化） |
| `terminal.rs` | 4 NEW | resize_terminal / set_cursor_blink / set_theme / get_terminal_capabilities | `models/session/capabilities` |
| `tmux.rs` | 14 | create_tmux_pane / kill_tmux_pane / create_tmux_window / kill_tmux_window / rename_tmux_window / attach_tmux_session / capture_tmux_pane / get_attached_tmux_servers / auto_attach_tmux_servers / detach_tmux_controller / kill_server_via_controller / unmark_attached_tmux / resize_tmux_pane / probe_tmux_session_exists | `services/lifecycle/tmux` + `services/capture/tmux` |
| `settings.rs` | 3 | load_settings / save_settings / patch_settings | `services/persistence/store` |
| `mcp.rs` | 6 | attach_session / detach_session / get_session_attach_state / list_attached_sessions / mcp_status / regenerate_mcp_token | `services/registry/attach_registry` |
| `persistence.rs` | 6 + 3 | save_sessions / load_sessions / save_groups / load_groups / save_attached_tmux_servers / load_attached_tmux_servers + load_settings / save_settings / patch_settings（`after_settings_changed` 联动） | `services/persistence/store` |
| `logging.rs` | 4 | log_message / get_log_config / set_log_config / get_log_dir | `services/io/log` |
| `tunnel.rs` | 4 NEW | tunnel_start / tunnel_stop / tunnel_status / generate_tunnel_script | `services/transport/tunnel` |
| ~~`config.rs`~~ | ❌ 删除 | RFC 0003-revised：settings 读写由 `persistence.rs` 扩展承载 |

**all_handlers() 入口**（完整 45 命令注册）：见 `commands/mod.rs::all_handlers()` 实现。

### 5.2 `services/` 子模块（7 子 module + 1 audit，按 lifecycle / 状态类型 / 资源切）

| 子 module | 包含 module | 职责 |
|---|---|---|
| `registry/` | `session_manager.rs` / `attach_registry.rs` / `subscribe_registry.rs` / `profile_registry.rs` | 无 IO 业务协调器 + 全 DashMap / Atomic 状态机 |
| `lifecycle/` | `mod.rs` / `local.rs` / `ssh.rs` / `tmux.rs` | session 全生命周期（spawn / read_loop / close / reconnect） |
| `output/` | `ring.rs` / `publisher.rs` | OutputRing 实际拥有者 + 序号 + fan-out |
| `capture/` | `mod.rs` / `tmux.rs` / `ansi.rs` | screen capture 路由（tmux / OutputRing tail / 未来 offscreen） |
| `transport/` | `tunnel.rs` / `http.rs`（future） | 网络传输（reverse_tunnel + 未来 HTTP bridge） |
| `persistence/` | `store.rs` / `migration.rs` | tauri-plugin-store wrapper + JSON 版本迁移 |
| `io/` | `log.rs` / `wire.rs` | session_log 文件 writer + binary_frame encoding |
| `audit/` | `mod.rs` | AuditLog + rate_limit + token 重生成 |

**module 命名规则**（统一）：
| 后缀 | 含义 | 例 |
|---|---|---|
| `_registry.rs` | 注册表（无 IO） | `attach_registry.rs` |
| `_manager.rs` | 核心协调器 | `session_manager.rs` |
| `local.rs` / `ssh.rs` / `tmux.rs` | lifecycle 子模块（无后缀） | `lifecycle/local.rs` |
| 禁止 | `_session.rs` / `_helper.rs` / `_utils.rs` / `_common.rs` | （杂物桶） |

**3 问判定**：
1. 持有可变状态？→ service
2. pure function？→ model
3. IO wrapper？→ commands / infrastructure

### 5.3 `infrastructure/` 子模块（8 module，按平台能力切）

| module | 平台依赖 | 职责 | 现状 |
|---|---|---|---|
| `pty.rs` | portable-pty + ConPTY/winpty | PTY 句柄创建 + 读写 | ✅ |
| `ssh.rs` | russh + known_hosts + 3 种认证 | SSH 连接 + key 验证 | ✅ + RFC 0003-revised 修复 |
| `tmux.rs` | tmux -CC 控制模式 | tmux controller + parser + dispatch | ✅ |
| `session_backend.rs` | trait SessionBackend | 抽象后端接口 + capture 扩展 | ✅ + RFC 0006 |
| `app_backend.rs` | trait AppBackend | Tauri AppHandle 抽象 + emit 扩展 | ✅ + RFC 0006 |
| `clipboard.rs` | tauri-plugin-clipboard-manager | 剪贴板读写 | ✅ |
| `logging_setup.rs` | tracing + tracing-subscriber | tracing 初始化 | ✅ 独立 module |
| `mod.rs` | re-exports | — | — |

**迁移**：
- ❌ `infrastructure/binary_frame.rs` → `services/io/wire.rs`（更贴近 OutputRing 业务层）

### 5.4 `models/` 子模块（8 domain，按数据 domain 切）

| module | 内容 | 内部结构 |
|---|---|---|
| `session/` | SessionInfo / SessionType / SessionConfig / 4 Config 子 struct / Capabilities | `mod.rs` + `types.rs` + `info.rs` + `config.rs` + `capabilities.rs`（拆分原 1167 行混杂） |
| `workspace/` | Workspace / Window / Group / PaneNode | `mod.rs` + `types.rs` + `rules/paneTree.rs` |
| `settings/` | Settings + McpSettings / SshSettings / TunnelSettings | `mod.rs` + `types.rs` |
| `attach/` | AttachState / AttachSource / McpAttachChangedEvent | `mod.rs` + `types.rs` + `events.rs` |
| `subscription/` | RingEntry / SubscribeResult / OutputChunk / OutputOverflowEvent | `mod.rs` + `types.rs` + `events.rs` |
| `profile/` | Profile / ProfileType / SessionConfig / SshAuthConfig | `mod.rs` + `types.rs` |
| `capture/` | CaptureMode / CaptureResult / 3 pure function | `mod.rs` + `text.rs` + `ansi.rs` + `screenshot.rs` |
| `mod.rs` | re-exports | — |

**删除 / 合并**：
- ❌ `capabilities.rs` 单文件 → `models/session/capabilities.rs`
- ❌ `group.rs` 单文件 → `models/workspace/group.rs`

**每个 module 内部约定**：
```
models/<domain>/
├── mod.rs               re-exports（对外唯一入口）
├── types.rs             enum + struct 定义
└── events.rs            event 契约（如果有）
```

## 6. 跨语言 wire 契约

**前端 TS ↔ Rust 同步规则**：

| Rust 类型 | TS 镜像 | 同步工具 |
|---|---|---|
| `#[derive(Serialize, Deserialize)]` struct | `interface X` | 手写（现状，ts-specta 未启用） |
| `#[tauri::command] fn` 签名 | `invoke<T>(name, args)` | 手写（IPC 契约见 `commands/<module>/INTERFACE.md`） |
| `app.emit(name, payload)` | `listen<T>(name, cb)` | 事件契约见 `infrastructure/events/CONTRACT.md` |
| `models::config::Settings` | `Settings` interface | serde_json 序列化 |

**Rust 事件名**（emit → frontend listen）：

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

## 7. 关键流程

### 7.1 启动序列（backend）

```
lib.rs::run()
    ↓
tauri::Builder::default()
    ├── plugin(tauri_plugin_opener::init())
    ├── plugin(tauri_plugin_store::Builder::...) // 过渡期 store
    ├── plugin(tauri_plugin_clipboard_manager)
    ├── manage(Arc<SessionManager>)              // 核心注册表（dashmap 化）
    ├── setup(|app| {
    │       // 1. logging
    │       let log_dir = app.path().app_log_dir()?;
    │       let config = services::io::log::load_log_config(app.handle())?;
    │       cleanup_old_logs(&log_dir, ...);
    │       let reload_handle = init_logging(&log_dir, &config);
    │       app.manage(Arc::new(reload_handle));
    │
    │       // 2. ⭐ services/persistence::store 加载（tauri-plugin-store）
    │       let store = services::persistence::store::ConfigStore::load(app.handle())?;
    │       app.manage(Arc::new(store));
    │
    │       // 3. ⭐ OutputChannel 注册
    │       let backend = RealAppBackend::new(app.handle().clone());
    │       let channel = backend.session_output_channel.clone();
    │       app.manage(Arc::new(backend));
    │       app.emit("session-output-channel", channel)?;
    │
    │       // 4. ⭐ reverse_tunnel 自动重连（如果 enabled）
    │       services::transport::tunnel::start_if_enabled(...);
    │
    │       // ⚠️ 不再有 mcp_server::start()——MCP server 由 frontend app/mcp 启动
    │   })
    ├── invoke_handler(commands::all_handlers())
    └── run(generate_context!())
```

**frontend 启动序列**（`app/shell::usecases/initialize.ts`）：
```
1. invoke('shell_initialize_logging')      // backend logging
2. listen('session-output', handler)       // backend BinaryFrame 推流
3. listen('mcp-attach-changed', handler)   // backend attach 状态广播
4. ⭐ app/mcp/server.ts::startServer(ctx)   // frontend HTTP server 启动
   - 读 settings.json [mcp.http] 决定 port + token
   - spawn HTTP server @ 127.0.0.1:19847
   - register 9 个 MCP 工具
5. app/settings.load() + app/workspace.loadLastWorkspace() + app/terminal.autoAttachTmuxServers()
6. readiness.setReady(true)
```

### 7.2 用户创建 session 流程（完整链路）

```
ui/workspace
    ↓ user clicks "+"
ui/session: shell.openDialog({ kind: "createSession", payload: {...} })
    ↓
app/session/usecases/createLocal.ts
    ↓
1. service/session/createLocal(config)  → invoke('create_local_session', config)
    ↓ Tauri IPC
2. commands/session::create_local_session(config, state)
    ↓ 调
3. services::registry::session_manager::create_local(config, backend)
    ↓
   a. SessionIdSource::allocate() → u32 session_id
   b. mcp_session_id 生成（"tab-7f3a9b"）+ session_id_index 注册
   c. services::registry::subscribe_registry::get_or_create(session_id) → OutputRing
   d. services::lifecycle::local::create(&config, ring.clone()) → PTY handle
      └─ infrastructure::pty::NativePtySystem.open()
   e. backend.spawn(read_loop: ring.push(bytes) + emit_binary(BinaryFrame))
    ↓
4. return SessionInfo { id, name, session_type, capabilities, attached: None, mcp_session_id }
    ↓
5. service/session/store.upsert(sessionInfo)
6. app/session/usecases/openInWorkspace(sessionId, configId, workspaceId)
    ↓
7. app/workspace::openSession(sessionId, configId, workspaceId)
    ↓
ui/workspace: re-render → pane 显示 terminal
```

### 7.3 MCP subscribe_output 流程（frontend TS 实现 + backend 支撑）

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

### 7.4 AI 接管（attach）流程（M7）

```
ui/session: 用户点 "🤖 AI 接管"
    ↓
app/session/usecases/ai_takeover/attach.ts
    ↓
1. invoke('attach_session', { sessionId, clientId: "ui-takeover" })
    ↓ Tauri IPC
2. commands/mcp::attach_session → services::registry::attach_registry::try_attach
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

### 7.5 反向 SSH 隧道流程（M8）

```
config.json [tunnel] enabled = true
    ↓
services::transport::tunnel::start_if_enabled(state)
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

## 8. 强约束（pre-commit 必跑）

```bash
# 1. models 不能 import 业务 crate
grep -rn 'use\s\+crate::\(commands\|infrastructure\|services\)' src-tauri/src/models/
# 必须为空

# 2. infrastructure 不能 import 业务 crate
grep -rn 'use\s\+crate::\(commands\|services\)' src-tauri/src/infrastructure/
# 必须为空（除 RealAppBackend 用 tauri）

# 3. services 不能 import commands（避免反向依赖）
grep -rn 'use\s\+crate::commands' src-tauri/src/services/
# 必须为空

# 4. ❌ 不再有 mcp_server module
find src-tauri/src -name 'mcp_server' -type d
# 必须为空

# 5. attach state 修改只在 services/registry/attach_registry.rs 和 services/registry/session_manager.rs
grep -rn 'attach_state\.insert\|attach_state\.remove' src-tauri/src/ --include='*.rs'
# 必须只出现在上述两个 module

# 6. OutputRing push 只在 services/output/ring.rs 和 services/registry/session_manager.rs
grep -rn 'output_ring.*push\|output_ring.*insert' src-tauri/src/ --include='*.rs'
# 必须只出现在上述两个 module

# 7. settings 写入必须经过 services/persistence/store
grep -rn 'config_store\.write\|config\.write' src-tauri/src/ --include='*.rs' | grep -v 'services/persistence/store'
# 必须为空（写入只通过 services/persistence/store 内部）

# 8. ❌ frontend MCP 不能直连 PTY/SSH/tmux
grep -rnE 'portable_pty|russh::|TmuxController' src/app/mcp/ --include='*.ts'
# 必须为空（MCP 通过 invoke 间接）

# 9. ❌ frontend MCP 不直读 SessionManager 字段
grep -rnE 'session_manager\.(sessions|tmux_controllers|attach_state|output_rings)\.(get|iter)' src/app/mcp/
# 必须为空（必须通过 service/* 公开 API）

# 10. ❌ 禁止的文件名（杂物桶检测）
grep -rn 'fn _helper\|fn _utils\|fn _common\|mod _session' src-tauri/src/ --include='*.rs'
# 必须为空

# 11. ❌ 禁止反向跨层依赖
grep -rn 'use\s\+crate::commands' src-tauri/src/services/
grep -rn 'use\s\+crate::services' src-tauri/src/infrastructure/
grep -rn 'use\s\+crate::infrastructure' src-tauri/src/models/
# 必须都为空
```

## 9. 测试策略

| 层 | 工具 | 覆盖目标 |
|---|---|---|
| **models/** | cargo test | serde roundtrip + JsonSchema |
| **services/registry/session_manager** | cargo test + mockall | 已有覆盖；扩展 attach / subscribe / profile |
| **services/registry/attach_registry** | cargo test + mockall | 状态机 + idle timeout + 互斥 |
| **services/output/ring + publisher** | cargo test | OutputRing 满 + seq 连续 + 多 subscriber |
| **services/capture** | cargo test | text / ansi 模式剥离 + tmux 路由 |
| **services/persistence** | cargo test + tempfile | JSON roundtrip + migration |
| **services/transport/tunnel** | 集成测试（需 sshd） | 5 次重连 + token 鉴权 |
| **services/lifecycle/{local,ssh,tmux}** | cargo test + mockall | spawn / read_loop / close |
| **commands/** | cargo test（mock state） | 每个命令的 happy path + 错误分支 |
| **infrastructure/** | cargo test | pty open + ssh 连接 + binary_frame roundtrip |
| **frontend app/mcp/** | vitest | 9 工具 + JSON-RPC 2.0 协议 + auth + safety |
| **frontend app/mcp/**（集成） | Python MCP client | HTTP round-trip + Claude Desktop 配置模拟 |
| **集成（end-to-end）** | Python MCP SDK + 自带 client | HTTP round-trip + AI 接管 UX |
| **TUI 兼容** | vttest | ≥ 90% |

## 10. 性能预算

| 路径 | 预算 | 现状 | 终态 |
|---|---|---|---|
| `create_local_session` 启动到返回 | < 200ms | ✅ ~150ms | 同 |
| `write_session` 延迟 | < 10ms | ✅ Perf 004 已修 | 同 |
| `session-output` 事件推送 | < 20ms | ✅ Perf 001 | + OutputRing push < 5ms |
| `subscribe_output` MCP HTTP 通知 | < 50ms | ❌ 新建 | HTTP SSE + BinaryFrame 解析 |
| `capture_screen (text)` | < 50ms | ⚠️ 仅 tmux | 前端 service/session/output_buffer 直读 + 后端 trait fallback |
| `capture_screen (screenshot)` | < 500ms | ❌ | xterm.js offscreen renderer |
| `attach_session` 状态切换 | < 20ms | ❌ 新建 | DashMap CAS + emit |
| `attach idle timeout` 检测 | < 1s drift | ❌ | tokio::time::interval 60s |
| **frontend MCP HTTP server start** | < 500ms | ❌ 新建 | Tauri WebView 内 fetch server |
| **MCP HTTP tool call 延迟** | < 5ms | n/a | invoke IPC 单跳 |
| `settings.json` reload | 即时（store API 同步） | ⚠️ | ⚠️ 无文件监听——frontend 是唯一写入入口 |
| 100 sessions × 10k 行 ring | ≤ 200MB | ⚠️ 单 session | OutputRing 100k 行上限 |
| 反向隧道重连 | ≤ 5 次指数退避 | ❌ | 1/2/4/8/16s |

## 11. 安全模型

### 11.1 attach 边界（双层防御）

**前端层**（`Terminal.tsx`）：
- `useEffect` 订阅 `attachState`（来自 `service/session/store`）
- attached → `keydown` 事件 capture 阶段 `preventDefault()` + `stopPropagation()`
- 不依赖 backend 实时校验（避免 IPC 往返延迟）

**后端层**（`services/registry/session_manager::write`）：
- 调 `services::registry::attach_registry::check_write_permission(session_id, caller_client_id)`
- 未 attach → 允许 user 写入
- 已 attach 且 caller == attach_client → 允许（MCP 工具 / UI takeover）
- 已 attach 且 caller != attach_client → 拒绝（user 键盘输入被屏蔽）

### 11.2 MCP HTTP transport 安全

- `127.0.0.1` only（默认）—— 不监听 `0.0.0.0`
- Bearer token 鉴权（强制）
- token 持久化到 `settings.json` (mcp.http.token)
- token regenerate 通过 UI / `invoke('regenerate_mcp_token')`

### 11.3 MCP 工具权限

| 工具 | 未认证 | 已认证 | 限速 | 备注 |
|---|---|---|---|---|
| `list_sessions` | ✅ | ✅ | 100/s | 只读 |
| `create_session` | ❌ | ✅ | 100/s | 配额 100 sessions |
| `close_session` | ❌ | ✅（自己 attach 的） | 100/s | force 才能关 attach 的 |
| `send_keys` | ❌ | ✅（自己 attach 的） | 100/s | 破坏性键拦截 |
| `capture_screen` | ❌ | ✅ | 100/s | screenshot 单独限速 1/s |
| `subscribe_output` | ❌ | ✅ | 100/s | 单 session 订阅上限 100 |
| `attach_session` | ❌ | ✅ | 100/s | 单 session 单 attach（CAS） |
| `detach_session` | ❌ | ✅（自己 attach 的） | 100/s | |
| `wait_for` | ❌ | ✅ | 100/s | timeout_ms ≤ 60000 |

### 11.4 破坏性快捷键白名单

`app/mcp/safety.ts::ALLOWED_DESTRUCTIVE`（frontend TS）：
```typescript
const ALLOWED_DESTRUCTIVE = ["Ctrl+C", "Ctrl+D", "Ctrl+Z", "Ctrl+Break"];
```

其余 `Ctrl+*` / `Alt+*` 组合键默认拒绝。用户可在 `settings.json` (mcp.destructiveKeys.policy = "allow") 开启全部。

### 11.5 SSH host key 验证

**现状**（AGENTS.md 标注）：禁用
**终点**：默认 `ask`（首次连接 prompt，accept 后写入 `%APPDATA%\xsterm\ssh\known_hosts`；变更时警告）
**实现**：复用 `russh-keys::parse_known_hosts` + 写回。`settings.json` (ssh.hostKeyVerify) 控制行为。

### 11.6 settings.json 白名单写入

JSON 直存不需要白名单——frontend UI 是受信的，字段控制暴露在 frontend UI 层（settings 抽屉不暴露敏感字段如 ssh.hostKeyVerify）。

## 12. 依赖（新增）

```toml
# Cargo.toml 新增依赖（attach / subscribe / capture / config / tunnel 5 个新 service）
[dependencies]
tauri-plugin-store = "2"                # ✅ 已有（用于 settings.json / sessions.json 等）
uuid = { version = "1", features = ["v4"] }  # MCP session_id（双向映射）
regex = "1"                             # capture / wait_for 正则
once_cell = "1"                         # 全局单例（rate_limit / metrics）

# ❌ 不再需要 rmcp + schemars（MCP server 移到 frontend TS）
# ❌ 不再需要 toml + notify + notify-debouncer-full（JSON 直存）

[dev-dependencies]
mockall = "0.12"  # 已有
tempfile = "3"    # JSON roundtrip 测试
```

**净变化**（RFC 0002-revised + RFC 0003-revised）：
- ❌ 删除：rmcp, schemars, toml, notify, notify-debouncer-full（5 个 crate）
- ✅ 新增：仅 uuid + regex + once_cell（3 个 crate，已存在或轻量级）
- build time -10%

**frontend `app/mcp/` 新增依赖**（TS）：
```json
{
  "@modelcontextprotocol/sdk": "^1.0",  // 或自研（推荐自研，~200 行 TS）
  "uuid": "^9.0",
  "express": "^4.18"                    // HTTP server（如自研可用浏览器原生 fetch）
}
```

## 13. 文档地图

> **唯一权威**：本文档。子 module README 已合并。每个 module 配 RESPONSIBILITY / INTERFACE / DOWNSTREAM 3 份独立契约文档（不删）。

| 子系统 | 文档 |
|---|---|
| **顶层架构** | **本文档** |
| `services/registry/attach_registry.rs` 详细契约 | [`services/attach/INTERFACE.md`](services/attach/INTERFACE.md) + [`DOWNSTREAM.md`](services/attach/DOWNSTREAM.md) |
| `services/output/ring.rs + publisher.rs` 详细契约 | [`services/subscribe/INTERFACE.md`](services/subscribe/INTERFACE.md) + [`DOWNSTREAM.md`](services/subscribe/DOWNSTREAM.md) |
| `services/transport/tunnel.rs` 详细契约 | [`services/reverse_tunnel/INTERFACE.md`](services/reverse_tunnel/INTERFACE.md) + [`DOWNSTREAM.md`](services/reverse_tunnel/DOWNSTREAM.md) |
| `models/capture.rs` 详细设计 | [`models/capture.md`](models/capture.md) |
| `services/registry/session_manager.rs` 扩展设计 | [`doc/dev/history/backend-module-restructure-rfc-0007/session_manager_extension.md`](../../history/backend-module-restructure-rfc-0007/session_manager_extension.md)（归档） |
| ~~`services/config / capture / config.rs`~~ | ❌ 删除 / 下沉（RFC 0003/0006） |
| ~~`mcp_server/`~~ | 已归档到 `doc/dev/history/mcp-server-backend-rfc-0002/`（RFC 0002 superseded） |
| **frontend 设计** | [`doc/dev/design/frontend/README.md`](../../frontend/README.md)（唯一权威） |

**每个 module 配 3 份契约文档**（独立保留，不在顶层 README）：
- 模块实现 + RESPONSIBILITY.md（职责 + 边界 + 禁止项）
- INTERFACE.md（公开 API + 类型 + 函数签名）
- DOWNSTREAM.md（依赖图 + 强约束 grep）

**每个 module 应补的 3 份文档（待 PR 创建）**：
- `commands/{workspace,terminal,tmux,settings,mcp,tunnel}.rs` 各自 RESPONSIBILITY + INTERFACE + DOWNSTREAM
- `services/registry/{session_manager,attach_registry,subscribe_registry,profile_registry}.rs` 各自 3 份
- `services/lifecycle/{local,ssh,tmux}.rs` 各自 3 份
- `services/output/{ring,publisher}.rs` 各自 3 份
- `services/capture/{tmux,ansi}.rs` 各自 3 份
- `services/transport/tunnel.rs` RESPONSIBILITY + DOWNSTREAM（已有 INTERFACE.md）
- `services/persistence/{store,migration}.rs` 各自 3 份
- `services/io/{log,wire}.rs` 各自 3 份
- `services/audit/mod.rs` 3 份
- `infrastructure/{pty,ssh,tmux,session_backend,app_backend,clipboard,logging_setup}.rs` 各自 3 份
- `models/{session,workspace,settings,attach,subscription,profile,capture}/` 各自 3 份

## 14. 跟 PRD / RFC 对应

| PRD 规格 | RFC / 文档 | backend 实现位置 | frontend 实现位置 |
|---|---|---|---|
| §2 M1 标签页 + 分屏 | 现有 | `commands/workspace.rs` + frontend `app/workspace` | |
| §2 M2 5 种环境 | 现有 | `commands/session.rs` + `services/lifecycle/{local,ssh,tmux}` | |
| §2 M3 TUI 完整档 | 现有 | xterm.js + frontend | |
| §2 M4 复制粘贴 | 现有 | xterm.js + frontend | |
| §2 M5 快捷键 | 现有 | frontend keymap | |
| **§2 M6 MCP server** | **RFC 0002-revised** | **attach 状态机**：`services/registry/attach_registry.rs` + `services/output/ring.rs` | **协议层 + 9 工具**：`app/mcp/` |
| **§2 M7 本地 AI 接管** | target-arch §5.5 | **attach 透传**：`commands/mcp::attach_session` | **AI takeover UX**：`app/session/usecases/ai_takeover/` |
| **§2 M8 远程 SSH agent** | target-arch §3.1 (2) | `services/transport/tunnel.rs` + `commands/tunnel.rs` | 端口转发 frontend MCP HTTP |
| **§2 M9 配置 JSON** | RFC 0003-revised | `commands/persistence.rs` 扩展（settings IPC + `after_settings_changed`） | |
| §2 M11 自动更新 | (未来) | frontend + 平台商店通道 | |
| §3 数据流 | PRD §3 | 端到端（PTY → tokio mpsc → Tauri IPC → xterm.js） | |
| §4 数据权限 | RFC + target-arch §8 | **§11 安全模型** | |
| §7.2 MCP attach 流程 | PRD §7.2 | **§7.4 attach 流程** | |
| §7.3 tmux -CC | RFC 0001 | `services/lifecycle/tmux.rs` | |

## 15. 不在 MVP 范围

- macOS / Linux 移植（v2）—— infrastructure/ 抽象层已就位
- 主题商店 / 跨设备同步（v1.1 / v2）—— frontend 关注点
- 会话录像回放（v1.1）—— services/io/log 已雏形
- 自动更新（v1.0）—— frontend + 平台商店通道，不在 backend 设计范围
- WebAssembly 插件（v2）—— services 模块边界足够，未来可加 `services/plugin/`
- MCP stdio transport（v2+ 可选）—— 当前仅 HTTP
- MCP list_profiles / get_config / set_config 3 个工具（v1.0）

## 16. 演进路径

### 16.1 模块重组（v1.0 实施）

- ✅ RFC 0007 module 重新划分（本 RFC）
- ⏳ PR 创建：每个 module 补 3 份契约 docs（按 §13 列表）
- ⏳ 实际代码重构：按新 module 划分移文件 + 改 import path

### 16.2 如果未来要升级 MCP

1. **加 stdio transport**：Tauri sidecar spawn `xsterm-mcp-stdio.exe` + stdio pipe 桥接 frontend HTTP server
2. ~~**加 list_profiles / get_config / set_config**：frontend `app/mcp/tools/` 加 3 个工具~~ —— RFC 0003-revised 删除 set_config；list_profiles / get_config 在 v1.0 可选
3. **拆 crates**：`services/registry/attach_registry` / `services/output/ring` 可独立 crate（独立编译 + 独立单测）
4. **拆 MCP SDK**：自研 ~200 行 TS 已够用，不需要 MCP SDK 依赖

**MCP 协议层**不受影响（`app/mcp/tools` 不变），只改 transport / 工具集。