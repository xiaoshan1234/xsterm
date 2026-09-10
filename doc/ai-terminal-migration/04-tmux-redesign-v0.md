# xsterm tmux -CC 重设计 v0（待评审）

> **状态**：草案 v0，dev 输出待 tm / pdm 判断
>
> **动机**：现有实现是 Wave 0→6 演进的化石（3622 行 controller.rs + 945 行 dispatch.rs）。Bug 007–022 全是同一个根因——启动握手用"sleep + race + classify body"硬拼，每修一个补一个。18 个 bug 的总数是症状，根因是架构错位。
>
> **目标**：分层 + 一次正确握手 + 协议版本探测 + 单向事件流。本稿**不实现**，只描述架构、模块边界、关键时序、PR 切片。

---

## 0. 设计原则（必须先同意）

| # | 原则 | 现状违反点 |
|---|---|---|
| P1 | **协议层 = 无状态字节流编解码**；**状态机层 = 响应路由 + 视图同步**；**桥接层 = 命令入 + 事件出**。三层不能跨层调用 | controller.rs 同时定义协议字段（escape.rs）、状态机（register_pane）、桥接（emit Tauri event）|
| P2 | **启动握手一次走对**——不允许"发命令→sleep N ms→发下一个命令"。任何"先发 A 再发 B"必须有因果（响应到达 / 状态转移）| Bug 014v2 的 500ms sleep 发 list-windows |
| P3 | **race 一律走 buffered channel**（watch / oneshot + 命令 ID 关联）。禁用 `tokio::sync::Notify` 与裸 `Mutex<Option<...>>` 配合 | Bug 011 → 014 三轮 Notify race |
| P4 | **协议版本探测放第一序列**（`display-message '#{version}'` + `list-commands`），不假设目标 tmux 行为 | Bug 014：默认 `new-session -d` 在 OpenBSD tmux 上立即 exit |
| P5 | **响应解析用"按命令 ID 路由"**，不靠"body 第一字符判断" | Bug 017 dispatch classify 第一行是 `@` 还是 `%` |
| P6 | **事件是单向流**（dispatcher → subscribers），状态改变 = 事件，**不要**让前端拉 | 现状 dispatcher 既 emit 又 await，方向不明 |

---

## 1. 现状（再确认一次，便于理解本稿"为什么这样改"）

### 1.1 文件结构（化石）

```
src-tauri/src/services/tmux/
├── mod.rs                  46 行 — facade
├── commands.rs            376 行 — wire-format builders（OK）
├── controller.rs        3622 行 — 主状态机 + 协议 + 桥接 全糊在一起
├── dispatch.rs           945 行 — 5 层 fallthrough match + classify body
├── escape.rs             236 行 — octal codec（OK）
├── events.rs             159 行 — ControlEvent enum（OK）
└── parser.rs            1067 行 — line → ControlEvent 状态机（OK）
```

### 1.2 controller.rs 的实际职责（看 commit 历史猜）

```
struct TmuxController {
    // 协议层字段
    stdin_tx, stdout_rx          — 与 tmux 进程的 byte pipe
    first_pane_tx, first_pane_rx  — 启动同步（Bug 014 oneshot）

    // 状态机层字段
    pane_bindings: Mutex<HashMap<String, u32>>
    window_bindings: Mutex<HashMap<String, u32>>
    pending_splits: Mutex<VecDeque<oneshot::Sender>>
    pending_windows: Mutex<HashMap<String, PendingWindow>>
    pending_window_pane: Mutex<HashMap<String, PendingWindow>>
    pending_capture: Mutex<HashMap<u32, oneshot::Sender>>
    pending_bootstrap: ...        — Bug 016/017 三轮挣扎残留

    // 桥接层字段
    app_backend: Arc<dyn AppBackend>
    controller_id: u32
}
```

### 1.3 启动握手（现状）

```
spawn tmux -CC -L default new-session -d -x 80 -y 24
  ↓ 100% race
发 refresh-client -C
  ↓ OpenBSD tmux 不识别，Bug 014 v2
改发 new-session -A
  ↓ 创建 session 不创建 window
发 new-window
  ↓ server 不主动推 %window-pane-changed（OpenBSD）
sleep 500ms + 异步发 list-windows
  ↓ %end id=395（new-window 响应的空 begin/end）抢了 oneshot sender
dispatcher classify body 第一行 `@` 还是 `%`
  ↓ emit_window_list 为每个 window 预填 pending_window_pane
emit_pane_list 遍历 entries 注册每个 pane
  ↓ 每个 pane 用 controller.allocate_xsterm_id() 的独立 id
emit tmux-window-added / tmux-pane-added 事件给前端
  ↓ frontend listener 幂等 addSession
await_first_pane resolve
```

