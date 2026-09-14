# xsterm tmux -CC 实现 — 实际代码视角

> **范围**：本文档描述 xsterm 当前仓库里 `tmux -CC` 集成**实际写下的代码**，而不是规格/PRD。
> 所有引用都带 `path:line` 或具体的结构体/函数名，方便核对。
> 数据来源：直接读源码 ~11000 行 Rust + 约 1500 行 TS。

## 0. 一句话

xsterm 把 `tmux -CC` 当成一个**子进程**（local 用 `tokio::process::Child`；SSH exec 用 russh channel）来跑；stdout 上的 `%xxx` 文本行协议被解析成 `ProtocolEvent`，然后 dispatch 到两个用途：

1. 写回 xsterm 侧的"会话注册表"（`pane_bindings`、`window_bindings`）。
2. 通过 `TmuxBridge` 翻译成 Tauri 前端事件（`session-output` / `tmux-pane-added` / `tmux-window-added` 等）。

每个 xsterm controller = 一个 `tmux -CC` 进程，**拥有 N 个 tmux pane**（对应 N 个 xsterm session）。 不存在一个 pane 一个 child。

## 1. 模块布局（实际文件）

```
src-tauri/src/
├── services/tmux/
│   ├── mod.rs                    模块入口；re-export TmuxController + From<TmuxError> for String
│   ├── commands.rs               老 shim，re-export protocol::wire
│   ├── events.rs                 老 shim，ProtocolEvent 别名 ControlEvent(已 deprecated)
│   ├── parser.rs                 老 shim，re-export protocol::parser
│   ├── escape.rs                 老 shim，re-export protocol::codec
│   ├── errors.rs                 thiserror 派生的 TmuxError 枚举
│   ├── dispatch.rs               spawn_dispatch_task + dispatch_event
│   ├── bridge/mod.rs             TmuxBridge — 把 ProtocolEvent 翻译成 Tauri 事件 + JSON
│   ├── protocol/                 纯协议层，无 I/O 无 runtime state
│   │   ├── mod.rs
│   │   ├── codec.rs              octal \nnn 编解码
│   │   ├── command.rs            CommandId / CommandKind / ResponseWaiter / TaggedCommand
│   │   ├── events.rs             ProtocolEvent 枚举
│   │   ├── parser.rs             line → Option<ProtocolEvent> 状态机
│   │   ├── version.rs            CapabilityMatrix + parse_version + infer_capabilities
│   │   └── wire.rs               高层 "send-keys" / "split-window" / ... 文本构造器
│   └── controller/
│       ├── mod.rs                TmuxController 主类 + reader/writer/monitor 任务
│       ├── id_map.rs             CommandRegistry — id → waiter + event_waiters FIFO
│       ├── handshake.rs          PR-T4 v2 handshake 计划 (version + capability → 步骤序列)
│       └── subscriber.rs         RouterState — 在 %begin..%end 之间累积 body line
└── infrastructure/tmux/
    ├── mod.rs
    └── backend.rs                TmuxBackend trait + LocalTmuxBackend + SshTmuxBackend
```

src/ 前端对应物：
```
src/
├── services/sessionService.ts    invoke 包装层：createTmux/attachTmux/splitTmuxPane/...
├── contexts/session/useTauriListeners.ts  listen("tmux-pane-added"/"-window-added"/"-controller-exit"...)
├── hooks/useTauriTerminalOutput.ts        listen("session-output")
├── hooks/sessionOutputChannel.ts          共享 binary Channel<Uint8Array>
└── hooks/useTmuxAutoAttach.ts             启动时重连持久化的 attached_tmux.json
```

## 2. 三层职责（不要混淆）

| 层 | 职责 | 状态？ | 关键文件 |
|---|---|---|---|
| **transport** | 拥有 tmux 子进程/SSH channel 的 stdin/stdout/stderr + wait/kill | 一次性 take | `infrastructure/tmux/backend.rs` |
| **protocol** | line ↔ wire payload ↔ typed event。无 I/O、无 channel | 完全 stateless | `services/tmux/protocol/*` |
| **orchestration** | spawn child, spawn 4 个 task, 跑 command registry, 路由 event 到 bridge | 全栈 runtime | `services/tmux/controller/*` + `dispatch.rs` |

这是后期重构的成果，但**未完成**。文件头注释 (`controller/mod.rs:1-15`) 自己说：

> This file is the original 3622-line `controller.rs`; PR-T3 copies it here so we can split it across `controller/{mod,id_map,subscriber,handshake,session}.rs` in later PRs without disturbing the import path (`crate::services::tmux::controller::*` keeps working).

当前状态（实测行数）：
- `controller/mod.rs` 3589 行（生产 1663 行 + `#[cfg(test)] mod tests` 1926 行 + 36 个测试函数）
- `controller/id_map.rs` 457 行 — `CommandRegistry`
- `controller/handshake.rs` 579 行 — v2 handshake
- `controller/subscriber.rs` 889 行 — `RouterState`

