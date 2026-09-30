# Services · SessionManager — 扩展设计

> **位置**：`src-tauri/src/services/session_manager.rs`（现有，扩展）
> **职责**：所有 session 生命周期的核心注册表 + attach / subscribe / profile 真相源
> **状态**：现有 2717 行 → 扩展后 ~3500 行（新增 attach / subscribe / profile / audit 字段）

## 1. 终态结构（target-arch §4.2）

```rust
// session_manager.rs —— 扩展现有结构
pub struct SessionManager {
    // ============ 现有字段 ============
    sessions: DashMap<u32, Arc<ActiveSession>>,
    session_id_source: Arc<SessionIdSource>,
    pty_system: Box<dyn PtySystem>,
    ssh_backend: Arc<dyn SshBackend>,
    tmux_controllers: DashMap<u32, Arc<TmuxController>>,
    next_controller_id: AtomicU32,

    // ============ ⭐ NEW: attach / subscribe / profile / audit ============
    pub attach_registry: Arc<AttachRegistry>,
    pub subscribe_registry: Arc<SubscribeRegistry>,
    pub session_id_index: DashMap<String, u32>,       // mcp_session_id → u32
    pub reverse_index: DashMap<u32, String>,           // u32 → mcp_session_id
    pub profiles: DashMap<String, Profile>,
    pub quota: Arc<SessionQuota>,
    pub audit_log: Option<Arc<AuditLog>>,
}

// ============ 现有 enum 扩展 ============
pub(crate) enum ActiveSession {
    Pty(Box<dyn SessionBackend + Send>),
    Ssh(Box<SshSession>),
    Tmux(Box<TmuxPaneHandle>),
    // ⭐ NEW:
    Docker(Box<DockerHandle>),
    TmuxSimple(Box<TmuxSimpleHandle>),
}

// ============ SessionBackend trait 扩展 ============
pub trait SessionBackend: Send + Sync {
    fn get_session_info(&self) -> &SessionInfo;
    fn get_capabilities(&self) -> &CapabilityFlags;
    fn write(&self, data: &[u8]) -> Result<(), String>;
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String>;
    fn close(self: Box<Self>) -> Result<(), String>;
    // ⭐ NEW:
    fn capture_text(&self, start: i32, end: i32, strip_ansi: bool) -> Result<String, String>;
    fn capture_ansi(&self, start: i32, end: i32) -> Result<String, String>;
    fn upload_image(&self, filename: &str, data: &[u8]) -> Result<String, String>;
}
```

## 2. 新增字段详解

### 2.1 `attach_registry: Arc<AttachRegistry>`

详见 [`services/attach/README.md`](../attach/README.md)。

**集成点**：
- `SessionManager::write()` 调 `attach_registry.check_write_permission(session_id, caller_client_id)` 后再写 PTY
- `SessionManager::close()` 调 `attach_registry.force_detach(session_id)` 清理

### 2.2 `subscribe_registry: Arc<SubscribeRegistry>`

详见 [`services/subscribe/README.md`](../subscribe/README.md)。

**集成点**：
- `services/{local,ssh,tmux}_session::read_loop` 调 `output_ring.push(bytes)` 推 entry
- `SessionManager::create_*` 注入 `Arc<OutputRing>` 给后端
- `SessionManager::close()` 调 `subscribe_registry.remove(session_id)` 清理

### 2.3 `session_id_index: DashMap<String, u32>` + `reverse_index: DashMap<u32, String>`

**MCP session_id 双向映射**（target-arch §5.4）：

```rust
pub fn create_session_with_mcp_id(...) -> u32 {
    let u32_id = self.session_id_source.allocate();
    let mcp_id = format!("tab-{}", &Uuid::new_v4().simple().to_string()[..6]);

    self.session_id_index.insert(mcp_id.clone(), u32_id);
    self.reverse_index.insert(u32_id, mcp_id);

    u32_id
}

pub fn lookup_by_mcp_id(&self, mcp_id: &str) -> Option<u32> {
    self.session_id_index.get(mcp_id).map(|r| *r.value())
}

pub fn mcp_id_for(&self, u32_id: u32) -> Option<String> {
    self.reverse_index.get(&u32_id).map(|r| r.value().clone())
}

pub fn remove_session_id_mapping(&self, u32_id: u32) {
    if let Some((_, mcp_id)) = self.reverse_index.remove(&u32_id) {
        self.session_id_index.remove(&mcp_id);
    }
}
```