**Bug 数量**：18 个连续 bug 修这条线。**根因**：没有"启动协议正确性"概念，每次修补都假设下个版本行为。

---

## 2. 目标架构（重设计 v0）

### 2.1 文件结构（目标）

```
src-tauri/src/services/tmux/
├── mod.rs                       重新组织：re-export facade
│
├── protocol/                    # 协议层（无状态）
│   ├── mod.rs
│   ├── wire.rs                  — wire-format builders（= 旧 commands.rs，名称改 WireProtocol）
│   ├── codec.rs                 — octal codec（= 旧 escape.rs，名称改 Codec）
│   ├── events.rs                — ControlEvent enum（= 旧 events.rs，名称改 ProtocolEvent）
│   ├── parser.rs                — byte stream → ProtocolEvent（= 旧 parser.rs）
│   ├── command.rs               — CommandId + CommandKind + TaggedCommand（NEW）
│   └── version.rs               — NEW: 协议版本探测 + 能力矩阵
│
├── transport/                   # 传输层（byte pipe 抽象）
│   ├── mod.rs
│   ├── backend.rs               — TmuxBackend trait（已有，扩）
│   ├── local.rs                 — local child stdio（已有）
│   └── ssh.rs                   — SSH exec channel（已有）
│
├── controller/                  # 状态机层（响应路由 + 视图同步）
│   ├── mod.rs                   — TmuxController struct（重构：只持有状态机状态）
│   ├── session.rs               — Session 视图：panes / windows / bindings
│   ├── handshake.rs             — NEW: 启动握手序列（用 protocol/version + capability probing）
│   ├── subscriber.rs            — NEW: 订阅者注册（替代 dispatcher 多通道）
│   └── id_map.rs                — NEW: 命令 ID ↔ oneshot/sender 映射（取代多个 pending_* 队列）
│
├── bridge/                      # 桥接层（命令入 + 事件出 → Tauri AppHandle）
│   ├── mod.rs
│   ├── commands.rs              — 高层操作 API（create_session / send_keys / split_window 等）
│   └── events.rs                — 把 SessionView 变化 emit 成 Tauri 事件（"tmux-pane-added" 等）
│
├── errors.rs                    # NEW: 统一错误类型（替换 String + 当前多个 ad-hoc error）
└── tests/                       # 测试
    ├── protocol/
    ├── controller/
    └── e2e/                     — 端到端（需要 tmux 二进制）
```

**关键变化**：
- `controller.rs`（3622 行）拆成 `controller/` 目录（session / handshake / subscriber / id_map），最大单文件 < 600 行
- `dispatch.rs`（945 行）**删除**——其职责拆到 `controller/subscriber.rs`（路由）+ `bridge/events.rs`（emit Tauri 事件）
- `commands.rs` → `protocol/wire.rs`（语义更准：它产 wire payload，不产"命令"）
- 新增 `protocol/version.rs`（协议版本探测）+ `controller/handshake.rs`（启动握手）

### 2.2 数据模型（目标）

```rust
// protocol/command.rs — NEW
pub struct CommandId(u64);  // 单调递增；每个 command 唯一

pub enum CommandKind {
    // 启动握手（顺序固定）
    DisplayVersion,
    ListCommands,
    AttachSession,
    NewWindow,
    ListWindows,
    ListPanes,
    // 运行时操作
    SendKeys { pane_id: String },
    SplitWindow { pane_id: String, direction: Direction },
    NewWindowInCurrent { name: Option<String> },
    KillPane { pane_id: String },
    KillWindow { window_id: String },
    RenameWindow { window_id: String, name: String },
    ResizePane { pane_id: String, cols: u16, rows: u16 },
    CapturePane { pane_id: String, lines: i32 },
    RefreshClient,
    ListSessions,
    DetachClient,
    // 探测 / 自适应
    ProbeProtocolVersion,
}

pub struct TaggedCommand {
    pub id: CommandId,
    pub kind: CommandKind,
    /// wire payload（已 encode 完，可直接写 stdin）
    pub wire: String,
    /// 谁 await 这个命令的结果（None = fire-and-forget）
    pub waiter: Option<ResponseWaiter>,
}

pub enum ResponseWaiter {
    /// 等待 `%begin <id>` .. `%end <id>` 的 body
    BeginEnd(oneshot::Sender<Response>),
    /// 等待特定事件（如 `%session-changed` 通知）
    Event(oneshot::Sender<ProtocolEvent>),
    /// 订阅该 ID 之后的所有 fire-and-forget 通知（用于 list-windows 等长响应）
    Stream(mpsc::UnboundedSender<String>),
}

pub enum Response {
    /// body lines（已 unescape）
    Body(Vec<String>),
    /// 解析失败 / 超时
    Error(String),
}
```