历史峰值 3622 行 → 现在 3589 行，主文件**几乎没瘦身**，PR-T3 只是换了个壳 + 抽了 `id_map`。后续 PR（T8 之后可能还有一波）预期要把 reader/writer/monitor task、`build_tmux_argv` / `shell_quote` / `tmux_spawn_err`、测试代码继续拆出去。`controller/mod.rs` 仍是单文件最大的代码债务。

## 3. controller/mod.rs 还装了什么（PR 状态提示）

仍留在 `controller/mod.rs` 没拆走的东西（按出现顺序）：

| 区域 | 行数范围 | 内容 |
|---|---|---|
| `SpawnMode` 枚举 | 49-61 | Create vs Attach，dispatch 据此决定行为 |
| `pub(crate) mod handshake / id_map / subscriber` | 63-73 | 子模块声明 + re-export |
| 常量 | 101-128 | 超时常量、默认 socket 名等 |
| `SplitResult / NewWindowResult / CaptureResult` type alias | 139-155 | Result 三元组 / 四元组 |
| `TmuxController` 结构体 | 180-298 | 字段表，包括 `pane_bindings / pane_window_bindings / window_bindings / registry / router_state` |
| `schedule_initial_state_sync` | 314-324 | OS 线程延 500ms 发 list-windows |
| `spawn_local / spawn_with_args / spawn_with_backend / spawn_attach` | 338-630 | 4 个 spawn 入口（含 SSH 路径） |
| `TmuxController` 实例方法 | 639-1384 | send_keys / resize_pane / capture_pane / close / await_first_pane / xsterm_id_for_pane / unbind_pane / split_pane / kill_pane / new_window / kill_window / rename_window / detach_client / kill_server / panes_for_window / tmux_window_id_for_pane / window_bindings / allocate_xsterm_id / allocate_xsterm_window_id / new_for_tests / register_pane / record_first_pane / **record_pane_window** |
| `build_tmux_argv` / `tmux_spawn_err` / `shell_quote` | 1397-1477 | spawn argv 构造 + 错误格式化 |
| `spawn_reader_task` | 1504-1560 | DCS 剥壳的 reader |
| `spawn_writer_task` | 1589-1606 | FIFO → stdin |
| `spawn_stderr_drain_task` | 1612-1622 | stderr → log |
| `spawn_monitor_task` | 1635-1662 | backend.wait() → Exit event |
| `#[cfg(test)] mod tests` | 1664-3589 | 36 个测试函数 |

**结论**：协议 / 编排责任分离的设计已经清楚，但**主文件实际承担的事仍然偏多**。下次需要找东西时记住：`TmuxController` struct 在 180-298 行、`spawn_with_backend`（核心） 在 409-558 行、所有命令方法在 639-1155 行。

## 4. TmuxBackend：transport 抽象

`infrastructure/tmux/backend.rs:82-110` 定义 trait：

```rust
pub trait TmuxBackend: Send + Sync + 'static {
    fn take_stdout(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String>;
    fn take_stdin(&mut self) -> Result<Box<dyn AsyncWrite + Send + Unpin>, String>;
    fn take_stderr(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String>;
    fn wait(&mut self) -> BoxFuture<'_, Result<i32, String>>;
    fn kill(&mut self) -> Result<(), String>;
}
```

两个实现：
- `LocalTmuxBackend`（同文件 116-170 行）：直接包 `tokio::process::Child`，三个 `take_*` 就是 `self.child.stdout.take()` 等。
- `SshTmuxBackend`（同文件 197-）：包 `SshConnectResult`（russh exec channel）。russh 数据循环在另一线程跑，把字节桥接到 `tokio::sync::mpsc`，让 SSH 通道能喂 `AsyncRead`/`AsyncWrite`。stderr 是空的（russh exec channel 不暴露 stderr）。

设计目的（doc 注释明确写）：让 SSH 路径与 local 路径共享同一套 reader/writer/monitor 任务。

## 5. controller 的 4 个 task + 5 条 channel

`controller/mod.rs:409-558` 的 `spawn_with_backend` 一口气起 4 个 tokio task：

```
TmuxController
├── backend: Arc<Mutex<Option<Box<dyn TmuxBackend>>>>   // 共享所有权：close() vs monitor() 抢
├── stdin_tx: UnboundedSender<String>                   // 写入命令
├── (dispatch_tx, dispatch_rx): UnboundedSender/Receiver<ProtocolEvent>
├── (first_pane_tx, first_pane_rx): oneshot<(u32, String)>
├── pane_bindings: Mutex<HashMap<tmux_pane_id, xsterm_session_id>>
├── pane_window_bindings: Mutex<HashMap<tmux_pane_id, tmux_window_id>>
├── window_bindings: Mutex<HashMap<tmux_window_id, xsterm_window_id>>
├── registry: CommandRegistry            // PR-T3+ 单一等待队列
├── router_state: Mutex<RouterState>    // PR-T5+ body 累积器
└── 4 个 task：
    ├── reader_task     stdout → BufReader::lines → strip DCS → ProtocolParser::feed → dispatch_tx
    ├── writer_task     stdin_rx.recv() → stdin.write_all + flush; channel 关 → shutdown()
    ├── stderr_drain    stderr line → tracing::warn
    └── monitor_task    backend.wait() → 若非主动 killed 则 dispatch_tx.send(Exit)
```