**关键**：
- u32 继续持久化（attached_tmux.json / savedConfigs）；mcp_session_id **不持久化**
- 重启后 mcp_session_id 重新生成（让 MCP client 重新发现）

### 2.4 `profiles: DashMap<String, Profile>`

详见 [`models/profile.rs`](../../models/profile.md)（未来文档）。

**作用**：把 savedConfigs 缓存为快速查询的 DashMap，避免每次 `list_profiles` 都读 store。

```rust
pub fn upsert_profile(&self, name: String, profile: Profile) {
    self.profiles.insert(name, profile);
}

pub fn get_profile(&self, name: &str) -> Option<Profile> {
    self.profiles.get(name).map(|r| r.value().clone())
}

pub fn list_profiles(&self) -> Vec<Profile> {
    self.profiles.iter().map(|r| r.value().clone()).collect()
}
```

**初始化**：`SessionManager::new()` 后从 `commands/persistence::load_sessions` 加载所有 saved config 到 profiles。

### 2.5 `quota: Arc<SessionQuota>`

```rust
pub struct SessionQuota {
    max_sessions: AtomicU32,        // 默认 100
    current_count: AtomicU32,
}

impl SessionQuota {
    pub fn try_acquire(&self) -> Result<(), SessionError> {
        let current = self.current_count.fetch_add(1, Ordering::SeqCst);
        if current >= self.max_sessions.load(Ordering::SeqCst) {
            self.current_count.fetch_sub(1, Ordering::SeqCst);
            Err(SessionError::QuotaExceeded)
        } else {
            Ok(())
        }
    }

    pub fn release(&self) {
        self.current_count.fetch_sub(1, Ordering::SeqCst);
    }
}
```

**集成点**：`create_*` 前调 `quota.try_acquire()`；`close` 后调 `quota.release()`。

### 2.6 `audit_log: Option<Arc<AuditLog>>`

详见 [`services/audit.rs`](../audit.md)（未来文档）。

**作用**：可选审计日志（settings.json `mcp.audit.enabled` 字段）。记录所有 attach / send_keys / capture_screen 调用，敏感字段 redact（密码 / 私钥路径）。

```rust
pub struct AuditLog {
    inner: Arc<Mutex<VecDeque<AuditEntry>>>,
    enabled: AtomicBool,
    max_entries: usize,             // 默认 1000
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditEntry {
    pub timestamp_ms: u64,
    pub session_id: u32,
    pub tool: String,               // "send_keys"
    pub caller: String,             // "agent-A"
    pub outcome: String,            // "ok" | "rejected"
    pub redacted_args: String,       // "keys=Ctrl+C, text=***"
}
```

## 3. 扩展后的 SessionBackend trait

```rust
pub trait SessionBackend: Send + Sync {
    // 现有 5 个方法保留
    fn get_session_info(&self) -> &SessionInfo;
    fn get_capabilities(&self) -> CapabilityFlags;
    fn write(&self, data: &[u8]) -> Result<(), String>;
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String>;
    fn close(self: Box<Self>) -> Result<(), String>;

    // ⭐ NEW: capture_screen 工具的 fallback（tmux 之外的 path）
    fn capture_text(&self, start: i32, end: i32, strip_ansi: bool) -> Result<String, String>;
    fn capture_ansi(&self, start: i32, end: i32) -> Result<String, String>;

    // ⭐ NEW: image upload (Kitty graphics protocol)
    fn upload_image(&self, filename: &str, data: &[u8]) -> Result<String, String>;
}
```

**实现位置**：
- `LocalBackend`：capture_* 返回空串（推荐走 OutputRing tail fallback）
- `SshBackend`：同 LocalBackend
- `TmuxPaneHandle`：capture_* 调 `tmux capture-pane -p -e -J`
- `DockerHandle`：capture_* 返回空串
- `TmuxSimpleHandle`：调 `tmux capture-pane -t %<pane>`

## 4. 公开 API 边界

### 4.1 SessionManager 公开方法（不变 + 新增）