```rust
// controller/session.rs — NEW（替代 pane_bindings + window_bindings + 5 个 pending_*）
pub struct SessionView {
    /// tmux pane id → xsterm session id
    pub panes: HashMap<String, PaneEntry>,
    /// tmux window id → xsterm window id
    pub windows: HashMap<String, WindowEntry>,
    /// 已知的 sessions（attach 后必有一个）
    pub sessions: HashMap<String, SessionEntry>,  // tmux $id → session name
}

pub struct PaneEntry {
    pub xsterm_id: u32,
    pub tmux_window_id: String,
    pub created_at: u64,
    pub is_hidden: bool,
    pub last_output_at: u64,
}

// pub WindowEntry / SessionEntry 略，结构类似
```

```rust
// controller/id_map.rs — NEW（替代 pending_splits / pending_windows / pending_window_pane / pending_capture）
pub struct CommandRegistry {
    /// CommandId → response waiter（不区分"split 等待"还是"capture 等待"——都是"等我发的 command id 的 %begin..%end"）
    by_command: HashMap<CommandId, ResponseWaiter>,
    /// Oneshot sender 用于 fire-and-forget 命令之外的事件订阅（如 await_first_pane 用专用 marker）
    subscriptions: SubscriptionSet,
    next_id: AtomicU64,
}
```

```rust
// protocol/version.rs — NEW
pub struct TmuxProtocolVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: Option<u32>,
    /// 通过 `list-commands` 输出推断的能力
    pub capabilities: CapabilityMatrix,
}

pub struct CapabilityMatrix {
    pub supports_new_session_dash_a: bool,         // `new-session -A`
    pub supports_refresh_client_dash_C: bool,      // `refresh-client -C`（无参）
    pub supports_refresh_client_dash_C_flag: bool, // `refresh-client -C 1`
    pub auto_pushes_window_pane_changed: bool,     // 创建 window 后是否推 %window-pane-changed
    pub supports_attach_session_dash_c_empty: bool,// `attach-session -c ""`
    pub uses_dcs_passthrough: bool,                // SSH exec 路径是否用 DCS 包裹
    pub quotes_arguments: bool,                    // command 是否需要 quote
}
```

### 2.3 启动握手（目标）

**核心**：协议版本探测放第一序列，**一次走对**。

```
seq 1. display-message -p -t '' '#{version}'
       → body 单行：版本号
       → 解析为 TmuxProtocolVersion
       → 同时探测 capabilities（如果 version >= 3.4 假设 supports_* 默认开）

seq 2. 决策：根据 capability matrix 选 attach 序列
       - 新版本（auto_pushes_window_pane_changed=true）：
         attach-session -t "" -c ""    (一步 attach)
         + refresh-client -C           (绑定 control client)
       - 老版本（auto_pushes_window_pane_changed=false）：
         attach-session -t ""
         + refresh-client -C 1
         + list-windows                (主动查，因为 server 不推)
         + list-panes -a               (主动查所有 panes)
       - 极老版本（不支持 -A）：
         new-session -d                (新 session，detach)
         + attach-session
         + new-window                  (必须主动开 window)

seq 3. server 推 %begin %end（command 响应）+ %session-changed / %window-add / %window-pane-changed（事件）
       - dispatcher 按 command ID 路由 %begin..%end
       - 按 ProtocolEvent 类型更新 SessionView + emit Tauri 事件

seq 4. await_first_pane：oneshot::Sender 在 SessionView.panes 第一次 insert 时 fire
```

**关键不变量**：
- `handshake.rs::HandshakeState::new()` 状态机只走一次
- 每个 seq 都 await 自己的 command ID 的 `%begin..%end`
- 序列中所有 await 都用 `tokio::time::timeout(5s)` 保护
- 失败回退：每一步失败 → 尝试备选序列（cfg 矩阵里的 fallback）

### 2.4 响应路由（替代 5 层 fallthrough）

```
# 现状（dispatch.rs:100）
match WindowPaneChanged {
    1. pane_bindings 已有 → ignore
    2. pending_splits 非空 → 是 split-window 的回复
    3. pending_window_pane 有 entry → 是 bootstrap / new-window 的回复
    4. legacy bootstrap fallback
    5. 外部 pane → log only
}
```

**重写**：按"事件 vs 命令响应"二分