**关键的不可见细节**（读代码才知道）：
1. **DCS passthrough 必须剥**（`controller/mod.rs:1487-1560`）。tmux -CC 通过 SSH 时把整个 wire 协议包在 `ESC P 1000 p ... ESC \` 里，所以 `BufReader::lines()` 收到的第一行是 `"ESC P 1000 p%begin ..."`，没有这个 strip 整个协议就废了（Bug 009）。
2. **reader 在 EOF 时不主动发 Exit**；只有 monitor task 在 child 退出时（非 killed 状态）发 `ProtocolEvent::Exit`。
3. **killed AtomicBool + try_lock 后端** 用于 close() 不与 monitor 死锁（`controller/mod.rs:808-840`）。

## 6. 协议层：protocol/

### 6.1 codec (`protocol/codec.rs`)
octal `\nnn` 编解码。tmux 3.x 的 escape 集是 `< 0x20 || > 0x7E || == 0x5C`，所以编码端要 `b < 0x20 || b == 0x5C || b >= 0x80` 时才转义；解码端 `\` 后必须跟 3 个八进制位，否则按字面输出（避免误伤）。

### 6.2 events (`protocol/events.rs`)
30+ 变体的 `ProtocolEvent` 枚举（被旧 alias `ControlEvent` 别名保留）：

```rust
pub enum ProtocolEvent {
    Output { pane_id: String, data: Vec<u8> },
    ExtendedOutput { pane_id, age_ms, data },
    SessionChanged { session_id, name },
    SessionRenamed { session_id, name },
    SessionClosed { session_id },
    SessionWindowChanged { session_id, window_id },
    SessionsChanged,
    WindowAdd { window_id },
    WindowClose { window_id },
    WindowRenamed { window_id, name },
    WindowPaneChanged { window_id, pane_id },
    UnlinkedWindowAdd / UnlinkedWindowClose { window_id },
    LayoutChange { window_id, layout, visible_layout, flags },
    PaneModeChanged / PaneExited / PaneDied { pane_id },
    PasteBufferChanged { buffer_name },
    ClientDetached { client },
    ClientSessionChanged { client, session_id, name },
    Exit { reason: Option<String> },
    ConfigError { message },
    Pause / Continue { pane_id },        // backpressure (Perf 003)
    CommandBegin { id: u32, timestamp, flags },
    CommandEnd   { id: u32, timestamp, flags },
    CommandError { id: u32, timestamp, flags, message },
    CommandOutput { id: u32, line },     // 仅在 %begin..%end 块内
    PopupOpen / PopupOutput / PopupClose { line },
    Unknown { line },
}
```

注意 `CommandBegin/CommandOutput/CommandEnd/CommandError` 都带 `id: u32` —— 这是 tmux 在 `%begin T I F` 第二字段回显的 command id，跟 xsterm 注册时分配的 `CommandId(u64)` 对应。

### 6.3 parser (`protocol/parser.rs`)
纯状态机：每条已 trim 换行的字符串 → `Option<ProtocolEvent>`。状态就是 `current_command_id: Option<u32>`：

```
outside 任何 %begin 块：
  - 空行 / 纯空白 → None（tmux 的 keepalive ping）
  - 非 % 开头 → Unknown { line }
  - %begin T I F → 设 current_command_id = I, 出 CommandBegin
  - %end/%error 在块外 → Unknown
  - 其他 %xxx → 对应 typed event
inside %begin..%end 块：
  - 任何行 → CommandOutput { id, line }（包括嵌套的 %begin/%end 不匹配的）
  - 匹配的 %end T I F → 清状态, 出 CommandEnd
  - 匹配的 %error → 清状态, 出 CommandError（丢弃已累积 body）
```

`%output` 解析特别：必须保留分隔空格后的所有内容（包括嵌入空格、escape 序列）。实现见 `parse_output_event` (parser.rs:342-362)，用 `find(' ')` 找 pane_id 边界，不走 `split_ascii_whitespace`。

### 6.4 wire (`protocol/wire.rs`)
高层文本构造器，每个返回 `'\\n'`-terminated 字符串直接喂 stdin。关键构造器：

| 函数 | 生成的命令 | 用途 |
|---|---|---|
| `send_keys(pane_id, bytes)` | `send-keys -l -t <pane> "<escaped>"` | 写数据到 pane |
| `split_window(pane, horiz)` | `split-window [-h\|-v] -t <pane>` | 拆 pane |
| `kill_pane(pane)` | `kill-pane -t <pane>` | 销毁 pane |
| `new_window_in_current(name)` | `new-window [-n "<name>"]` | 创建 window |
| `kill_window(win)` | `kill-window -t <win>` | 销毁 window |
| `rename_window(win, name)` | `rename-window -t <win> <name>` | 改名 window |
| `resize_pane(pane, x, y)` | `resize-pane -t <pane> -x <x> -y <y>` | 调 pane 尺寸 |
| `capture_pane(pane, lines)` | `capture-pane -p -e -J -S -<lines> -t <pane>` | 拉 scrollback |
| `attach_session_create()` | `attach-session -c ""` | bootstrap（>=2.6） |
| `refresh_client_control()` | `refresh-client -C` | **第一个**命令（>=2.2） |
| `list_windows(_s)` | `list-windows -a -F '<fmt>'` | bootstrap 拉窗口 |
| `list_panes_with_format(win, fmt)` | `list-panes -a [-t <win>] -F '<fmt>'` | bootstrap 拉 pane |
| `detach_client(session)` | `detach-client -s <session>` | 优雅断开 |
| `kill_server()` | `kill-server` | 关掉整个 tmux server |

**`send_keys` 的精妙处**（Bug 024 的修复，wire.rs:78-87）：
1. `escape_output(keys)` 把所有控制字节 / `\` / 高位字节变 `\nnn`。
2. 外面再套 `"..."`，并替换嵌入的 `"` 为 `\"`。
3. 用 `-l` 让 tmux 把整个参数当字面量（不然 `hello` 不是 key name，会被静默丢弃）。
4. 这样 tmux 的命令 tokenizer 不会在空白处断键，而 octal 解码还原所有字节。

