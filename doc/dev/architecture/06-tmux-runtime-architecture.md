# 06 tmux 子系统架构详解

> **定位**：本文给 **新人第一次接触 `tmux_session/` Rust 代码** 提供 30 分钟入门。
> 读完应该能：知道每个文件干什么、知道 4 个 task 怎么跑、知道 waiter 怎么把 async 公开 API 跟 dispatch task 关联起来。
>
> **不重复**：`02-process-view.md` §3 已有 task / channel 拓扑速览；本文讲得**更深**（每个字段、每条 channel 的来龙去脉）。
> **不重复**：`05-scenarios.md` 已经讲"拉 → 看 → 拆"三个用户场景；本文只讲**代码层**的"结构是什么、为什么这么拆"。
> **不重复**：`03-development-view.md` §3 已经列模块树；本文展开讲每个文件的**内部形态**。
>
> **范围**：基于 PR 拆分后 + 2026 年 PR 二次拆分（mod.rs 3939→373 行）的当前代码状态。

## 1. 一句话

`TmuxController` 是 **一个 `tmux -CC` 子进程**（local PTY 或 SSH exec channel）的封装：
- 启动 4 个 tokio task 拉数据、写命令、监控退出、分发事件
- 持有 21 个字段记录"xsterm session id ↔ tmux pane/window id"映射 + waiter 注册表 + bootstrap rendezvous
- 提供 11 个公开方法（`send_keys` / `split_pane` / `capture_pane` 等）给 `SessionManager` 调
- 用 1 个全局 waiter 注册表（`CommandRegistry`）把"我发了个 split-window"和"tmux 回 %window-pane-changed"关联起来

## 2. tmux control mode 是什么

要读懂代码先理解 tmux 自己在干什么。**`tmux -CC`** = 启动 tmux 控制模式客户端（Control Mode client）：
- tmux 启动后**变成**一个文本协议服务端，stdin 是客户端→tmux，stdout 是 tmux→客户端
- 每条命令一行文本（`send-keys -t %5 hello\n`、`list-windows\n`），**无帧**——靠 `\n` 分隔
- 响应分两类：
  - **同步命令**（`capture-pane` / `list-windows` 等）：用 `%begin <id> <sec> <flags>` / 多行 body / `%end <id> <sec> <flags>` 三段式
  - **异步通知**（`%window-pane-changed @<win> %<pane>`、`%output %<pane> <data>`、`%exit` 等）：单行通知，**没有 id**
- SSH 路径会**用 DCS passthrough** 把整个 wire 协议包在 `ESC P 1000 p ... ESC \` 里——这是 SSH 控制模式 channel 的要求，**reader task 必须剥**（Bug 009 修复）

> ⚠️ **关键不变量**：我们写的是 **文本 ASCII 协议客户端**，**不解析 tmux 内部字节流**（不解析 DCS 内的 payload），只是按行 split + strip DCS 标记。

## 3. 代码长什么样

```
src-tauri/src/services/tmux_session/
├── mod.rs                       旧入口 + re-export + From<TmuxError> for String
├── dispatch.rs                  spawn_dispatch_task + dispatch_event（解析 ProtocolEvent → TmuxBridge emit）
├── errors.rs                    thiserror 派生的 TmuxError 枚举
├── bridge/
│   └── mod.rs                   TmuxBridge — ProtocolEvent → Tauri 事件 + JSON payload
├── protocol/                    纯协议层，**无 I/O、无 runtime state**
│   ├── mod.rs
│   ├── codec.rs                 octal \nnn 编解码
│   ├── command.rs               CommandId / CommandKind / ResponseWaiter / TaggedCommand
│   ├── events.rs                ProtocolEvent 枚举（30+ 变体）
│   ├── parser.rs                line → Option<ProtocolEvent> 状态机
│   ├── version.rs               CapabilityMatrix + parse_version + infer_capabilities
│   └── wire.rs                  高层 "send-keys" / "split-window" 文本构造器
└── controller/                  状态机 + task 管理（P1-P5 拆分 + 2026 二次拆分后）
    ├── mod.rs                   [121]  TmuxController struct + 共享 helper（lock_or_warn）+ test fixture
    ├── spawn.rs        [293]    4 个构造函数（spawn_create / spawn_with_args / spawn_with_backend / spawn_attach）
    │                            + argv / shell / process helper
    ├── commands.rs     [257]    11 个用户面向的 tmux command（send_keys / resize_pane / capture_pane /
    │                            split_pane / kill_pane / new_window / kill_window / rename_window /
    │                            detach_client / kill_server / unbind_pane）
    ├── io_tasks.rs             4 个 spawn_*_task（reader / writer / stderr_drain / monitor）
    │                            + preview_hex + schedule_initial_state_sync
    ├── registry.rs              binding 访问器 + register_pane / unregister_pane /
    │                            record_first_pane / record_pane_window / allocate_session_id
    ├── sync.rs                  lifecycle：close + session_name + set_session_name_for_tests
    │                            + bootstrap rendezvous（await_first_pane / take_initial_state /
    │                            stash_initial_* / signal_initial_state_ready）
    ├── id_map.rs      [285]    CommandRegistry — id → waiter + event_waiters FIFO
    ├── handshake.rs   [342]    PR-T4 v2 handshake 计划
    ├── subscriber.rs  [580]    RouterState — %begin..%end 之间累积 body line
    └── tests.rs      [1677]    29 个 #[tokio::test] + RecordingBackend fixture