```rust
impl SessionManager {
    // ============ 现有 ============
    pub fn new() -> Self;
    pub fn create_local(&self, config: LocalSessionConfig, backend: Arc<dyn AppBackend>) -> Result<SessionInfo, SessionError>;
    pub fn create_ssh(&self, config: SSHSessionConfig, backend: Arc<dyn AppBackend>) -> Result<SessionInfo, SessionError>;
    pub async fn create_tmux(&self, config: &TmuxCcConfig, backend: Arc<dyn AppBackend>) -> Result<TmuxSessionInit, SessionError>;
    pub async fn write(&self, session_id: u32, bytes: &[u8], caller_client_id: Option<&str>) -> Result<(), SessionError>;
    pub fn resize(&self, session_id: u32, rows: u16, cols: u16) -> Result<(), SessionError>;
    pub async fn close(&self, session_id: u32) -> Result<(), SessionError>;
    pub fn list(&self) -> Vec<SessionInfo>;
    pub fn get(&self, session_id: u32) -> Option<SessionInfo>;

    // ⭐ NEW: mcp_session_id 映射
    pub fn lookup_by_mcp_id(&self, mcp_id: &str) -> Option<u32>;
    pub fn mcp_id_for(&self, u32_id: u32) -> Option<String>;
    pub fn list_with_filter(&self, filter: Option<Filter>) -> Vec<SessionInfo>;

    // ⭐ NEW: profile（cached）
    pub fn get_profile(&self, name: &str) -> Option<Profile>;
    pub fn list_profiles(&self) -> Vec<Profile>;
    pub fn upsert_profile(&self, name: String, profile: Profile);

    // ⭐ NEW: capture fallback（trait 已经暴露；这里简化调用）
    pub fn capture_text(&self, session_id: u32, lines: u32, strip_ansi: bool) -> Result<String, String>;
    pub fn capture_ansi(&self, session_id: u32, lines: u32) -> Result<String, String>;
}
```

### 4.2 SessionError 新增 variant

```rust
pub enum SessionError {
    // 现有
    NotFound(u32),
    CreateFailed(String),
    WriteFailed(String),
    CloseFailed(String),

    // ⭐ NEW
    PermissionDenied,           // attach 屏蔽 user 写入
    QuotaExceeded,              // 100 session 上限
    AlreadyAttached,            // attach 互斥
    CaptureUnsupported,         // capture_screen 模式不支持
    InvalidConfig(String),      // Profile 校验失败
}
```

## 5. write() 的 attach 检查集成