```rust
// controller/mod.rs 精简后
pub struct TmuxController {
    // transport（字节流）
    backend: Arc<dyn TmuxBackend>,
    stdin_tx: UnboundedSender<TaggedCommand>,

    // 状态
    view: Arc<Mutex<SessionView>>,
    registry: Arc<Mutex<CommandRegistry>>,
    handshake: Arc<Mutex<HandshakeState>>,
    protocol_version: OnceCell<TmuxProtocolVersion>,

    // 桥接（事件出口）
    bridge: Arc<dyn TmuxBridge>,
    controller_id: u32,
}

// 处理字节流（来自 reader task）的统一入口
async fn on_bytes(bytes: Vec<u8>, ...) {
    let mut parser = ProtocolParser::new();
    let events = parser.feed(&bytes);  // → Vec<ProtocolEvent>

    for event in events {
        match classify_event(event) {
            EventClass::CommandBegin(cmd_id) => registry.lock().on_begin(cmd_id),
            EventClass::CommandBody(cmd_id, line) => registry.lock().on_body(cmd_id, line),
            EventClass::CommandEnd(cmd_id) => {
                let waiter = registry.lock().take_waiter(cmd_id);
                match waiter {
                    Some(ResponseWaiter::BeginEnd(tx)) => tx.send(Response::Body(accumulated)),
                    Some(ResponseWaiter::Event(tx)) => tx.send(event),  // 等特定事件
                    Some(ResponseWaiter::Stream(tx)) => tx.send(accumulated_line),
                    None => { /* 没人等的命令（fire-and-forget）→ 走 classify */ }
            }
            EventClass::Notification(event) => handle_notification(event).await,
            EventClass::Unknown(line) => tracing::warn!("unknown protocol line: {}", line),
        }
    }
}

// 通知（非命令响应）走单一路径：更新 SessionView + 通知 subscribers
async fn handle_notification(event: ProtocolEvent) {
    match event {
        ProtocolEvent::Output { pane_id, data } => {
            if let Some(entry) = view.lock().panes.get(&pane_id) {
                bridge.emit_output(entry.xsterm_id, data);
            }
        }
        ProtocolEvent::WindowAdd { window_id, name } => {
            let xsterm_window_id = view.lock().windows.insert(window_id.clone(), ...);
            bridge.emit_window_added(window_id, xsterm_window_id, ...);
        }
        ProtocolEvent::WindowPaneChanged { window_id, pane_id } => {
            // 唯一的"是不是 split-result"判断：registry 是否有 waiter for some command_id?
            // 简化：用 send-keys / split-window 等操作发出去前 register 一个 marker；
            // 这里不靠"5 层 fallthrough"区分
            let is_split_result = registry.lock().is_split_in_flight();
            if is_split_result {
                let entry = view.lock().panes.entry(pane_id.clone()).or_insert_with(...);
                entry.tmux_window_id = window_id.clone();
                bridge.emit_pane_added(...);
            } else {
                view.lock().panes.insert(pane_id.clone(), PaneEntry::new(...));
                view.lock().windows.get_mut(&window_id).map(|w| w.active_pane = pane_id.clone());
                bridge.emit_pane_added(...);
            }
        }
        // 其他事件类似
    }
}
```

**关键变化**：
- 5 层 fallthrough → 2 分支（"是命令响应"还是"是通知"）
- "split-result"判断不再靠"看 pending_splits 队列"，而是看"最近 N 毫秒是否发了 split-window"
- `CommandRegistry` 是**唯一**的 ID → waiter 映射，不再有 4 个 pending_* 队列

### 2.5 错误模型（替代 `Result<_, String>`）

```rust
// errors.rs — NEW
#[derive(thiserror::Error, Debug)]
pub enum TmuxError {
    #[error("transport: {0}")]
    Transport(String),
    
    #[error("protocol: {0}")]
    Protocol(ProtocolError),
    
    #[error("handshake: {0}")]
    Handshake(HandshakeError),
    
    #[error("command failed: {command} - {message}")]
    CommandFailed { command: CommandKind, message: String },
    
    #[error("timeout waiting for {what}")]
    Timeout { what: &'static str },
    
    #[error("session not found: {0}")]
    SessionNotFound(u32),
    
    #[error("pane not found: {0}")]
    PaneNotFound(String),
}

#[derive(thiserror::Error, Debug)]
pub enum ProtocolError {
    #[error("malformed line: {0}")]
    MalformedLine(String),
    
    #[error("unknown notification: {0}")]
    Unknown(String),
    
    #[error("invalid response id {got}, expected {expected}")]
    IdMismatch { got: u64, expected: u64 },
}
```

每个 Tauri command 边界做 `From<TmuxError> for String` 转换（保持现有 IPC 兼容）。

---

## 3. 模块边界（具体职责）

### 3.1 protocol/（协议层）

**职责**：byte ↔ ProtocolEvent，无业务状态