```

**关键原则**：`controller/mod.rs` 现在只承担 2 个职责：(1) 跨模块共享的基础设施（常量、helper、struct 定义）+ (2) `#[cfg(test)]` test fixture 构造器。所有构造函数、I/O task、命令方法、binding、lifecycle 都已下沉到子文件。

`protocol/` 子模块**完全无 I/O、无 runtime state**，纯函数 + 类型定义，可独立单元测试。这是测试最密集的区域（codec / parser / wire 各有几十个 test）。
`controller/id_map.rs` 和 `controller/subscriber.rs` 是 `pub(crate)` 子模块，被 `controller/mod.rs` 的 `pub use` 重新导出，外部调用方通过 `crate::services::tmux_session::controller::*` 访问 `CommandRegistry` / `RouterState` / 等类型。

## 4. 子模块拆分原则（controller/）

`controller/mod.rs` 在 2026 年被二次拆分，从 **3939 行 / 2626 pure LOC** 缩到 **373 行 / 121 pure LOC**。拆分原则：

| 拆出的文件 | 装什么 | 行数 / pure LOC |
|---|---|---|
| `spawn.rs` | 4 个构造函数 + argv / shell / process helper | 409 / 293 |
| `commands.rs` | 11 个用户面向的 tmux command | 450 / 257 |
| `io_tasks.rs` | 4 个 spawn_*_task + preview_hex + schedule_initial_state_sync | 247 / 151 |
| `sync.rs` | close + session_name + bootstrap rendezvous（await_first_pane / take_initial_state） | 191 / 120 |
| `registry.rs` | binding 访问器 + register/unregister/record_* | 143 / 76 |

`mod.rs` 留下什么：
- 模块 doc（~30 行）
- `SpawnMode` enum（Create / Attach）
- sub-module 声明 + 共享 re-export
- 4 个 `pub(super)` 常量（`DEFAULT_INITIAL_ROWS/COLS` / `TMUX_REPLY_TIMEOUT` / `DEFAULT_TMUX_SOCKET_NAME`）
- `lock_or_warn` helper（被 3 个 submodule 共享）
- `TmuxController` struct 定义（21 个字段的详细 docs）
- `#[cfg(test)]` test fixture：`set_split_pane_timeout_for_tests` + `new_for_tests`（被 session_manager / subscriber / controller/tests 共享）

**为什么这样拆**：

1. **单一职责**：每个文件只有一个动词。`spawn` 只管"起 controller"，`commands` 只管"用户调 command"，`io_tasks` 只管"后台 I/O task"，`registry` 只管"binding 表"，`sync` 只管"lifecycle rendezvous"。
2. **依赖方向**：所有 submodule 都 `use super::*` 访问共享类型，但 submodule 之间不互相 import。`spawn` 不引用 `commands`，`commands` 不引用 `sync`——结构是扁平的。
3. **测试隔离**：`#[cfg(test)] mod tests` 与生产代码**编译隔离**——`cargo build --release` 不会拉 1677 行 test 代码。

## 5. TmuxController 的 21 个字段（按职责分组）