```rust
pub async fn write(
    &self,
    session_id: u32,
    bytes: &[u8],
    caller_client_id: Option<&str>,
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

**caller_client_id 来源**：
- frontend 调 `write_session` IPC → caller_client_id = None（user 键盘）
- mcp_server 调 `send_keys` → caller_client_id = Some("agent-A")
- mcp_server 调 `write_session` IPC 镜像（M7 UI takeover 释放按钮）→ caller_client_id = Some("ui-takeover")

## 6. close() 的清理

```rust
pub async fn close(&self, session_id: u32) -> Result<(), SessionError> {
    // 1. ⭐ 清理 attach
    self.attach_registry.force_detach(session_id);

    // 2. ⭐ 清理 subscribe ring
    self.subscribe_registry.remove(session_id);

    // 3. ⭐ 清理 mcp_session_id 映射
    if let Some((_, mcp_id)) = self.reverse_index.remove(&session_id) {
        self.session_id_index.remove(&mcp_id);
    }

    // 4. 原有 close 逻辑（drop backend + emit session-closed）
    let entry = self.sessions.entry(session_id);
    match entry {
        Entry::Occupied(o) => {
            let backend = o.remove();
            backend.into_backend().close().map_err(SessionError::CloseFailed)?;
        }
        Entry::Vacant(_) => return Err(SessionError::NotFound(session_id)),
    }

    // 5. ⭐ quota 释放
    self.quota.release();

    Ok(())
}
```

## 7. 创建 session 的新流程

```rust
pub fn create_local(
    &self,
    config: LocalSessionConfig,
    backend: Arc<dyn AppBackend>,
) -> Result<SessionInfo, SessionError> {
    // 1. ⭐ quota 检查
    self.quota.try_acquire()?;

    // 2. 分配 u32 id + mcp_session_id
    let session_id = self.session_id_source.allocate();
    let mcp_session_id = format!("tab-{}", &Uuid::new_v4().simple().to_string()[..6]);
    self.session_id_index.insert(mcp_session_id.clone(), session_id);
    self.reverse_index.insert(session_id, mcp_session_id.clone());

    // 3. ⭐ 获取或创建 OutputRing
    let ring = self.subscribe_registry.get_or_create(session_id);

    // 4. 启动 PTY（注入 ring 给 read_loop）
    let backend_arc = services::local_session::create(&config, ring.clone())?;
    let mut info = backend_arc.get_session_info().clone();
    info.capabilities = backend_arc.get_capabilities();
    info.mcp_session_id = Some(mcp_session_id);  // ⭐ NEW

    // 5. 注册到 sessions map
    self.sessions.insert(session_id, Arc::new(ActiveSession::Pty(backend_arc)));

    Ok(info)
}
```

## 8. 跟其他 service 的关系

| service | 关系 |
|---|---|
| `services/attach` | SessionManager 持有 `Arc<AttachRegistry>` |
| `services/subscribe` | SessionManager 持有 `Arc<SubscribeRegistry>` |
| `services/capture` | `capture::capture_screen` 调 `SessionManager::capture_*` + `subscribe::tail` fallback |
| `services/local_session` | `read_loop` 接收 `Arc<OutputRing>` |
| `services/ssh_session` | 同上 |
| `services/tmux_session` | 同上 + `capture-pane` 直调 |
| `services/config` | `SessionManager::new()` 后从 `commands/persistence::load_sessions` 加载 profiles |
| `mcp_server/*` | 调 `SessionManager::lookup_by_mcp_id / write / close / list_with_filter` |

## 9. 测试策略

```rust
#[tokio::test]
async fn write_blocked_when_attached() {
    let sm = SessionManager::new_for_test();
    let session_id = sm.create_local(test_config(), Arc::new(MockBackend::new())).unwrap().id;

    sm.attach_registry.try_attach(session_id, AttachSource::Mcp {
        client_id: "agent-A".into(),
        ..Default::default()
    }).unwrap();

    // user 写入 → 拒绝
    let result = sm.write(session_id, b"hello", None).await;
    assert!(matches!(result, Err(SessionError::PermissionDenied)));

    // agent 写入 → 允许
    let result = sm.write(session_id, b"hello", Some("agent-A")).await;
    assert!(result.is_ok());
}

#[tokio::test]
async fn quota_exceeded_rejects_new_session() {
    let sm = SessionManager::new_for_test();
    *sm.quota.max_sessions.write() = 2;  // 强制 2

    sm.create_local(test_config(), Arc::new(MockBackend::new())).unwrap();
    sm.create_local(test_config(), Arc::new(MockBackend::new())).unwrap();

    let result = sm.create_local(test_config(), Arc::new(MockBackend::new()));
    assert!(matches!(result, Err(SessionError::QuotaExceeded)));

    // 释放一个后可以再创建
    sm.close(1).await.unwrap();
    let result = sm.create_local(test_config(), Arc::new(MockBackend::new()));
    assert!(result.is_ok());
}

#[tokio::test]
async fn close_cleans_up_attach_and_subscribe() {
    let sm = SessionManager::new_for_test();
    let session_id = sm.create_local(test_config(), Arc::new(MockBackend::new())).unwrap().id;

    sm.attach_registry.try_attach(session_id, AttachSource::Ui {
        client_id: "ui-takeover".into(),
    }).unwrap();

    assert!(sm.attach_registry.get(session_id).is_some());
    assert!(sm.subscribe_registry.get(session_id).is_some());

    sm.close(session_id).await.unwrap();

    assert!(sm.attach_registry.get(session_id).is_none());
    assert!(sm.subscribe_registry.get(session_id).is_none());
}
```

## 10. 性能影响

| 操作 | 当前 | 扩展后 | 影响 |
|---|---|---|---|
| create_local | ~50ms | ~55ms | +5ms (id 分配 + quota + ring 创建) |
| write | <1ms | <1.1ms | +0.1ms (attach check) |
| close | ~10ms | ~12ms | +2ms (清理 attach + subscribe + index) |
| lookup_by_mcp_id | n/a | <0.1ms | DashMap get |

**内存**：
- 每个 session 多 ~500 字节（mcp_session_id + ring handle + attach entry）
- 100 sessions × 500 字节 = 50KB

## 11. 演进路径

如果未来要拆 crates：
- `services/session_manager` → `crates/session-manager/`（核心注册表独立编译）
- `services/attach` → `crates/attach/`（状态机独立单测）
- `services/subscribe` → `crates/subscribe/`（OutputRing 独立单测）

模块边界已经清晰，迁移成本低。

## 12. 文档

- [`README.md`](../../README.md) — backend 顶层（已有 SessionManager 概述）
- [`services/attach/README.md`](../attach/README.md) — attach 状态机
- [`services/subscribe/README.md`](../subscribe/README.md) — OutputRing 详情
- [`services/capture/README.md`](../capture/README.md) — capture 路径
- 现有源码：`src-tauri/src/services/session_manager.rs`（2717 行 → ~3500 行）