```rust
// protocol/wire.rs（旧 commands.rs 改名）
pub fn encode(cmd: &CommandKind) -> String { /* ... */ }

// protocol/parser.rs（旧 parser.rs）
pub struct ProtocolParser { /* ... */ }
impl ProtocolParser {
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<ProtocolEvent> { /* ... */ }
}

// protocol/version.rs — NEW
pub async fn probe_version(transport: &dyn TmuxBackend) -> Result<TmuxProtocolVersion, TmuxError> {
    // 1. display-message '#{version}'
    // 2. list-commands 解析
    // 3. 推断 CapabilityMatrix
}

// protocol/command.rs — NEW
pub struct TaggedCommand { /* 见 §2.2 */ }
```

### 3.2 transport/（传输层）

**职责**：抽象 byte pipe（local child / SSH exec channel）

```rust
// transport/backend.rs（已有，扩展）
#[async_trait]
pub trait TmuxBackend: Send + Sync {
    /// Get the stdout reader (bytes)
    async fn take_stdout(&self) -> Option<Box<dyn AsyncRead + Send + Unpin>>;
    /// Get a writer to send bytes to tmux's stdin
    async fn take_stdin(&self) -> Option<Box<dyn AsyncWrite + Send + Unpin>>;
    /// Wait for the process to exit; return real exit code
    async fn wait(&self) -> Result<i32, TmuxError>;
    /// Graceful close
    async fn close(&self) -> Result<(), TmuxError>;
}
```

**不变量**：
- backend 只管 byte pipe，**不管协议**
- exit code 真实可见（沿用 Bug 010/013/014 修复，但用 `watch::channel` 而非 `Notify`）

### 3.3 controller/（状态机层）

**职责**：维护 SessionView，路由响应，编排启动握手

```rust
// controller/mod.rs
pub struct TmuxController { /* 见 §2.4 */ }

impl TmuxController {
    /// Bootstrap sequence — must be called once after backend is ready.
    pub async fn start(&self) -> Result<HandshakeResult, TmuxError> {
        handshake::run(self).await
    }
    
    /// User-driven operations (split / new-window / etc.)
    pub async fn split_window(&self, pane_id: &str, dir: Direction) -> Result<(u32, String), TmuxError>;
    pub async fn new_window(&self, name: Option<&str>) -> Result<WindowInfo, TmuxError>;
    pub async fn send_keys(&self, pane_id: &str, data: &[u8]) -> Result<(), TmuxError>;
    pub async fn kill_pane(&self, pane_id: &str) -> Result<(), TmuxError>;
    pub async fn kill_window(&self, window_id: &str) -> Result<(), TmuxError>;
    pub async fn rename_window(&self, window_id: &str, name: &str) -> Result<(), TmuxError>;
    pub async fn capture_pane(&self, pane_id: &str, lines: i32) -> Result<String, TmuxError>;
}

// controller/handshake.rs — NEW
pub async fn run(controller: &TmuxController) -> Result<HandshakeResult, TmuxError> {
    let version = protocol::version::probe_version(&controller.backend).await?;
    let plan = HandshakePlan::for_version(&version);
    
    for step in plan.steps() {
        let result = controller.execute_tagged(step.into_command()).await?;
        step.validate(result)?;
    }
    
    Ok(HandshakeResult { version, first_pane: ... })
}

pub struct HandshakePlan {
    steps: Vec<HandshakeStep>,
}

impl HandshakePlan {
    /// 根据探测到的版本和能力，选一条启动序列
    pub fn for_version(v: &TmuxProtocolVersion) -> Self {
        if v.capabilities.auto_pushes_window_pane_changed
            && v.capabilities.supports_refresh_client_dash_C {
            Self {
                steps: vec![
                    HandshakeStep::DisplayVersion,
                    HandshakeStep::AttachSession,
                    HandshakeStep::RefreshClientC { explicit: false },
                    // 等 %begin..%end 完成 + 等 %window-pane-changed
                ],
            }
        } else if v.capabilities.supports_refresh_client_dash_C_flag {
            Self {
                steps: vec![
                    HandshakeStep::DisplayVersion,
                    HandshakeStep::AttachSession,
                    HandshakeStep::RefreshClientC { explicit: true },
                    HandshakeStep::ListWindows,
                    HandshakeStep::ListPanes { all: true },
                ],
            }
        } else {
            Self {
                steps: vec![
                    HandshakeStep::DisplayVersion,
                    HandshakeStep::NewSession,
                    HandshakeStep::NewWindow,
                    HandshakeStep::ListWindows,
                    HandshakeStep::ListPanes { all: true },
                ],
            }
        }
    }
}

// controller/id_map.rs — NEW
pub struct CommandRegistry {
    by_id: HashMap<CommandId, ResponseWaiter>,
    /// 最近 N ms 内的"split-window"序列，用于 WindowPaneChanged 路由
    recent_splits: VecDeque<CommandId>,
    next_id: AtomicU64,
}

impl CommandRegistry {
    pub fn register(&mut self, waiter: ResponseWaiter) -> CommandId;
    pub fn take(&mut self, id: CommandId) -> Option<ResponseWaiter>;
    pub fn is_split_in_flight(&self) -> bool;
}
```