```rust
pub struct TmuxController {
    // ── 标识 ──
    pub(crate) controller_id: u32,

    // ── 后端（local PTY 或 SSH exec channel）──
    pub(crate) backend: Arc<tokio::sync::Mutex<Option<Box<dyn TmuxBackend>>>>,
    pub(crate) killed: Arc<AtomicBool>,
    pub(crate) app_backend: Arc<dyn AppBackend>,

    // ── stdio channel：写命令 ──
    pub(crate) stdin_tx: mpsc::UnboundedSender<String>,

    // ── pane ↔ session id 映射 ──
    pub(crate) pane_bindings: std::sync::Mutex<HashMap<String /* tmux_pane_id */, u32 /* xsterm_session_id */>>,
    pub(crate) pane_window_bindings: std::sync::Mutex<HashMap<String, String /* tmux_window_id */>>,

    // ── session id 分配 ──
    pub(crate) session_id_allocator: Arc<dyn Fn() -> u32 + Send + Sync>,

    // ── bootstrap 一次性 rendezvous ──
    pub(crate) first_pane_tx: std::sync::Mutex<Option<oneshot::Sender<(u32, String)>>>,
    pub(crate) first_pane_rx: tokio::sync::Mutex<Option<oneshot::Receiver<(u32, String)>>>,

    // ── 初始状态同步（list-windows + list-panes 响应）──
    pub(crate) initial_windows: std::sync::Mutex<Option<Vec<TmuxWindowInit>>>,
    pub(crate) initial_panes: std::sync::Mutex<Option<Vec<TmuxPaneInit>>>,
    pub(crate) initial_state_rx: tokio::sync::Mutex<Option<oneshot::Receiver<()>>>,
    pub(crate) initial_state_tx: std::sync::Mutex<Option<oneshot::Sender<()>>>,

    // ── window id set（用于 kill_window / rename_window 校验）──
    pub(crate) window_bindings: std::sync::Mutex<HashSet<String /* tmux_window_id */>>,

    // ── tmux session name（仅 spawn_attach 设置；用于持久化）────
    pub(crate) session_name: std::sync::Mutex<Option<String>>,

    // ── 并发控制 ──
    pub(crate) capture_lock: tokio::sync::Mutex<()>,    // 串行 capture_pane
    pub(crate) split_pane_timeout: Duration,            // 默认 TMUX_REPLY_TIMEOUT；测试可缩短

    // ── 模式（影响 dispatch 行为）──
    pub(crate) spawn_mode: SpawnMode,

    // ── waiter 注册表 + body 累积器 ──
    pub(crate) registry: CommandRegistry,
    pub(crate) router_state: std::sync::Mutex<RouterState>,
}
```

### 5.1 字段间关系图

```
                       ┌────────────────────────────┐
                       │  SessionManager (caller) │
                       └────────────┬───────────────┘
                                    │ spawn_create(config)
                                    ▼
┌───────────────────────────────────────────────────────────────┐
│  TmuxController::spawn_create / spawn_with_backend             │
│  ├── backend  ─────> tokio::process::Child (local)            │
│  │                或 SshConnectResult (SSH exec channel)       │
│  ├── stdin_tx   ─────> writer task                           │
│  ├── registry   ─────> [CommandKind → ResponseWaiter/EventWaiter FIFO]  ◀── split_pane/new_window/capture_pane
│  └── app_backend ─────> dispatch task (push ProtocolEvent → emit Tauri event)
└───────────────────────────────────────────────────────────────┘
        │
        ├─ reader task: 解析 stdout → ProtocolEvent → dispatch_tx
        ├─ writer task: stdin_rx.recv() → stdin.write_all
        ├─ monitor task: backend.wait() → 若 !killed 则 dispatch_tx.send(Exit)
        └─ dispatch task: dispatch_rx.recv() → dispatch_event()
                │
                ├─ %output → bridge.emit_session_output → Tauri "session-output" event
                ├─ %window-pane-changed → match (a/b/c)
                │     case (a) 已绑定 → ignore
                │     case (b) split-result   → 拿 registry.event_waiters[SplitResult]
                │     case (c) bootstrap       → record_pane_window + first_pane_tx.send()
                ├─ %begin..%output..%end → registry.take(id) → send_to_waiter
                └─ %exit → bridge.emit_tmux_controller_exit
```

### 5.2 关键字段语义

