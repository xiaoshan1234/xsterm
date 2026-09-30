# Backend · 顶层架构

> **位置**：`src-tauri/src/` 下的 4 个并列顶层目录
> **关注点**：4 层架构（business orchestration / view rendering → 不，错了，是 backend 4 层）
> **目标平台**：Windows 10/11 64-bit（Tauri 2 + WebView2 + ConPTY + MSVC）
> **MCP server 已迁到 frontend**：见 [`doc/dev/adr/0002-revised-mcp-frontend.md`](../../adr/0002-revised-mcp-frontend.md)

## 1. 一句话架构

**backend = 4 层 + 0 个独立子系统**

```
src-tauri/src/
├── commands/         Tauri IPC handlers（出站：frontend → backend）
├── services/         业务编排（生命周期 / 状态机 / 跨 layer 协调）
├── infrastructure/   平台抽象（PTY / SSH / tmux / 二进制 wire / 日志）
└── models/           纯数据 + 类型契约（serde 派生）
```

**对应 frontend 5 层**：
| backend 层 | 对应 frontend | 边界 |
|---|---|---|
| `commands/` | `infra/tauri/commands/*` | 一对一 IPC 函数签名（Tauri invoke） |
| `services/` | `app/<module>/usecases/*` + `service/<domain>/` | 业务编排 + 跨层状态 |
| `infrastructure/` | `infra/tauri/*`（events）+ `infra/store/clipboard/logger` | 平台 API 封装 |
| `models/` | `model/<domain>/types/*` | 纯类型契约（serde 镜像 TS 类型） |

**MCP server 位置**（RFC 0002-revised）：
- **协议层** = frontend `app/mcp/`（HTTP server + JSON-RPC 2.0 + 9 个工具）
- **业务状态层** = backend（attach / OutputRing / capture / tunnel）
- frontend MCP server 通过 `invoke()` 调 backend IPC，backend 不感知 MCP 协议存在
- 详见 [`doc/dev/adr/0002-revised-mcp-frontend.md`](../../adr/0002-revised-mcp-frontend.md)

## 2. 4 层的职责

### 2.1 `commands/` — Tauri IPC handlers

```
commands/
├── mod.rs              all_handlers() 聚合入口
├── session.rs          ✅ 已有（create_local_session / write_session / close_session / tmux_*）
├── persistence.rs      ✅ 已有（save_sessions / load_sessions / save_attached_tmux_servers）
├── logging.rs          ✅ 已有（log_message / get_log_config / set_log_config）
├── mcp.rs              ⚠️ 简化（仅 attach_session / detach_session / mcp_status / regenerate_token）
└── tunnel.rs           ⭐ NEW（tunnel_create / tunnel_destroy / tunnel_status）
```

**职责**：
- 每个 `#[tauri::command]` 函数 = 一个 IPC 入口
- 入参 = frontend `invoke(name, args)` 的 `args`
- 返回值 = `Result<T, String>`（Tauri 2 IPC 标准）
- 命令本身**不持有状态**——所有状态读 `State<'_, Arc<...>>`

**`commands/mcp.rs` 简化理由**（RFC 0002-revised）：
- ❌ 删除 MCP 协议层（12 工具实现 + stdio/HTTP transport）—— 移到 frontend
- ✅ 保留 attach / detach 透传（backend `services::attach::AttachRegistry` 是 attach 状态的真相源）
- ✅ 保留 mcp_status / regenerate_token（backend 持有 token + port + enabled 配置）

详见 [`commands/README.md`](commands/README.md)。

### 2.2 `services/` — 业务编排

```
services/
├── mod.rs
├── session_manager.rs    ✅ 现有（核心注册表：sessions / tmux_controllers / attach_state / output_rings）
├── local_session/        ✅ 现有（PTY spawn + bytes 流）
├── ssh_session/          ✅ 现有（russh 连接 + tunnel channel）
├── tmux_session/         ✅ 现有（-CC 控制模式解析 + dispatch）
├── session_log.rs        ✅ 现有（tracing → 文件）
├── attach/               ⭐ NEW（attach 状态机 + 用户键盘屏蔽 + 60min 自动释放）
├── subscribe/            ⭐ NEW（OutputRing 环形缓冲 + 序号生成 + subscriber fan-out）
├── capture/              ⭐ NEW（text / ansi / screenshot 三模式；tmux 走控制器，其他走 xterm grid）
├── config/               ⭐ 简化（RFC 0003-revised：JSON store + 联动更新，无 toml / migration / notify）
└── reverse_tunnel/       ⭐ NEW（russh -R 反向隧道 + 指数退避重连）
```