### 3.4 bridge/（桥接层）

**职责**：把 SessionView 变化 → Tauri 事件；接收 Tauri 命令 → controller 操作

```rust
// bridge/events.rs — NEW
#[async_trait]
pub trait TmuxBridge: Send + Sync {
    /// session-output（output bytes 路由）
    fn emit_output(&self, xsterm_session_id: u32, data: Vec<u8>);
    /// tmux-pane-added / tmux-window-added / tmux-pane-removed / tmux-window-closed
    fn emit_pane_added(&self, payload: TmuxPaneAddedEvent);
    fn emit_window_added(&self, payload: TmuxWindowAddedEvent);
    fn emit_pane_removed(&self, payload: TmuxPaneRemovedEvent);
    fn emit_window_closed(&self, payload: TmuxWindowClosedEvent);
    fn emit_window_renamed(&self, payload: TmuxWindowRenamedEvent);
    fn emit_controller_exit(&self, reason: String);
    /// tmux-pane-list / tmux-window-list 完整快照（用于 full re-sync）
    fn emit_pane_list(&self, panes: Vec<TmuxPaneListEntry>);
    fn emit_window_list(&self, windows: Vec<TmuxWindowListEntry>);
}

pub struct AppHandleBridge { /* 实现：wrap Arc<dyn AppBackend> */ }

// bridge/commands.rs — NEW（与现有 services/commands/session.rs 的 tmux 命令分离）
pub struct TmuxCommandBridge { /* 接收 Tauri command 调用，转 controller 操作 */ }
```

---

## 4. 关键时序图（启动握手 v0）

```
T0: spawn tmux -CC -L default new-session -d -x 80 -y 24
    (使用 user 提供的配置；不再需要 -A / refresh-client 等探索性命令)
    reader task: line-by-line → parser.feed → ProtocolEvent stream
    writer task: stdin_tx.recv() → write to backend.stdin
    dispatch task: on ProtocolEvent → update SessionView / emit bridge event

T1: controller.start()
    handshake::run():
      seq 1: TaggedCommand { id: 1, kind: DisplayVersion, wire: "display-message ...", waiter: BeginEnd(tx1) }
      → await tx1 OR timeout(2s)
      → Result { body: ["3.3a"] } → parse → TmuxProtocolVersion
      → CapabilityMatrix 推断

T2: HandshakePlan::for_version(&version) → 选择序列

T3: 序列执行（以"新版本 + 推 %window-pane-changed"为例）：
      seq 2: TaggedCommand { id: 2, kind: AttachSession, wire: "attach-session -t '' -c ''", waiter: BeginEnd(tx2) }
      → await tx2 OR timeout(2s)
      → 期间 server 推送 %session-changed $1 <name> → 路由到 SessionView.sessions.insert
      → 期间 server 推送 %window-add @1 → SessionView.windows.insert → bridge.emit_window_added
      → 期间 server 推送 %window-pane-changed @1 %1 → SessionView.panes.insert → bridge.emit_pane_added
      → tx2 fires（%end id=2 到达）→ 完成

T4: HandshakeResult { version, first_pane: (xsterm_id, "%1") }
    → controller 标记 handshake_done = true
    → 用户可调用 split_window / new_window / send_keys 等

# 异常：老版本 tmux（OpenBSD base）
T1: 同上 → version = "3.1" → capability.auto_pushes_window_pane_changed = false

T3': 走 fallback 序列：
      seq 2': ListWindows → await BeginEnd → body = ["@1 bash ...", "@2 vim ..."]
      seq 3': ListPanes -a → await BeginEnd → body = ["@1 %1 bash", "@2 %2 vim"]
      seq 4': 新会话的每个 pane → SessionView 注册 + bridge emit
      → handshake 完成

# 异常：协议不通（server 不响应 display-message）
T1: await tx1 → timeout(2s) → 错误
    handshake 错误上报 UI："tmux 服务器无响应"
    controller 进入 Closed 状态，bridge.emit_controller_exit
```

**关键不变量**：
- 任何 seq 都 await `%begin..%end` 响应，**不靠 sleep**
- capability matrix 在 T1 探测得到，整个序列基于它选
- 失败路径明确（UI 上看到具体原因），不再"5000ms 后弹 timeout"

---

## 5. PR 切片（重设计的迁移）

按"先分层 → 再换握手 → 再换响应路由 → 最后替换命令桥接"拆。每个 PR 一个 atomic commit。

### P1: 拆 protocol/ 层（无功能变更）