`list-panes` / `list-windows` 默认格式常量：

```
DEFAULT_PANE_LIST_FORMAT  = #{pane_id}\t#{window_id}\t#{session_id}\t#{pane_active}\t
                            #{pane_width}\t#{pane_height}\t#{pane_current_path}\t#{pane_title}
DEFAULT_WINDOW_LIST_FORMAT = #{window_id}\t#{session_id}\t#{window_name}\t#{window_active}\t#{window_layout}
```

### 6.5 version + capabilities (`protocol/version.rs`)
协议启动握手时用来判断能力：

```
CapabilityMatrix {
    supports_new_session_dash_a,           // tmux -A  (>=3.2)
    supports_refresh_client_dash_c,       // refresh-client -C 无参 (>=3.0)
    auto_pushes_window_pane_changed,      // %window-pane-changed 自动推 (>=3.0)
    supports_attach_session_dash_c_empty, // attach-session -c "" (>=2.6)
    uses_dcs_passthrough,                 // SSH 通道默认 true
}
```

`parse_version("3.5a")` → `TmuxProtocolVersion { major: 3, minor: 5, patch: Some("a") }`。
`infer_capabilities(v, list_commands)` 从 `list-commands` 行（tmux 的 `[-AdE]` 方括号简写）再 refine 一次。

### 6.6 command envelope (`protocol/command.rs`)
PR-T3 引入，PR-T5 接进 router，PR-T8 收尾。核心类型：

```rust
pub struct CommandId(pub u64);          // 单调递增
pub enum CommandKind {                   // 闭枚举：加变体必须改 router
    DisplayVersion, ListCommands,
    AttachSession, NewSession { attach: bool },
    NewWindow { name: Option<String> },
    ListWindows, ListPanes { window_id: Option<String> },
    SendKeys { pane_id }, SplitWindow { pane_id, horizontal },
    KillPane { pane_id }, KillWindow { window_id },
    RenameWindow { window_id, name },
    ResizePane { pane_id, cols, rows },
    CapturePane { pane_id, lines },
    RefreshClient { control_mode },
    ListSessions, Detach,
}
pub enum ResponseWaiter {
    BeginEnd(oneshot::Sender<ResponseOutcome>),
    Event(oneshot::Sender<ProtocolEvent>),  // 保留未用
}
pub enum ResponseOutcome {
    Ok { body_lines: Vec<String> },
    Err { message: String },
}
pub struct TaggedCommand { id: CommandId, kind: CommandKind, wire: String }
```

为什么 wire 不带 waiter？waiter 单一住在 `CommandRegistry`，避免两条路径同时 resolve 同一 promise（详见 `protocol/command.rs:309-316` 注释）。

event 相关（PR-T8 W3b）：

```rust
pub enum EventWaiterKind { SplitResult, NewWindowResult, Bootstrap }
pub enum EventWaiterSender { Split(oneshot<SplitResult>), NewWindow(oneshot<NewWindowResult>), None }
pub struct EventWaiter { kind, sender, tmux_window_id: Option<String>, xsterm_window_id: Option<u32> }
```

`SplitResult = Result<(xsterm_session_id, tmux_pane_id, tmux_window_id), TmuxError>`，
`NewWindowResult = Result<(xsterm_window_id, tmux_window_id, xsterm_session_id, tmux_pane_id), TmuxError>`。

## 7. CommandRegistry：单一等待队列（PR-T3/T5/T8）

`controller/id_map.rs`。**历史**：老代码有五个独立的 `pending_*` 队列
（`pending_splits`, `pending_windows`, `pending_window_pane`, `pending_capture`, `pending_bootstrap`），Bug 011/014/016/017 全是这几条队列与响应失同步的变体。现在合并：

```rust
pub struct CommandRegistry {
    next_id: AtomicU64,
    by_id: Mutex<HashMap<CommandId, ResponseWaiter>>,     // 命令 id → waiter
    completed: AtomicU64,                                 // 诊断用
    event_waiters: Mutex<Vec<EventWaiter>>,               // FIFO for %window-pane-changed / %window-add
}
```