**职责**：
- 业务编排（生命周期 / 状态机 / 跨 layer 协调）
- 持有可变状态（`DashMap` / `tokio::sync::Mutex` / `AtomicU32` / `AtomicU64`）
- 抽象 trait 边界（`PtySystem` / `SshBackend` / `SessionBackend` / `AppBackend`），便于 mockall 单测

**子模块独立**：
- 每个 service 子模块**单一职责**——attach 只管状态机，subscribe 只管环形缓冲 + 推送，capture 只管屏幕快照
- 跨子模块调用必须通过 `SessionManager` 公开 API（attache state 查 `session_manager.attach_registry()`）

详见 [`services/README.md`](services/README.md)。

### 2.3 `infrastructure/` — 平台抽象

```
infrastructure/
├── mod.rs
├── pty.rs                ✅ 已有（portable-pty 封装 + ConPTY/winpty 适配）
├── ssh.rs                ✅ 已有（russh 0.50 + known_hosts + 密码/私钥/agent 三种认证）
├── tmux/                 ✅ 已有（tmux -CC 控制模式）
├── session_backend.rs    ✅ 已有（trait SessionBackend + PtyBackend + SshBackend 适配）
├── app_backend.rs        ✅ 已有（trait AppBackend + RealAppBackend Tauri 实现）
├── binary_frame.rs       ✅ 已有（0xA1 0x01 wire format 编码/解码）
└── clipboard.rs          ✅ 已有（tauri-plugin-clipboard-manager 包装）
```

**职责**：
- 平台 API 唯一封装点（ConPTY / winpty / russh / notify / 文件 IO）
- `trait` 边界（`PtySystem` / `SshBackend` / `SessionBackend` / `AppBackend`）让 services 不感知具体平台
- **不持有业务状态**——只持有平台句柄

### 2.4 `models/` — 纯数据 + 类型契约

```
models/
├── mod.rs
├── session.rs            ✅ 已有（SessionInfo / SessionType / LocalSessionConfig / ...）
├── capabilities.rs       ✅ 已有（CapabilityFlags）
├── group.rs              ✅ 已有（GroupStore）
├── attach.rs             ⭐ NEW（AttachState / AttachSource / McpAttachChangedEvent）
├── subscription.rs       ⭐ NEW（OutputRing / RingEntry / Subscriber / SubscriptionHandle）
├── profile.rs            ⭐ NEW（Profile / ProfileType / ProfileFilter）
└── config.rs             ⚠️ 简化（Settings + McpSettings / SshSettings / TunnelSettings）
```

**删除**（RFC 0002-revised）：
- ❌ `models/mcp.rs` —— 12 个 MCP 工具的 params/result 类型镜像移到 frontend `model/mcp/types.ts`

**职责**：
- 纯数据 + serde 派生（Serialize / Deserialize）
- **不持有状态**——只描述数据结构
- TS 镜像：每个 Rust struct 必须有对应的 TS interface（约束见 §6）

## 3. 依赖方向

```
commands ─┬──► services ──► infrastructure ──► (外部 crate)
          │             ╲
          │              ╰──► models (serde 派生)
          ╰──► models
```

**关键**：
- ✅ `commands/*` 调 `services/*` 和 `infrastructure/*` 和 `models/*`
- ✅ `services/*` 调 `infrastructure/*` 和 `models/*`
- ✅ `models/*` 只调 serde / serde_json
- ❌ services 不能依赖 commands
- ❌ infrastructure 不能依赖 commands / services / models 业务
- ❌ models 不能依赖任何业务 crate

**frontend ↔ backend 跨进程**：
- frontend `app/mcp/*` 通过 `invoke()` 调 backend `commands/*`（不直接调 `services/*`）
- frontend `service/*`（zustand store）通过 `infra/tauri/repositories/*` 调 backend `commands/*`
- backend 不感知 MCP 协议存在——backend 只看到"frontend 调 IPC"

## 4. 跟现状的对应