- 新建 `services/tmux/protocol/` 目录
- 移动 `commands.rs` → `protocol/wire.rs`（重命名）
- 移动 `escape.rs` → `protocol/codec.rs`
- 移动 `events.rs` → `protocol/events.rs`
- 移动 `parser.rs` → `protocol/parser.rs`
- 旧 `commands.rs/escape.rs/events.rs/parser.rs` 改为 re-export shim（兼容旧 import）
- **不删旧 controller.rs，只重新组织 imports**
- 自测：`cargo test --lib` 246 全过 + `cargo check` 0 警告

### P2: 协议版本探测（不动 controller）

- 新建 `protocol/version.rs`
- 实现 `probe_version()` + `CapabilityMatrix` 推断
- 加 `probe_protocol_version` Tauri command（方便 dev 调试）
- 自测：
  - 在本地 tmux 上跑（应返回 ~3.4）
  - 在 OpenBSD 容器 tmux 上跑（应返回 <3.3）
  - 能力矩阵 5 项测试

### P3: 引入 TaggedCommand + CommandRegistry（兼容层）

- 新建 `protocol/command.rs`：`TaggedCommand` + `ResponseWaiter`
- 新建 `controller/id_map.rs`：`CommandRegistry`（**先不替换 pending_splits 等，仅新增**）
- controller.rs 的 `write_command(...)` helper 改用 `TaggedCommand`（发命令路径），但 waiter 仍走旧的 pending_*
- 自测：所有现有测试 + 新增 TaggedCommand 单元测试

### P4: HandshakeState + 探测式握手（新路径，旧路径保留）

- 新建 `controller/handshake.rs`
- 实现 `HandshakePlan::for_version()`
- 新增 `controller.start_v2()` 方法，**不动** 现有 `controller.start()`（v1）
- 通过 feature flag `tmux-v2-handshake` 切换（默认 off，便于回滚）
- 自测：
  - 本地 tmux + 新握手：5s 内创建
  - OpenBSD tmux（mock）+ 新握手：fallback 路径走通
  - v1（旧握手）仍 5s 内创建（回归）

### P5: 响应路由重写（删 dispatch.rs 5 层 fallthrough）

- 新建 `controller/subscriber.rs`：订阅者注册 + 通知路由
- 重写 controller.rs 的事件处理：命令响应走 CommandRegistry，通知走 update SessionView
- 新增 `controller.session_event_loop()` 替代 dispatch_task（**保留旧 task**，新 task feature flag）
- 自测：
  - split-window 路径
  - new-window 路径
  - bootstrap attach 路径
  - 外部 pane（不在 pending 中）路径
- 删除旧 dispatch_task 后 `#[cfg(not(feature = "tmux-v2-handshake"))]`

### P6: errors.rs + From<TmuxError> for String

- 新建 `errors.rs`
- 替换所有 `Result<_, String>` 为 `Result<_, TmuxError>`
- Tauri command 边界做 `From` 转换
- 自测：所有现有测试 + 新增错误模型单元测试

### P7: bridge/ 层（独立 emit 逻辑）

- 新建 `bridge/events.rs` + `bridge/commands.rs`
- 把 controller.rs 里的所有 `backend.emit(...)` 调用移到 bridge
- controller 只调 `bridge.emit_pane_added(...)` 不直接 emit Tauri 事件
- 自测：现有测试全过 + bridge 单元测试

### P8: 删 v1 路径

- 删除旧 `controller.start()` / `pending_splits` / `pending_windows` / `pending_window_pane` / `pending_capture` / `pending_bootstrap`
- 删除 `dispatch.rs` 旧实现（5 层 fallthrough）
- 删除所有 `#[cfg(not(feature = "tmux-v2-handshake"))]`
- 自测：全测试通过 + 手动 4 个场景
  - 本地 tmux -CC new-session
  - 本地 tmux -CC attach-session（已有 server）
  - SSH 上 tmux -CC（远端）
  - 跨版本（OpenBSD base tmux）

### P9: 文档 + RFC

- 写 `doc/rfcs/0005-tmux-redesign.md`：本稿 v0 的最终决议
- 更新 `doc/arch/architecture-map.md`：tmux -CC 章节按新架构重写
- 更新 `doc/requirements/prd-0.1/tmux-cc-implementation.md`：删除 Wave 0-6 历史，新增"启动协议 + capability 探测"章节
- 更新 `doc/maintenance/bug.md`：把 18 个 tmux -CC bug 的根因统一指向本 RFC

---

## 6. 风险与决策点