| 字段 | 含义 | 谁写 | 谁读 |
|---|---|---|---|
| `controller_id` | SessionManager 分配的稳定 id（u32） | spawn 时设一次 | 几乎所有 emit / trace |
| `backend` | `Box<dyn TmuxBackend>` 槽位（**双重所有权**：close 和 monitor 抢） | spawn 时设，close / monitor 抢 | close / monitor |
| `killed` | AtomicBool：`true` = 主动关停（不发 Exit 事件） | `close()` | monitor（决定是否 emit Exit） |
| `stdin_tx` | writer task 的命令 channel（unbounded，**永不阻塞 caller**） | 11 个公开方法 | writer task |
| `app_backend` | Tauri AppBackend clone（dispatch 用它 emit 事件） | spawn 时设一次 | dispatch task |
| `pane_bindings` | `tmux_pane_id → xsterm_session_id` 映射 | dispatch task（`register_pane` / `unregister_pane`） | 公开方法（`xsterm_id_for_pane`） |
| `pane_window_bindings` | `tmux_pane_id → tmux_window_id` | dispatch task | 公开方法 |
| `window_bindings` | `tmux_window_id` set | dispatch task | `kill_window` / `rename_window` 校验 |
| `session_id_allocator` | SessionManager 注入的闭包（dispatch 在 `register_pane` 后调） | spawn | dispatch task |
| `first_pane_tx` / `first_pane_rx` | **一次性** rendezvous：dispatch 收到首个 `%window-pane-changed` 时 send | dispatch | `await_first_pane` |
| `initial_windows` / `initial_panes` | `list-windows` / `list-panes` 响应 body 缓存 | dispatch task | `take_initial_state` |
| `initial_state_tx` / `initial_state_rx` | "两个都 stashed"信号 | dispatch | `take_initial_state` |
| `session_name` | tmux session name（**仅** `spawn_attach` 设置） | spawn_attach | `SessionManager::list_attached_tmux_servers` |
| `capture_lock` | 串行化 capture_pane（避免 `%begin..%end` 块交错） | capture_pane | capture_pane |
| `split_pane_timeout` | 默认 5s；测试可缩短 | spawn / 测试 | split_pane |
| `spawn_mode` | Create / Attach —— 影响 dispatch 行为 | spawn | dispatch task |
| `registry` | waiter 注册表（详见 6） | 11 个公开方法 + dispatch | 11 个公开方法 + dispatch |
| `router_state` | `%begin..%end` body 累积器（详见 6.2） | dispatch | dispatch |

## 6. 等候者注册表（核心模式）

**所有返回 `Result<_, _>` 或 `Result<_, Result<_, TmuxError>>>` 的公开方法都是 Promise 风格**：
- 调用者注册一个 oneshot sender（带 metadata），立刻发命令到 stdin，然后**等（await）** 这 sender 的结果
- dispatch task 解析 tmux 的响应，从注册表里找到匹配的 sender，`send` 结果

为什么需要这个？因为 tmux 的协议是异步的——`split-window` 的"成功"通过**稍后到达的 `%window-pane-changed`** 来体现，不是同一条 `%begin..%end` 响应。这跟 Go 的 channel select + 关联 goroutine 是一个套路。

### 6.1 CommandRegistry（`controller/id_map.rs`）

```rust
pub(crate) struct CommandRegistry {
    by_id: BTreeMap<CommandId, CommandEntry>,           // PR-T3 引入，**合并了所有 pending_* 字段**
}
struct CommandEntry {
    kind: CommandKind,                                  // 登记是什么命令（capture / split / new-window ...）
    wire: String,                                       // 实际写进 stdin 的命令字符串
    waiter: Option<ResponseWaiter>,                     // %begin..%end 类型的等待者（capture_pane 用）
    event_waiters: VecDeque<EventWaiter>,              // %window-pane-changed / %window-add 类型的等待者（split / new-window 用）
    tagged: TaggedCommand,                              // 解析响应时需要的元数据（id + 序列号）
}
```

**三种等待模式**：

| 公开方法 | 等待模式 | waiter 类型 | 触发响应 |
|---|---|---|---|
| `capture_pane` | sync（`%begin..%end`） | `ResponseWaiter::BeginEnd(oneshot<ResponseOutcome>)` | `%end T I F` |
| `split_pane` | event（`%window-pane-changed`） | `EventWaiter { kind: SplitResult, sender: Split(oneshot), tmux_window_id: None }` | `%window-pane-changed @<win> %<pane>` |
| `new_window` | event 双信号（`%window-add` + `%window-pane-changed`） | `EventWaiter { kind: NewWindowResult, sender: NewWindow(oneshot), tmux_window_id: None }` | `%window-add`（re-key）→ `%window-pane-changed`（resolve） |
| `kill_pane` / `send_keys` / `resize_pane` 等 | 同步 fire-and-forget | 无 waiter | 无 |