| v1 设计目录 | 现状对应 |
|---|---|
| `commands/session.rs` | 现有 `src-tauri/src/commands/session.rs`（已有 23 个命令） |
| `commands/persistence.rs` | 现有（已实现 6 个 store 命令） |
| `commands/logging.rs` | 现有（已实现 4 个 logging 命令） |
| `commands/mcp.rs` | **简化**（仅 attach / detach / mcp_status / regenerate_token；MCP 工具实现移到 frontend） |
| `commands/tunnel.rs` | **NEW**（反向隧道 IPC 暴露） |
| `services/session_manager.rs` | 现有（2717 行，扩展 attach_state + output_rings + subscribers） |
| `services/local_session/` | 现有 |
| `services/ssh_session/` | 现有 |
| `services/tmux_session/` | 现有 |
| `services/session_log.rs` | 现有 |
| `services/attach/` | **NEW**（attach 状态机独占实现） |
| `services/subscribe/` | **NEW**（OutputRing + 序号 + 推送） |
| ~~`services/capture/`~~ | **删除**（RFC 0006 —— pure function 下沉到 `models/capture.rs`） |
| ~~`services/config/`~~ | **删除**（RFC 0006 —— 无状态，下沉到 `commands/persistence.rs` 扩展） |
| `services/reverse_tunnel/` | **NEW**（russh -R + 指数退避） |
| `infrastructure/pty.rs` | 现有 |
| `infrastructure/ssh.rs` | 现有（host_key_verify 默认改为 ask） |
| `infrastructure/tmux/` | 现有 |
| `infrastructure/session_backend.rs` | 现有 |
| `infrastructure/app_backend.rs` | 现有 |
| `infrastructure/binary_frame.rs` | 现有 |
| `infrastructure/clipboard.rs` | 现有 |
| `models/session.rs` | 现有（扩展 attached / mcp_session_id 字段） |
| `models/capabilities.rs` | 现有（扩展 image_protocol / unicode11） |
| `models/group.rs` | 现有 |
| `models/attach.rs` | **NEW** |
| `models/subscription.rs` | **NEW** |
| `models/profile.rs` | **NEW** |
| `models/config.rs` | **NEW** |
| ~~`models/mcp.rs`~~ | **删除**（移到 frontend `model/mcp/types.ts`） |
| ~~`mcp_server/`~~ | **删除**（移到 frontend `app/mcp/`） |

**注意**：`commands/persistence.rs` 现有功能**保留**（sessions / groups / attached_tmux），**新增** `save_settings / load_settings / patch_settings` 接 frontend service/persistence。详见 [`backend/commands/README.md §3.4`](commands/README.md) IPC 契约 + `models/capture.md`（capture 算法层）。

## 5. 关键设计决策

### 5.1 MCP server 在 frontend app 层（RFC 0002-revised）

```
src/app/mcp/                ⭐ frontend TS 层
├── server.ts               HTTP server + JSON-RPC 2.0
├── tools/                  9 个 MCP 工具实现
├── transport/http.ts       HTTP transport（127.0.0.1:19847）
├── auth.ts                 Bearer token 验证
├── safety.ts               破坏性快捷键白名单
├── client_state.ts         attach 独占状态（mirror backend attach_registry）
├── types.ts                MCP wire 类型（mirror backend models）
└── errors.ts               McpError → JSON-RPC error 映射
```

**为什么 frontend 跑**（RFC 0002-revised）：
- MCP 协议层 = UI 层自然延伸（AI 接管 UX + attach banner + tool log 全在 frontend）
- 直接读 `service/session/store`、`service/workspace/store`（frontend zustand store）—— **0 IPC 成本**
- attach 状态变化直接 emit Tauri event 给 UI banner（不用 backend → frontend event bridge）
- WebView 没有 stdin/stdout，但有 fetch —— HTTP transport 天然适配
- Claude Desktop / Cursor / Codex 都支持 HTTP MCP（2025+ 版本）

**backend 不感知 MCP**：
- ❌ backend 没有 `mcp_server/` module
- ✅ backend 提供 IPC 镜像（`commands/session::write_session` / `commands/session::close_session` / `commands/session::create_session` / `commands/mcp::attach_session` / `commands/mcp::detach_session` / `commands/tunnel::*`）
- frontend MCP 工具 = TS facade over invoke

### 5.2 attach 状态机独立 service（不变）

`services/attach/` 是**独立 module**（不被前端 MCP 替代）：
- attach 是产品概念（"AI 独占 session"），跟 session 生命周期正交
- attach 状态机复杂（attach / detach / idle timeout / EOF 自动释放 / 互斥）
- 独立 module 便于 mockall 单测
- frontend MCP attach_session + UI takeover + reverse_tunnel 都通过 `commands/mcp::attach_session` 透传到 `services::attach::AttachRegistry`