### 6.1 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| P4 协议版本探测本身有 race（探测完之前 server 已推送 %window-add） | 中 | 中 | 探测结果存 OnceCell；探测完成前的事件缓冲到 `pending_events: Vec<ProtocolEvent>`，完成后 flush |
| CapabilityMatrix 推断错误（看似 3.3 实际是 3.2 patched）| 中 | 中 | 显式探测每个能力（`command-not-found` 错误回退），不靠版本号盲猜 |
| P5 响应路由破坏现有 split / new-window 路径 | 中 | 高 | feature flag 双跑；E2E 对比旧路径输出 |
| 性能：TaggedCommand 序列化开销 vs 现状直接 String 拼接 | 低 | 低 | 启动期一次性，不在热路径；写命令路径测 benchmark |
| 重写后 Bug 022（cargo check 失败）类问题再发 | 中 | 中 | 每个 PR 跑 `cargo check --manifest-path src-tauri/Cargo.toml` + `cargo test --lib`；CI 加 fail gate |

### 6.2 决策点（需要 tm / pdm 拍）

| ID | 主题 | dev 推荐 | 关键 trade-off |
|---|---|---|---|
| D-T1 | 拆 crate 还是单 crate 子目录 | **单 crate 子目录**（`services/tmux/protocol/`、`services/tmux/controller/`、`services/tmux/bridge/`） | 单 crate 编译快 + Cargo.lock 简单；workspace 拆分留到 v1.1 |
| D-T2 | HandshakePlan 用 enum 还是 trait | **enum + match**（每个分支显式列出）| 编译期覆盖；tra 太多 → 拆 trait，但 MVP 不需要 |
| D-T3 | SessionView 用 Mutex 还是 DashMap | **Arc<Mutex<SessionView>>**（sharded 太早优化）| 当前 panes 数 < 100；Mutex 简单可测；性能瓶颈时再 DashMap |
| D-T4 | 协议版本探测放 T0（spawn 前）还是 T1（spawn 后） | **T1 后**——必须 spawn tmux 才知道它是 control-mode 客户端 | 探测不到 fallback：默认新 tmux 行为 + 用户可手动 force fallback |
| D-T5 | errors.rs 引入 thiserror vs 手写 enum | **thiserror**（与 spec 一致）| 标准做法 |
| D-T6 | 删除旧路径时机（P8 何时合入） | **P8 等 P4/P5 上线 2 周稳定后再合** | 给 tm 2 周观察期，bug fix in flight 后再删 v1 |
| D-T7 | 是否抽 workspace（crates/mcp-server 等） | **不抽**（与 02-target-architecture.md §D-β 推荐一致）| MVP 不需要 workspace 编译隔离 |

---

## 7. 验收标准（v0 完成 = 全部 P1-P9 合入）

- ✅ PR-001（P1）: protocol/ 拆层，所有现有测试通过
- ✅ PR-002（P2）: 协议版本探测在本地 + OpenBSD 上正确
- ✅ PR-003（P3）: TaggedCommand + CommandRegistry 兼容层就位
- ✅ PR-004（P4）: 新握手路径 5s 内创建，本地 + OpenBSD 两套 sequence 都走通
- ✅ PR-005（P5）: 响应路由重写，split / new-window / attach / 外部 pane 四路径全过
- ✅ PR-006（P6）: 错误模型统一
- ✅ PR-007（P7）: bridge/ 独立
- ✅ PR-008（P8）: 旧路径删除，所有现有测试通过 + E2E 4 个场景通过
- ✅ PR-009（P9）: 文档 + RFC

### 后续观察期（2-4 周）

- 0 个新 tmux -CC bug
- 与 Bug 007–022 同根因的问题不再出现
- 启动时间（spawn → 第一个 pane 可用）< 500ms（本地）/ < 2s（SSH）

---

## 8. 不在本稿范围

| 项 | 推迟到 |
|---|---|
| 抽 `crates/tmux-protocol/` workspace member | v1.1（D-T7） |
| 支持 wezterm-style 的 native tmux integration（libtinfo 直连）| 不做（依赖外部项目）|
| 支持 `tmux popup`（3.4+）| v1.1 |
| tmux plugin 控制（tmux-resurrect / tmux-continuum）| 不做 |
| tmux 配置文件编辑 UI | 不做 |

---

## 9. 给评审者的 5 个判断点

如果你只有 5 分钟，**只看这 5 段**：

1. **§0 设计原则**（P1-P6）—— 同意就继续；不同意 → 整个稿子要重写
2. **§2.1 文件结构目标态** —— 同意 → 继续；想合并 `protocol/` 和 `transport/` → 改稿
3. **§2.3 启动握手** —— 同意 → 继续；想用 iTerm2 attach 序列 → 改 §2.3
4. **§3.3 controller 职责** —— 同意 → 继续；想把 handshake 提到 transport 层 → 改稿
5. **§5 PR 切片顺序** —— 同意 → 开 P1；想先做 P5 重写再 P1 拆分 → 改顺序

---

文档结束。**判断**：以上 9 个 PR 你能接受吗？要加 / 改 / 删哪一段？