关键 API：

| API | 用处 |
|---|---|
| `register(kind, wire, waiter)` → `RegisteredCommand` | 在同一把锁里分配 id + 插 waiter，原子 |
| `take(id)` → `Option<ResponseWaiter>` | router 看到 `%end %<id>` 时调用 |
| `register_event_waiter(EventWaiter)` → `usize` | 推入 FIFO |
| `take_event_waiter_for_split()` | 弹最早的 `SplitResult + window_id=None` |
| `take_event_waiter_for_new_window_unbound()` | 弹 `NewWindowResult + window_id=None`（`%window-add` 那一步） |
| `take_event_waiter_for_window(window_id)` | 弹任何 kind 但 `window_id == Some(..)` |
| `event_waiter_count()` | bootstrap 判断 |
| `drain_all()` | close 时清空，让阻塞的 await 立即醒 |

`register` 的原子性是核心保证：`fetch_add` 与 `by_id.lock().insert` 在同一临界区，杜绝了 `%begin` 比 waiter 早到的 race。

## 8. RouterState：body 累积 + waiter resolve（PR-T5'）

`controller/subscriber.rs`。把 `%begin..%end` 之间的 body 行收成 `Vec<String>`，在 `%end` 时连同 `body_lines` 一起发给 `BeginEnd` waiter：

```rust
pub struct RouterState { in_flight: Option<InFlightBody> }
struct InFlightBody { cmd_id: u32, lines: Vec<String> }

pub enum RouterAction {
    Ignore,
    UnknownCommandStart { cmd_id },        // fire-and-forget %begin
    UnknownCommandEnd   { cmd_id, errored, message },
    OrphanCommandEnd    { cmd_id },        // %end 没在 in-flight
    BodyLine { cmd_id, line },
    Resolve,                               // 已解决 waiter
    DelegateToV1,                          // fire-and-forget %end：dispatcher 自己处理 body
}

fn process(&mut self, event, registry, &bridge, &controller) -> RouterAction
```

fire-and-forget 命令（`list-windows` / `list-panes` 启动 bootstrap 用）的 body 不被 RouterState 自己消化 —— 它返回 `DelegateToV1`，让 dispatcher 调 `take_in_flight_lines()` 拿 body 后丢给 `handle_classified_response`，后者按首字符 `@` / `%` 决定是 WindowList 还是 PaneList，再触发后续 bootstrap 链。

**关键 invariant**（subscriber.rs:236-244）：`in_flight` 必须在 waiter-presence 检查之前初始化。否则 fire-and-forget list 查询的 body 会丢，整个 bootstrap 链卡 5s timeout。

## 9. 完整生命周期

### 9.1 spawn（本地 PTY 路径）

`controller/mod.rs::spawn_local` (338-376) → `build_tmux_argv(config)` 构造 `["-CC", "-L", "<socket>", "new-session", "-A", "-s", "<name>", "-x", "80", "-y", "24"]` → `tokio::process::Command::new("tmux").args(...).spawn()` → 包装成 `LocalTmuxBackend` → 走 `spawn_with_backend`。

注意：`new-session -A`（attach）而非 `-d`（detached），避免 Bug 014 —— tmux 在 `-d` 下会立刻关掉 control session。

### 9.2 spawn（SSH 路径）

同一函数（338-362 行）：走 `ssh_backend.connect_exec(ssh_cfg, &command)` 把 `tmux -CC -L ...` 字符串送过去，得到 `SshConnectResult` → 包装成 `SshTmuxBackend`。channel 由 `SshBackendLifetime` 持住；russh 数据循环通过 `sync_mpsc` ↔ `tokio::mpsc` 桥把字节喂给 reader/writer。

### 9.3 spawn_with_backend (409-558)

4 个任务 + 4 个 channel 的搭建。
注意这里**故意不再发 `new-window`**（Bug 015 老逻辑已删）：bootstrap 窗口由 dispatch 链自己发现（`%window-add` → `list-windows` 调度 → `list-panes` 调度 → 注册 first pane）。

`mode == Create` 的情况下，调度一个 OS 线程在 500ms 后发 `list-windows -a -F ...`（`schedule_initial_state_sync`，314-324）。delay 是为了等 reader task 先跑起来（Bug 017）。

`mode == Attach` 的情况下，发 `list-windows` + `list-panes` 两条；不再发 `list-windows` 也不会有 `%window-add`（因为没新增 window），所以直接进 bootstrap。

### 9.4 dispatch 链（关键状态机）

reader task 把每行送给 `ProtocolParser::feed`，得到 `Vec<ProtocolEvent>` 推到 `dispatch_tx`。dispatch task 循环 `dispatch_event`：