### 5.3 subscribe / capture 独立 service（不变）

`services/subscribe/` 是**独立 module**：
- subscribe = 环形缓冲 + 序号 + fan-out（**真源在 backend**——PTY/SSH/tmux 后端读循环推 entry）
- frontend MCP subscribe_output 通过 `listen('session-output')` + OutputRing 序号管理

**关键**：
- OutputRing 数据**必须在 backend**——不能搬到 frontend（PTY/SSH/tmux 后端读循环是 backend 唯一持有）
- frontend MCP subscribe_output 跟前端 xterm render 共享同一份 backend `session-output` BinaryFrame 事件源

### 5.4 config 独立 service（简化：JSON 直存，RFC 0003-revised）

- tauri-plugin-store JSON 持久化（settings.json / sessions.json 等独立 key）
- 联动更新子系统（attach idle_timeout / log level / ssh host_key_verify / tunnel enable）
- **无 toml / migration / 30 天 .bak / notify 监听** —— frontend 直存，不需要
- toml 加载 + notify 热更新 + 30 天 .bak 回退
- 替代 `tauri-plugin-store`（保留作为过渡期双轨）
- 白名单字段写入（防 frontend 误改敏感配置）

### 5.5 reverse_tunnel 独立 service（不变）

`services/reverse_tunnel/` 是**独立 module**（PRD §2 M8）：
- russh -R 反向隧道 + 指数退避自动重连
- 远端用户 / 端口白名单
- 端口转发直接复用 frontend MCP HTTP server（不需要 MCP server 单独 sidecar）

### 5.6 commands 4 个 module（不变）

现有 `commands/session.rs` 是 662 行单文件——重设计后拆 5 个 module：
- `session.rs` — 现有 23 个命令（保留）
- `persistence.rs` — 现有 6 个 store 命令（保留）
- `logging.rs` — 现有 4 个命令（保留）
- `mcp.rs` — **简化**（仅 attach / detach / mcp_status / regenerate_token，4 个命令）
- `tunnel.rs` — **NEW**（反向隧道 IPC）

### 5.7 models 7 个文件（从 8 减 1）

现有 `models/session.rs` 65KB（含 7 个 enum + 30+ struct）已膨胀。重设计后拆 7 个 module：
- `session.rs` — 现有（精简，attached / mcp_session_id 字段挪到 attach / mcp）
- `capabilities.rs` — 现有（扩展 image_protocol / unicode11）
- `group.rs` — 现有
- `attach.rs` — **NEW**
- `subscription.rs` — **NEW**
- `profile.rs` — **NEW**
- ~~`config.rs`~~ — **删除**（RFC 0003-revised：JSON 直存无需独立 command module；settings 读写由 `commands/persistence.rs` 扩展承载）
- ~~`mcp.rs`~~ — **删除**（移到 frontend）

### 5.8 SessionManager 核心注册表扩展（RFC 0006 合并自原独立 doc）

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

    // ============ ⭐ RFC 0006 扩展字段 ============
    pub attach_registry: Arc<AttachRegistry>,        // friend with services/attach
    pub subscribe_registry: Arc<SubscribeRegistry>,  // friend with services/subscribe
    pub session_id_index: DashMap<String, u32>,       // mcp_session_id → u32
    pub reverse_index: DashMap<u32, String>,          // u32 → mcp_session_id
    pub profiles: DashMap<String, Profile>,
    pub quota: Arc<SessionQuota>,
    pub audit_log: Option<Arc<AuditLog>>,
}

pub(crate) enum ActiveSession {
    Pty(Box<dyn SessionBackend + Send>),
    Ssh(Box<SshSession>),
    Tmux(Box<TmuxPaneHandle>),
}