### 6.2 RouterState（`controller/subscriber.rs`）

`CommandRegistry` 只知道**一次匹配**（id → waiter），但 `%begin..%end` 响应**多行 body** 需要先攒起来再交给 waiter。`RouterState` 就是这个 body 累积器：

```rust
pub(crate) struct RouterState {
    in_flight: Option<InFlightBody>,
}
struct InFlightBody {
    cmd_id: CommandId,
    kind: CommandKind,             // PR-T3+ 引入，取代旧的"看 body 第一字符决定是 list-windows 还是 list-panes"hack
    lines: Vec<String>,
}
```

dispatch task 收到 `%begin T I F` → `set current command id + kind`；body line → `push_to_lines`；`%end T I F` → pop → `registry.take(id).resolve(body)`；`%error` → drop body，resolve error waiter。

### 6.3 三种公开方法的完整 await 流程

#### 6.3.1 `capture_pane(tmux_pane_id, lines) -> Result<String>`

```
caller (session_manager)
   │
   ▼
1. pane_bindings 检查（pane 必须已注册）
   │
2. capture_lock.lock().await  ← tokio::Mutex，串行化
   │
3. registry.register(CapturePane { pane_id, lines }, "capture-pane ...", ResponseWaiter::BeginEnd(tx))
   │
4. stdin_tx.send("capture-pane ...\n")       ← 立刻发命令
   │
5. tokio::time::timeout(TMUX_REPLY_TIMEOUT, rx).await    ← 等 5s
   │
   dispatch task（另一线程）并行：
   a. tmux 回 "%begin T I F 0"
   b. tmux 回 "<line 1>", "<line 2>", ...
   c. tmux 回 "%end T I F 0"
        → registry.take(TI I) → registry.entries[b].waiter.send(Ok(...))
   │
6. rx 返回 Ok(Ok(ResponseOutcome::Ok { body_lines }))
7. body_lines.join("\n")   ← join 成最终字符串
   │
8. capture_lock 自动释放
   ▼
Result<String>
```

#### 6.3.2 `split_pane(parent_pane_id, direction) -> Result<(xsterm_session_id, tmux_pane_id, tmux_window_id), TmuxError>`

```
caller
   │
   ▼
1. pane_bindings 检查 parent 必须存在
   │
2. registry.register_event_waiter(EventWaiter {
       kind: SplitResult,
       sender: Split(oneshot::channel),
       tmux_window_id: None,
   })
   │
3. send_with_rollback(&stdin_tx, &registry, "split-window <flag> -t %<parent>\n")
   │  失败：drain_event_waiters() 回滚刚才注册的 waiter
   │
4. await_reply(rx, split_pane_timeout, controller_id, "split").await  ← 等响应
   │
   dispatch task（另一线程）：
   a. tmux 回 "%window-pane-changed @<win> %<pane>"
   b. case (b) split-result → take_event_waiter_for_split(&event_waiters)
        → 拿走匹配 tmux_window_id 的 EventWaiter
        → sender.send(Ok((xsterm_session_id, tmux_pane_id, tmux_window_id)))
   │
5. rx 返回 Ok(Ok((xsterm_id, pane_id, win_id)))
   ▼
Result<(u32, String, String)>
```

#### 6.3.3 `new_window(name) -> Result<(tmux_window_id, xsterm_session_id, tmux_pane_id)>`

```
caller
   │
   ▼
1. registry.register_event_waiter(EventWaiter {
       kind: NewWindowResult,
       sender: NewWindow(oneshot::channel),
       tmux_window_id: None,       ← 初始 None
   })
   │
2. send_with_rollback(&stdin_tx, &registry, "new-window [-n \"<name>\"]\n")
   │
3. await_reply(rx, TMUX_REPLY_TIMEOUT, controller_id, "new-window").await
   │
   dispatch task（另一线程）：
   a. tmux 回 "%window-add @<new_win>"   ← 此时 EventWaiter.tmux_window_id 仍 None，匹配 window_id=None 的 waiter
        → case (a) → re-key: event_waiters[i].tmux_window_id = Some("@<new_win>")
   b. tmux 回 "%window-pane-changed @<new_win> %<pane>"
        → case (b) 新窗体路径 → take_event_waiter_for_window(tmux_window_id="@<new_win>")
        → sender.send(Ok((tmux_window_id, session_id, tmux_pane_id)))
   │
4. rx 返回 Ok(Ok((tmux_win_id, xsterm_id, pane_id)))
   ▼
Result<(String, u32, String)>
```