**`%window-pane-changed` 五级 fallthrough**（`dispatch.rs:92-219`）：
1. 已 bound → 忽略（tmux 重复推 active pane 切换）。
2. 有 `SplitResult` event waiter → 弹出来，分配 xsterm id，`register_pane` + `record_pane_window` + `emit_tmux_pane_added` + resolve oneshot。
3. 有 `window_id` key 的 waiter（NewWindowResult 或 Bootstrap）→ 同样注册 pane + emit；如果 waiter 是 `NewWindowResult`，多 emit 一个 `tmux-window-added` 并 resolve `NewWindow` sender；如果是 `Bootstrap`，只 `record_first_pane`（frontend 已经有该 Window 了）。
4. Legacy fallback：`first_pane_tx` 还在的话当 bootstrap 处理（Wave 1/2 残留，注释说"测试可能在没有真 tmux 的情况下驱动 dispatch"）。
5. 外部 pane（用户在 pane 内部敲了 `C-b "` 之类）→ 仅 debug log，不自动 bind。

**`%window-add` 三分枝**（dispatch.rs:220-289）：
1. 有 `NewWindowResult + window_id=None` waiter → 弹出来，分一个 xsterm_window_id，把它改成 `window_id = Some(...)` 重新 register，等匹配的 `%window-pane-changed` 来 resolve。
2. 没有该 waiter 且 `window_bindings` 空 + 没别的 event waiter → bootstrap 窗口：分配 xsterm_window_id，注册 `Bootstrap` event waiter（`tmux_window_id = Some(...)`），让第 3 步那个 pane 来了再处理。
3. 都不是 → 外部 window，log 即可。

**`%window-close`** (290-330)：从 `window_bindings` 删记录，把同窗口的 pane binding 也一并清掉（防御 `tmux-pane-exited` 乱序到达），emit `tmux-window-closed`。

**`%pane-exited` / `%pane-died`** (350-378)：删 `pane_bindings` / `pane_window_bindings`，emit `tmux-pane-removed`。

**`%output`** (80-91)：直接通过 bridge 把字节 emit 成 `session-output`。**性能关键**：这是 hot path，前端通过 binary Channel 接收（Perf 001）。

**`%pause` / `%continue`**：emit `tmux-paused` / `tmux-continued`，前端可以做 backpressure。

**`Exit`**：emit `tmux-controller-exit`，前端 listener 据此把所有属于这个 controller_id 的 session 从 React state 里删。

**`CommandBegin/CommandOutput/CommandEnd/CommandError`** (396-440)：交给 `RouterState::process()`。`%end` 时如果是 `DelegateToV1`，dispatch 调 `take_in_flight_lines()` 拿 body，丢给 `handle_classified_response`。

**Bootstrap 链（Bug 016/017 修复）**：
```
schedule_initial_state_sync (500ms 后)
  → list-windows -a -F <format>
  → dispatch 看到 %begin..%end 结束 (RouterAction::DelegateToV1)
  → handle_classified_response: 首行 @ → emit_window_list
    • emit "tmux-window-list" (rows)
    • 对每行分配 xsterm_window_id，注册 Bootstrap event waiter，
      并插入 window_bindings ← **Bug 0009 修复点**
  → trigger_followup_list_panes
    → list-panes -a -F <format>
    → dispatch 看到 %begin..%end 结束 (DelegateToV1)
    → handle_classified_response: 首行 % → emit_pane_list
      • 对每行分配 xsterm_id
      • register_pane + record_pane_window (再次写 window_bindings)
      • 第一个 pane 调 record_first_pane → await_first_pane 醒
      • emit "tmux-pane-list"
```

### 9.5 SessionManager::create_tmux（310-393）

`SessionManager.create_tmux()`：
1. 分配 controller_id。
2. `TmuxController::spawn_local()`。
3. `await_first_pane()` —— 通过 oneshot，最多 5s。oneshot 在 `record_first_pane` 时由 dispatch 链 send。
4. 用 `tmux_window_id_for_pane` 查 pane → window 映射，再用 `xsterm_window_id_for` 查 window → xsterm 映射。
5. 构造 `SessionInfo { id, tmux_controller_id, tmux_pane_id, tmux_window_id, xsterm_window_id, is_hidden: false }`（Create 模式可见）。
6. 把 `TmuxPaneHandle { controller, tmux_pane_id, info, capabilities }` 插入 `sessions` DashMap。

`TmuxPaneHandle` 实现 `SessionBackend` trait：`write()` → `controller.send_keys(...)`；`resize()` → `controller.resize_pane(...)`；`close()` → `controller.unbind_pane(...)`（不杀 controller，可能还有别的 pane）。

### 9.6 关闭

`close_session(xsterm_session_id)` → SessionManager → 通过 SessionBackend trait → `controller.unbind_pane`（仅清 binding）。

`close_window` 在 pane-tree 维度，遍历 pane 调 close；最后一个 pane 关掉后由 dispatch 的 `%pane-exited`/`%window-close` 清干净。

`kill_tmux_pane` / `kill_tmux_window` / `detach_tmux_controller` / `kill_server` 是显式 Tauri 命令，分别发送：
```
kill-pane -t %<pane>
kill-window -t @<win>
detach-client -s <session_name>
kill-server
```

## 10. Tauri 命令层（commands/session.rs）

命令注册在 `commands/mod.rs`，列举与前端 invoke 名字一一对应：