// ============ SessionBackend trait 扩展 ============
pub trait SessionBackend: Send + Sync {
    // 现有 5 个方法保留
    fn get_session_info(&self) -> &SessionInfo;
    fn get_capabilities(&self) -> CapabilityFlags;
    fn write(&self, data: &[u8]) -> Result<(), String>;
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String>;
    fn close(self: Box<Self>) -> Result<(), String>;
    // ⭐ NEW:
    fn capture_text(&self, start: i32, end: i32, strip_ansi: bool) -> Result<String, String>;
    fn capture_ansi(&self, start: i32, end: i32) -> Result<String, String>;
    fn upload_image(&self, filename: &str, data: &[u8]) -> Result<String, String>;
}
```

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
services::local_session::create(&config, ring.clone())?;
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

**详细设计**已合并到 [`services/session_manager_extension.md`](doc/dev/history/services-simplification-rfc-0006/session_manager_extension.md)（归档可追溯，RFC 0006 把独立 doc 合并进 backend/README.md §5.8）。

## 6. 跨语言 wire 契约

**前端 TS ↔ Rust 同步规则**：

| Rust 类型 | TS 镜像 | 同步工具 |
|---|---|---|
| `#[derive(Serialize, Deserialize)]` struct | `interface X` | 手写（现状，ts-specta 未启用） |
| `#[tauri::command] fn` 签名 | `invoke<T>(name, args)` | 手写（IPC 契约见 `commands/*/INTERFACE.md`） |
| `app.emit(name, payload)` | `listen<T>(name, cb)` | 事件契约见 `infrastructure/events/CONTRACT.md` |
| `models::config::Settings` | `Settings` interface | serde_json 序列化（无 toml） |

**Rust 事件名**（emit → frontend listen）：
| 事件名 | payload 类型 | 何时 emit |
|---|---|---|
| `session-output` | `Vec<u8>`（BinaryFrame） | PTY / SSH / tmux 有新输出 |
| `session-output-channel` | `Channel<Vec<u8>>` | setup 一次，前端 subscribe |
| `session-closed` | `u32`（session_id） | session 关闭 |
| `tmux-events` | `TmuxEvent` 枚举 | tmux 控制模式事件 |
| `mcp-attach-changed` | `{ sessionId, clientId, action }` | MCP attach 状态变化（frontend MCP 工具 attach / detach） |
| `config-reloaded` | `Settings` | settings.json 写后 / 启动加载 |
| `system-theme-changed` | `String` | OS 主题切换 |
| `tunnel-status-changed` | `TunnelStatus` | 反向隧道连接状态变化 |

**前端事件名**（emit → backend listen）：
- 无——frontend 不 emit 给 backend（除非未来 chat 协议）

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
    │       let config = services::config::load_log_config(app.handle())?;
    │       cleanup_old_logs(&log_dir, ...);
    │       let reload_handle = init_logging(&log_dir, &config);
    │       app.manage(Arc::new(reload_handle));
    │
    │       // 2. ⭐ settings.json 加载（tauri-plugin-store）
    │       // settings 读写在 commands/persistence::load_settings/save_settings/patch_settings
    │       // 联动更新在 commands/persistence::after_settings_changed helper
    │
    │       // ⚠️ RFC 0003-revised：无 notify 热更新监听（frontend 是唯一写入入口）
    │
    │       // 4. ⭐ OutputChannel 注册（emit 给前端订阅）
    │       let backend = RealAppBackend::new(app.handle().clone());
    │       let channel = backend.session_output_channel.clone();
    │       app.manage(Arc::new(backend));
    │       app.emit("session-output-channel", channel)?;
    │
    │       // 5. ⭐ reverse_tunnel 自动重连（如果 enabled）
    │       services::reverse_tunnel::start_if_enabled(...);
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
   - 读 settings.json 决定 port + token（tauri-plugin-store）
   - spawn HTTP server @ 127.0.0.1:19847
   - register 9 个 MCP 工具
5. app/session.loadAll() + app/workspace.loadLastWorkspace() + app/terminal.autoAttachTmuxServers()
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
1. service/session/store.createLocal(config)
    ↓ Tauri IPC
2. commands/session::create_local_session(config, state)
    ↓ 调
3. services::session_manager::create_local(config, backend)
    ↓
   a. SessionIdSource::allocate() → u32 session_id
   b. mcp_session_id 生成（"tab-7f3a9b"）+ session_id_index 注册
   c. services::local_session::spawn_pty(shell, cwd, cols, rows)
      → infrastructure::pty::NativePtySystem.open()
      → returns Box<dyn SessionBackend + Send>
   d. backend.spawn(Box::new(move || async {
        // 读 PTY 输出循环
        loop {
            let bytes = reader.read().await?;
            // 1. emit_binary 给 frontend（前端 xterm render）
            backend.emit_binary(encode_session_output_frame(session_id, &bytes))?;
            // 2. ⭐ 同时 push 到 OutputRing（frontend MCP subscribe_output 用）
            services::subscribe::OutputRing::push(session_id, seq, &bytes)?;
        }
    }));
   e. SessionManager.sessions.insert(session_id, Arc::new(ActiveSession::Pty(backend)))
    ↓