> 注：new_window 比 split_pane 多一步**re-key**——dispatch 收到 `%window-add` 时把 EventWaiter.tmux_window_id 从 None 改成具体的 win_id；收到 `%window-pane-changed` 时按 win_id 取。

## 7. 4 个 task 的精确行为

```rust
// io_tasks.rs 全部 4 个 spawn_*_task 函数

fn spawn_reader_task<R>(stdout, dispatch_tx) {
    tokio::spawn(async move {
        let mut parser = ProtocolParser::new();
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    // ① Strip DCS passthrough markers（SSH 必现，local 偶现）
                    const DCS_START: &str = "\u{1b}P1000p";
                    const DCS_END: &str = "\u{1b}\\";
                    let stripped = line.strip_prefix(DCS_START).unwrap_or(&line).trim_end_matches(DCS_END);

                    // ② parser.feed 处理 partial state（%begin 跨多行）
                    if let Some(event) = parser.feed(stripped) {
                        dispatch_tx.send(event).ok();  // ← Unbounded，**永不阻塞**
                    }
                }
                Ok(None) => break,    // EOF
                Err(_) => break,
            }
        }
        // EOF 时不主动发 Exit —— 由 monitor 统一发
    });
}

fn spawn_writer_task<W>(stdin, stdin_rx) {
    tokio::spawn(async move {
        while let Some(cmd) = stdin_rx.recv().await {
            stdin.write_all(cmd.as_bytes()).await.ok();
            stdin.flush().await.ok();
        }
        stdin.shutdown().await.ok();   // 所有 sender drop 后退出
    });
}

fn spawn_stderr_drain_task<R>(stderr) {
    tokio::spawn(async move {
        BufReader::new(stderr).lines().for_each(|line| {
            tracing::warn!("tmux stderr: {}", line);    // OK
        }).await;
    });
}

fn spawn_monitor_task(backend, killed, dispatch_tx) {
    tokio::spawn(async move {
        let mut backend = backend.lock().await.take().expect("close() already took it");
        let reason = backend.wait().await.ok().and_then(|c| if c == 0 { None } else { Some(...) });
        if !killed.load(Ordering::SeqCst) {
            dispatch_tx.send(ProtocolEvent::Exit { reason }).ok();  // ← only Exit 有 monitor 不发
        }
    });
}
```

**关键不变量**：

| Task | 退出条件 | 发 ProtocolEvent::Exit? |
|---|---|---|
| reader | stdout EOF | ❌ 不发 |
| writer | `stdin_rx` 所有 sender drop | ❌ |
| stderr_drain | stderr EOF | ❌ |
| monitor | `backend.wait()` 返回 | ✅ **是 Exit 的唯一来源** |

`close()` 与 `monitor` 不会双重发 Exit：`close()` 先 `killed.store(true, Ordering::SeqCst)`，monitor 看到 `killed=true` 时不发 Exit。

### 7.1 dispatch task 的事件路由（精简版）

```
ProtocolEvent::Output { pane_id, data } → bridge.emit_session_output([xsterm_id, data])
ProtocolEvent::WindowAdd { window_id } →  re-key event_waiters[NewWindow].tmux_window_id
ProtocolEvent::WindowPaneChanged { window_id, pane_id } →
    case (a) pane_bindings 已包含 pane → ignore（重复登记保护）
    case (b) pane_bindings 待匹配（split-result） → take_event_waiter_for_split(&event_waiters)
    case (c) pane_bindings 未匹配 + 无 pending 任何 waiter → bootstrap path
        → register_pane(pane_id, allocated_session_id)   // ← pane_bindings 写入
        → record_pane_window(pane_id, window_id)         // ← window_bindings + pane_window_bindings 写入
        → first_pane_tx.send((session_id, pane_id))      // ← 唤醒 await_first_pane
ProtocolEvent::CommandBegin { id, ts, flags }   → router_state.set_in_flight(id)
ProtocolEvent::CommandOutput { id, line }        → router_state.push_line(line)
ProtocolEvent::CommandEnd { id, ts, flags }     → router_state.pop() → registry.take(id).resolve(body)
ProtocolEvent::CommandError { id, message }     → registry.take(id).resolve_err(message)
ProtocolEvent::WindowClose { window_id }        → window_bindings.remove + pane_bindings 清理 + emit tmux-window-closed
ProtocolEvent::WindowRenamed { window_id, name } → emit tmux-window-renamed
ProtocolEvent::PaneExited { pane_id }            → pane_bindings.remove + emit tmux-pane-removed
ProtocolEvent::PaneDied { pane_id }              → 同上（合并处理）
ProtocolEvent::Pause { pane_id }                 → emit tmux-paused
ProtocolEvent::Continue { pane_id }              → emit tmux-continued
ProtocolEvent::Exit { reason }                   → emit tmux-controller-exit
```