| Tauri 命令 | 前端 wrapper | 说明 |
|---|---|---|
| `create_tmux_session` | `createTmux` | 走 `SessionManager::create_tmux` |
| `attach_tmux_session` | `attachTmux` | 走 `SessionManager::attach_tmux`，spawn 路径走 `SpawnMode::Attach` |
| `probe_tmux_session_exists` | `probeTmuxSessionExists` | 让前端决定走 create 还是 attach |
| `create_tmux_pane` | `createTmuxPane` | 内部 `TmuxController::split_pane`，等 `%window-pane-changed` |
| `kill_tmux_pane` | `killTmuxPane` | 内部发 `kill-pane` |
| `create_tmux_window` | `createTmuxWindow` | 内部发 `new-window`，等 `%window-pane-changed` |
| `kill_tmux_window` | `killTmuxWindow` | 内部发 `kill-window` |
| `rename_tmux_window` | (内部) | 内部发 `rename-window` |
| `capture_tmux_pane` | `captureTmuxPane` | 走 `Controller::capture_pane` 走 `%begin..%end` |
| `detach_tmux_controller` | `detachTmux` | 内部发 `detach-client -s <session>` |
| `kill_server` | (内部) | 内部发 `kill-server` |
| `auto_attach_tmux_servers` | `autoAttachTmuxServers` | 重连 attached_tmux.json 持久列表 |
| `get_attached_tmux_servers` | `getAttachedTmuxServers` | 列已 attach |
| `write_session` / `resize_session` / `close_session` | `writeSession`/... | 通用 |
| `get_session_output_channel` | (启动一次) | 返回共享 binary Channel<Uint8Array>（Perf 001） |

## 11. TmuxBridge：把事件翻译成 Tauri 事件

`services/tmux/bridge/mod.rs`。每个 Tauri 事件对应一个方法：

| Bridge 方法 | Tauri 事件名 | Payload shape | 触发源 |
|---|---|---|---|
| `emit_session_output` | `session-output` | `[xsterm_session_id, data[]]` (binary) | `%output` |
| `emit_tmux_pane_added` | `tmux-pane-added` | `{xsterm_session_id, tmux_pane_id, tmux_controller_id, tmux_window_id, session_type}` | split-result path 的 `%window-pane-changed` |
| `emit_tmux_pane_added_with_window` | `tmux-pane-added` | `{controllerId, tmuxPaneId, xstermSessionId, parentTmuxWindowId}` | bootstrap path `emit_pane_list`（字段复用，前端两个都吃） |
| `emit_tmux_window_added` | `tmux-window-added` | `{xsterm_window_id, tmux_window_id, tmux_controller_id, session_name, xsterm_session_id?, xsterm_pane_id?}` | new-window 完成 |
| `emit_tmux_window_added_for_list` | `tmux-window-list` | `{controller_id, windows: [...]}` | `list-windows` 响应 |
| `emit_tmux_pane_added_for_list` | `tmux-pane-list` | `{controller_id, panes: [...]}` | `list-panes` 响应 |
| `emit_tmux_window_closed` | `tmux-window-closed` | `{controller_id, tmux_window_id, xsterm_window_id}` | `%window-close` |
| `emit_tmux_window_renamed` | `tmux-window-renamed` | `{controller_id, tmux_window_id, xsterm_window_id, name}` | `%window-renamed` |
| `emit_tmux_pane_removed` | `tmux-pane-removed` | `{controller_id, tmux_pane_id, xsterm_session_id}` | `%pane-exited` |
| `emit_tmux_paused` / `emit_tmux_continued` | `tmux-paused` / `tmux-continued` | `{tmux_pane_id}` | `%pause` / `%continue` |
| `emit_tmux_controller_exit` | `tmux-controller-exit` | `{controller_id, reason}` | monitor 任务 Exit |

`try_emit` (392-405) 是统一包装：emit 失败只 warn 不 panic（前端可以从下一个 list 事件恢复）。

## 12. 前端监听（useTauriListeners.ts）

每个 Tauri 事件在前端都有 `listen<...>("event-name", handler)`，大致：

- `tmux-pane-added` (278-307)：如果同 id Session 已存在（bootstrap pane）就 short-circuit；否则用 `buildTmuxPaneSession` 造一个塞进 React state。**注意：pane 树更新由 `usePaneActions.splitTmuxPane` 在用户操作的上下文里做**，这个 listener 只保证 Session 注册表存在。
- `tmux-window-added` (362-527)：如果 workspace 里已有该 `xstermWindowId` 就跳过 Window insert（bootstrap window 已由 `createAndActivateSession` 同步插入，dedupe）。否则造 Window + Session。
- `tmux-window-list` (680-752)：attach 模式下批量安装 server 上所有现有 window 的 xsterm Window，每行 dedupe（同 id 不重复 insert）。
- `tmux-pane-list`：同窗口列表。
- `tmux-pane-removed`：从 React state 删 Session，从 pane 树移除 leaf 并 collapse。
- `tmux-window-closed`：删所有死 Session、删 ghost Window；留下 control window（用户手动 × 关）；同时塞 `tmuxControllerErrors` map 触发 retry banner。
- `tmux-controller-exit`：等价于 close everything owned by this controller。
- `session-output` (hooks/useTauriTerminalOutput.ts:132)：通过 `Channel<Uint8Array>` 收，写进 xterm.js；frontend payload 是 `[sessionId, byte[]]`。