4. return SessionInfo { id, name, session_type, capabilities, attached: None, mcp_session_id }
    ↓
5. frontend: service/session/store.upsert(sessionInfo)
    ↓
6. app/session/usecases/openInWorkspace(sessionId, configId, workspaceId)
    ↓
7. app/workspace::openSession(sessionId, configId, workspaceId)
    ↓ 触发 ui/workspace 渲染 pane
```

**关键**：
- backend 不感知是 frontend MCP 创建还是用户点击创建——`SessionManager::create_local` 走同一条路径
- attach 状态从 None 开始（未 attach）

### 7.3 MCP subscribe_output 流程（frontend TS 实现 + backend 支撑）

```
AI agent (Claude Desktop) 通过 HTTP POST http://127.0.0.1:19847/mcp
    Authorization: Bearer <token>
    Body: { "method": "subscribe_output", "params": { "sessionId": "tab-7f3a9b", "sinceSeq": 12345 } }
    ↓
frontend app/mcp/server.ts HTTP handler
    ↓
1. token 验证 (auth.ts)
2. JSON-RPC 2.0 解析 (server.ts)
3. dispatch 到 subscribe_output 工具 (tools/mod.ts)
    ↓
4. app/mcp/tools/subscribe_output.ts:
   a. ctx.resolveSessionId("tab-7f3a9b") → u32 (查 service/session/store)
   b. ctx.requireAttached(session_id, caller_client_id) → 检查本地 mirror state
   c. ⭐ ctx.service_session.subscribeOutput(session_id, since_seq, callback)
      └─ 这是 service/session/api.ts 的新方法
   ↓
5. service/session/bridge.ts:
   - listener 已 listen('session-output', ...)
   - 把 BinaryFrame 解析为 (sessionId, seq, bytes, timestamp)
   - 跟 since_seq 比较，只推 > since_seq 的 entry
   - 通过 callback 推给 app/mcp/tools/subscribe_output
    ↓
6. app/mcp/tools/subscribe_output 推回 MCP client（HTTP SSE / notification）

Backend 支撑：
  - PTY read_loop 推 entry 到 OutputRing + emit_binary(BinaryFrame)
  - 二进制事件由 service/session/bridge 订阅
  - frontend MCP subscribe_output 通过 bridge 间接消费 OutputRing
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
2. commands/mcp::attach_session(sessionId, "ui-takeover", state)
    ↓ 调
3. services::attach::AttachRegistry::try_attach(session_id, AttachSource::Ui { client_id: "ui-takeover" })
    a. 检查 attach_registry.get(session_id)
       → None → 允许
       → Some(other) if other.client_id == "ui-takeover" → 幂等
       → Some(other) → 拒绝（return AlreadyAttached）
    b. attach_registry.insert(session_id, AttachState {
         source: Ui { client_id: "ui-takeover" },
         attached_at_ms: now(),
         last_activity_at_ms: now(),
       })
    c. emit "mcp-attach-changed" 事件（backend → frontend）
    ↓
4. frontend service/session/bridge 收到事件 → 更新本地 mirror state
    ↓
5. ui/session: 渲染 banner "🤖 AI Agent 接管中"
    ↓
6. ui/workspace: PaneHeader 显示 🤖 标识
    ↓
7. Terminal.tsx: useEffect 订阅 attachState，attached → e.preventDefault() + stopPropagation（屏蔽用户键盘）
    ↓
8. ⭐ MCP send_keys 路径：
   frontend app/mcp/tools/send_keys.ts:
     - ctx.requireAttached(session_id, "mcp-client-uuid")
     - safety.isDestructive(keys, policy) 检查
     - bytes 序列化
     - invoke('write_session', { sessionId, data })
   ↓
   backend commands/session::write_session(session_id, data, state)
     - ⭐ attach_registry.check_write_permission(session_id, caller_client_id="mcp-client-uuid")
       → 已 attach 且 caller == attach_client → 允许
     - write to PTY
```

**关键**：
- attach 状态唯一真相源 = backend `services::attach::AttachRegistry`
- frontend MCP 工具 / UI takeover / reverse_tunnel 都通过 `commands/mcp::attach_session` 透传
- frontend 镜像一份 state（`app/mcp/client_state.ts`）只是为了 UI banner 响应即时

### 7.5 反向 SSH 隧道流程（M8）

```
settings.json [tunnel] enabled = true
    ↓