## 8. 生命周期（从 spawn 到 close）

```
SessionManager::create_tmux(config)
    │
    ▼
TmuxController::spawn_create(config, ...)
    ├── 1. build_tmux_argv(config) → ["-CC", "-L", socket, "new-session", "-A", "-s", name, "-x", cols, "-y", rows]
    ├── 2. SSH? ssh_backend.connect_exec → SshTmuxBackend
    │       Local? tokio Command::new("tmux").args(argv) → LocalTmuxBackend
    └── 3. spawn_with_backend(backend, SpawnMode::Create, Some(name))
              │
              ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ spawn_with_backend                                              │
   │ 1. backend.take_stdout / take_stdin / take_stderr               │
   │ 2. mpsc::channel (stdin_tx, stdin_rx)                           │
   │ 3. mpsc::channel (dispatch_tx, dispatch_rx)                     │
   │ 4. oneshot::channel (first_pane_tx/rx, initial_state_tx/rx)     │
   │ 5. spawn_reader_task / spawn_writer_task /                     │
   │    spawn_stderr_drain_task / spawn_monitor_task                │
   │ 6. Arc::new(Self { ... 22 字段 ... })                           │
   │ 7. spawn_dispatch_task(dispatch_rx, controller, bridge)        │
   │ 8. mode == Create → schedule_initial_state_sync()            │
   │    (500ms 后发 "list-windows -t <name>")                       │
   │ 9. 把 session_name 写回 controller                             │
   └────────────────────────────────────────────────────────────────┘
              │
              ▼
   返回 Arc<TmuxController>
    │
    ▼
caller: controller.await_first_pane().await?  ← 5s timeout
    │
    ▼
   ┌────────────────────────────────────────────────┐
   │ dispatch task（一直在跑）                       │
   │ 1. tmux 回 %window-pane-changed @1 %0           │
   │ 2. case (c) bootstrap                            │
   │    → register_pane("%0", allocate_session_id()) │
   │    → record_pane_window("%0", "@1")             │
   │    → first_pane_tx.send((id, "%0"))              │
   │ 3. 一并 emit tmux-pane-added 给前端            │
   └────────────────────────────────────────────────┘
              │
              ▼
   await_first_pane 返回 (session_id, pane_id)  ← caller 拿到初始 pane
    │
    ▼
caller: SessionManager 把 pane 塞进 ActiveSession，组装 SessionInfo，返回前端
    │
    ▼
[用户在前端看到一个 xterm.js pane，敲键盘]
    │
    ▼
前端 invoke write_session(session_id, bytes) → Tauri → SessionManager::write_session
    │
    ▼
TmuxController::send_keys(tmux_pane_id, bytes)
    │
    ▼
stdin_tx.send("send-keys -l -t %<pane> \"<escaped>\"\n")
    │
    ▼
writer task 写到 tmux stdin  ──▶  tmux 显示到 pane  ◀──  reader task 解析 %output
    │
    ▼
[SessionManager::write_session 收到 %output → bridge.emit_session_output([xsterm_id, bytes])
    │
    ▼
[前端 useTauriTerminalOutput 收到 session-output event → xterm.js write(bytes)]
    │
    ▼
[用户看到自己敲的字]
```

### 8.1 shutdown 顺序