## 13. 持久化与自动重连

- `attached_tmux.json`（Tauri app data 目录）存已 attach 的 tmux server 列表。
- 应用启动时 `useTmuxAutoAttach` 调 `autoAttachTmuxServers`，对每条记录 spawn `tmux -CC attach-session -t <name>` 走 `SpawnMode::Attach`。
- `create_tmux_session` / `attach_tmux_session` 成功后立即保存新列表。

## 14. 性能与 backpressure

- `session-output` 是热路径：从 reader task → bridge → Tauri 的 binary Channel，前端每帧消费一次。
- `%pause` / `%continue` 是 tmux 主动的背压信号，前端可以选择暂停 rAF 批写（Perf 003）。
- `send_keys` 是 fire-and-forget（不 await %begin..%end），写吞吐靠 writer task 的 FIFO + flush 维持。
- `capture-pane` 用 `capture_lock: tokio::sync::Mutex<()>` 串行化（同时只能有一个 capture 在飞）。

## 15. 跨 SSH 路径的差异

- local 走 `LocalTmuxBackend`，reader 直接拿 `Child::stdout`；
- SSH 走 `SshTmuxBackend`：russh data loop 在另一线程把字节推 `sync_mpsc`，bridge 线程再把它们转 `tokio::mpsc` 让 reader task 当 AsyncRead 用；写反之。stderr 永远空。
- DCS passthrough 在 SSH 路径必现（`uses_dcs_passthrough: true`），reader 已统一剥。

## 16. Bug 备忘（实际修过的关键 race / 缺陷）

| Bug | 现象 | 代码层修复 |
|---|---|---|
| 009 | SSH 通道下 DCS 包壳导致整行丢 | reader task 剥 DCS 头尾 |
| 011 | 5 个 pending 队列与响应失同步 | PR-T3/T5/T8 合并为 CommandRegistry |
| 014 | OpenBSD tmux 解析 `refresh-client -C` 要 `-C 1` | PR-T4 handshake plan_for 标 capability；降级到 `-C 1` 在 PR-T5 router |
| 015 | 老逻辑创建后无条件发 new-window，server 上多一个空窗 | Bug 0009 修复连带删除 |
| 016 | tmux 不自动推 %window-pane-changed | bootstrap 链用 list-windows + list-panes 兜底 |
| 017 | list-panes 与 new-window 竞争 | schedule_initial_state_sync 延 500ms |
| 024 | `send-keys` 空格/多字符被 tmux token 化吞掉 | `wire::send_keys` 加 `-l` + `"..."` + escape_output |
| 0009 | `record_pane_window` 只写 `pane_window_bindings` 而漏 `window_bindings`，导致 `xsterm_window_id_for()` 返回 None | `controller/mod.rs:1360-1378` 同时写两表 |
| 0009c | Attach 模式下本地窗数 < server 窗数（bridge 不发 `tmux-window-added` 给已有 window） | `emit_window_list` 主动 emit `tmux-window-list` batch |

## 17. 术语对照

- **xsterm session / tmux pane**：xsterm session 是连接（`Session.id` u32），tmux pane 是 server 上一个 shell process；N:1（多个 xsterm 不会指向同一 tmux pane，1:1）。
- **xsterm Window / tmux window**：1:1；xsterm Window 是 PaneTree 的容器（UI 二级），tmux window 是 server 上一个独立 tab。
- **xsterm pane leaf / tmux pane**：1:1；leaf 渲染一个 xterm.js 实例，绑定一个 Session。
- **TmuxController**：1 个 tmux -CC 子进程 = 1 个 controller；同 controller 下所有 pane 共用 stdin/stdout/wait。
- **xsterm window id 命名空间**：`controller_id * 1_000_000 + 1..`（window id 走 +500_000 偏移以避免和 pane id 撞），这样不同 controller 的 window id 不会冲突。
- **command id**：xsterm 内部 `CommandId(u64)`，单调递增；tmux 在 `%begin/end/error` 第二字段回显 `u32`。Router 用 `as u32` 收窄。

## 18. 看代码从哪里开始

- 想理解 wire 格式：`services/tmux/protocol/wire.rs` + `codec.rs`（小、好读）。
- 想理解事件枚举：`services/tmux/protocol/events.rs`（30 变体列表）。
- 想理解 parser：`services/tmux/protocol/parser.rs::ProtocolParser::feed` + `parse_outer`。
- 想理解 controller 主流程：`services/tmux/controller/mod.rs::spawn_with_backend` + `TmuxController::send_keys` / `split_pane` / `new_window` / `capture_pane`。
- 想理解 dispatch：`services/tmux/dispatch.rs::dispatch_event`（大 match，但五级 fallthrough 都注释了）。
- 想理解 RouterState：`services/tmux/controller/subscriber.rs::RouterState::process`（P5' 责任划分）。
- 想理解 handshake：`services/tmux/controller/handshake.rs::plan_for`（PR-T4 能力矩阵到命令序列）。
- 想理解前端契约：`src/contexts/session/useTauriListeners.ts` + `src/services/sessionService.ts`。