services::reverse_tunnel::start_if_enabled(state)
    ↓ 启动时
1. 加载 config.tunnel.allowed_remote_users + allowed_remote_ports
2. spawn russh client 连 ssh.example.com（用户配置）
3. 在 SSH session 上 open forward channel (-R remote_port:127.0.0.1:local_mcp_port)
4. 监听 child handle 退出 → tokio::select 退出信号
    ↓
AI agent 在 remote 通过 ssh.example.com:remote_port 连入
    ↓ TCP → forward
```

5. reverse_tunnel 检测到新连接 → forward bytes 到 local 127.0.0.1:19847
    ↓
6. ⭐ local frontend MCP HTTP server（app/mcp/server.ts）收到请求
   - frontend HTTP server 跑在 Tauri WebView 内
   - 远端 agent 通过反向 SSH 隧道连到本机 WebView 内的 HTTP server
   - 复用同一份 9 个工具 + Bearer token
    ↓
7. 连接断开 → russh reconnect 指数退避（1/2/4/8/16s × 5 次）
    → 失败则 emit "tunnel-status-changed" → UI toast
```

**关键**：
- 反向 SSH 隧道端口转发直接复用 frontend MCP HTTP server（不需要独立 MCP sidecar）
- 远端 agent 通过 HTTP MCP 接入，配置方式：`http://127.0.0.1:19847` + Bearer token

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

# 5. attach state 修改只在 services/attach/ 和 services/session_manager.rs
grep -rn 'attach_state\.insert\|attach_state\.remove' src-tauri/src/ --include='*.rs'
# 必须只出现在 services/attach/ 和 services/session_manager/

# 6. OutputRing push 只在 services/subscribe/ 和 services/session_manager.rs（PTY/SSH/tmux 后端）
grep -rn 'output_ring.*push\|output_ring.*insert' src-tauri/src/ --include='*.rs'
# 必须只出现在 services/subscribe/ 和 services/session_manager/

# 7. ⚠️ 删除（RFC 0003-revised）——无白名单写入（JSON 直存，frontend UI 受信）

# 8. ❌ frontend MCP 不能直连 PTY/SSH/tmux
grep -rnE 'portable_pty|russh::|TmuxController' src/app/mcp/ --include='*.ts'
# 必须为空（MCP 通过 invoke 间接）