```
drop Arc<TmuxController> (refcount 归 0) OR 显式 controller.close()
    │
    ▼
1. killed.store(true, Ordering::SeqCst)
    │
2. try_lock(backend) → guard.take() → backend.kill()  (close 路径)
   或 backend.lock().await → guard.take() (monitor 路径)   ← 互不阻塞
    │
3. stdin_tx 在 Arc 析构时 drop（caller 不再持有）
    │
4. writer_task: stdin_rx.recv() 返回 None → shutdown() stdin → exit
    │
5. reader_task: stdout EOF → exit  (不发 Exit)
    │
6. monitor_task: backend.wait() 返回 → 检查 killed
   ├── killed=true → 静默退出
   └── killed=false → dispatch_tx.send(Exit) → exit  ← only Exit 有 monitor 不发
    │
7. dispatch_task: dispatch_rx 关闭 → exit
    │
8. Arc<TmuxController> 析构 → 22 字段 drop
   ├── registry: 所有未 resolve 的 waiter drop（caller 的 .await 收到 RecvError → Err(TmuxError::AlreadyClosed)）
   ├── first_pane_rx: 还在等的 caller 收到 RecvError
   ├── initial_state_rx: 同上
   ├── pane_bindings / window_bindings: HashMap drop
   └── ...
    │
9. 整体清理完毕
```

**关键不变量**：reader EOF **不**发 Exit，monitor 才是 Exit 的**唯一来源**——否则会重复 emit `tmux-controller-exit` 事件给前端。

## 9. 跨 transport 抽象（local PTY vs SSH exec channel）

```rust
// infrastructure/tmux/backend.rs
pub trait TmuxBackend: Send + Sync + 'static {
    fn take_stdout(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String>;
    fn take_stdin(&mut self) -> Result<Box<dyn AsyncWrite + Send + Unpin>, String>;
    fn take_stderr(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String>;
    fn wait(&mut self) -> Result<i32, String>;  // exit code
    fn kill(&mut self) -> Result<(), String>;    // best-effort
}

pub struct LocalTmuxBackend { child: tokio::process::Child }   // 直接 Child.stdout/.stdin/.stderr/.kill().wait()
pub struct SshTmuxBackend { ... }                                // russh exec channel 包成的 AsyncRead/Write + 自定义 wait
```

**设计目的**：reader / writer / monitor 任务对 backend 是**完全透明**的——所有并发原语、channel 拓扑、CommandRegistry / RouterState 都是 backend-agnostic 的。切换 transport 不需要改 controller / dispatch task / TmuxBridge。

唯一差异：
- **DCS passthrough**：SSH 必现，local 偶现——reader task **统一剥**（Bug 009 修复）
- **stderr**：local 是 `Child.stderr`（实际空），SSH exec channel 不暴露 stderr（russh 限制）——`SshTmuxBackend::take_stderr` 返回空 stream
- **wait()**：local 是 `Child::wait()`，SSH 是阻塞等到 russh exec channel 关闭 + 读 exit code

## 10. 调试技巧

| 想看…… | 看 / 干 |
|---|---|
| stdout 字节流原文 | `RUST_LOG=xsterm::services::tmux_session::controller::io_tasks=trace` —— reader task 每行都打 hex 预览 |
| dispatch 事件 | `RUST_LOG=xsterm::services::tmux_session::dispatch=debug` |
| 创建 session 全流程 | `tracing::info!("[DEBUG-0009-RUST] create_tmux_session command ENTRY")` —— 已有 marker，按这个 grep |
| 卡在哪个阶段 | `SessionManager` 的 `[DEBUG-0009]` 系列日志 + `TmuxController::spawn_with_backend` 的 `tracing::info!` |
| 锁中毒 | 任何字段的 `tracing::warn!("…mutex `{}` is poisoned…")` —— `lock_or_warn` 自动发 |
| 测试短路超时 | `controller.set_split_pane_timeout_for_tests(Duration::from_millis(50))` —— 见 `tests::split_pane_times_out_when_no_response` |

## 11. 跨视图引用

- 想看**概念层级**（session / window / pane 是什么）→ `01-logical-view.md` §3
- 想看**任务拓扑**（更精简的图）→ `02-process-view.md` §3-§4
- 想看**模块树 + 构建链** → `03-development-view.md`
- 想看**子模块拆分原则**（哪些文件装什么）→ 本文档 §4
- 想看**wire 协议原文 + Bridge payload 翻译表** → `03-development-view.md` §4-§6
- 想看**Tauri command 列表 + 前端 wrapper** → `03-development-view.md` §5
- 想看**一个用户动作的端到端流程图** → `flows/01-open-tmux-session.md` / `flows/02-create-tmux-session.md`
- 想看**为什么这么设计**（PR-T3 为什么要合 pending_* / PR-T5 为什么要按 CommandKind 路由）→ `adr/0005-tmux-redesign-v0.md`
- 想看**bug 历史**（Bug 009 / 014 / 016 / 018 / 019 / 021 都是什么） → `changelog/bugs.md`
</content>
</invoke>