# 9. ❌ frontend MCP 不直读 SessionManager 字段
grep -rnE 'session_manager\.(sessions|tmux_controllers|attach_state|output_rings)\.(get|iter)' src/app/mcp/
# 必须为空（必须通过 service/* 公开 API）
```

## 9. 测试策略

| 层 | 工具 | 覆盖目标 |
|---|---|---|
| **models/** | cargo test | serde roundtrip + schema |
| **services/session_manager** | cargo test + mockall | 已有覆盖；扩展 attache / output_ring |
| **services/attach** | cargo test + mockall | 状态机 + idle timeout + 互斥 |
| **services/subscribe** | cargo test | OutputRing 满 + seq 连续 + 多 subscriber |
| ~~**services/capture**~~ | ~~移到 `models/capture.rs`（pure function）~~ | text / ansi 模式剥离 regex 测试 |
| ~~**services/config**~~ | ~~移到 `commands/persistence.rs` 扩展~~ | JSON roundtrip + forward compat (default) |
| **services/reverse_tunnel** | 集成测试（需 sshd） | 5 次重连 + token 鉴权 |
| **commands/** | cargo test（mock state） | 每个命令的 happy path + 错误分支 |
| **infrastructure/** | cargo test | pty open + ssh 连接 + binary_frame roundtrip |
| **frontend app/mcp/** | vitest | 9 工具 + JSON-RPC 2.0 协议 + auth + safety |
| **frontend app/mcp/** (集成) | Python MCP client | HTTP round-trip + Claude Desktop 配置模拟 |
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

**后端层**（`services::session_manager::write`）：
- 调 `services::attach::check_write_permission(session_id, caller_client_id)`
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

**`list_profiles` / `get_config` / `set_config` 在 v1.0 不做**（frontend 没有 profile 概念、config 改走 settings UI 不走 MCP）。

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

### 11.6 ~~config.toml 白名单写入~~ —— ❌ 删除（RFC 0003-revised）

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

| 子系统 | 文档 |
|---|---|
| 顶层架构 | 本文档 |
| `commands/` | [`commands/README.md`](commands/README.md) |
| `services/` | [`services/README.md`](services/README.md) |
| `services/attach/` | [`services/attach/README.md`](services/attach/README.md) |
| [`services/subscribe/`](services/subscribe/README.md) | OutputRing 详情 |
| ~~[`services/capture/`](services/capture/README.md)~~ | ❌ 下沉到 [`models/capture.md`](models/capture.md)（RFC 0006） |
| ~~[`services/config/`](services/config/README.md)~~ | ❌ 下沉到 [`commands/README.md §3.4`](commands/README.md)（RFC 0006） |
| [`services/reverse_tunnel/`](services/reverse_tunnel/README.md) | 反向 SSH 隧道 |
| `infrastructure/` | [`infrastructure/README.md`](infrastructure/README.md) |
| `models/` | [`models/README.md`](models/README.md) |
| ~~`mcp_server/`~~ | **已归档**到 `doc/dev/history/mcp-server-backend-rfc-0002/backend-design/`（RFC 0002 决策保留可追溯） |
| **frontend MCP** | [`doc/dev/design/frontend/app/mcp/`](../frontend/app/mcp/README.md)（302 行 RESPONSIBILITY + 332 行 INTERFACE + 153 行 DOWNSTREAM） |

## 14. 跟 PRD / RFC 对应

| PRD 规格 | RFC / 文档 | backend 实现位置 | frontend 实现位置 |
|---|---|---|---|
| §2 M1 标签页 + 分屏 | 现有 | `commands/session.rs` + frontend `app/workspace` | |
| §2 M2 5 种环境 | 现有 | `services/{local,ssh,tmux}_session/` | |
| §2 M3 TUI 完整档 | 现有 | xterm.js + frontend | |
| §2 M4 复制粘贴 | 现有 | xterm.js + frontend | |
| §2 M5 快捷键 | 现有 | frontend keymap | |
| **§2 M6 MCP server** | **RFC 0002-revised** | **attach 状态机**：`services/attach` | **协议层 + 9 工具**：`app/mcp/` |
| **§2 M7 本地 AI 接管** | target-arch §5.5 | **attach 透传**：`commands/mcp::attach_session` | **AI takeover UX**：`app/session/usecases/ai_takeover/` |
| **§2 M8 远程 SSH agent** | target-arch §3.1 (2) | `services/reverse_tunnel/` + `commands/tunnel.rs` | 端口转发 frontend MCP HTTP |
| **§2 M9 配置 JSON** | RFC 0003-revised | `commands/persistence.rs` 扩展（settings IPC + after_settings_changed） | |
| §2 M11 自动更新 | (未来) | frontend + 平台商店通道 | |
| §3 数据流 | PRD §3 | 端到端（PTY → tokio mpsc → Tauri IPC → xterm.js） | |
| §4 数据权限 | RFC + target-arch §8 | **§11 安全模型** | |
| §7.2 MCP attach 流程 | PRD §7.2 | **§7.4 attach 流程** | |
| §7.3 tmux -CC | RFC 0001 | 现有 `services/tmux_session/` | |

## 15. 不在 MVP 范围

- macOS / Linux 移植（v2）—— infrastructure/ 抽象层已就位
- 主题商店 / 跨设备同步（v1.1 / v2）—— frontend 关注点
- 会话录像回放（v1.1）—— services/session_log 已雏形
- 自动更新（v1.0）—— frontend + 平台商店通道，不在 backend 设计范围
- WebAssembly 插件（v2）—— services 模块边界足够，未来可加 `services/plugin/`
- MCP stdio transport（v2+ 可选）—— 当前仅 HTTP
- MCP list_profiles / get_config / set_config 3 个工具（v1.0）

## 16. 演进路径

如果未来要升级 MCP：
1. **加 stdio transport**：Tauri sidecar spawn `xsterm-mcp-stdio.exe` + stdio pipe 桥接 frontend HTTP server
2. ~~**加 list_profiles / get_config / set_config**：frontend `app/mcp/tools/` 加 3 个工具~~ —— RFC 0003-revised 删除 set_config（前端 zod + 直存已够）；list_profiles / get_config 在 v1.0 可选
3. **拆 crates**：`services/attach / subscribe` 可独立 crate（独立编译 + 独立单测）
4. **拆 MCP SDK**：自研 ~200 行 TS 已够用，不需要 MCP SDK 依赖

**MCP 协议层**不受影响（`app/mcp/tools` 不变），只改 transport / 工具集。