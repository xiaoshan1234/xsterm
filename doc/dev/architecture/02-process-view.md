# 02 进程视图 (Process View)

> **关心什么**：运行时有哪些 tokio task、它们之间的 channel 拓扑、并发原语、生命周期、shutdown 顺序。
> 不关心：UI 树、数据契约、Tauri capability 配置。

## 1. 进程总览

```
┌──────────────────────────────────────────────────────────┐
│ ai-terminal.exe (Tauri 主进程，Rust)                       │
│                                                          │
│  ┌──────────────┐  tokio::mpsc  ┌──────────────────┐    │
│  │ pty/ssh/tmux │ ────────────▶│ SessionManager    │    │
│  │ backends     │ ◀─────────── │ (DashMap<u32,…>)  │    │
│  └──────────────┘              └──────────────────┘    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐     │
│  │ tmux 子系统（每个 controller）                  │     │
│  │   reader / writer / dispatch / monitor tasks    │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  ┌──────────────────┐                                     │
│  │ WebView2 (UI)    │◀──── invoke/listen ────         │
│  │ React + xterm.js │                                     │
│  └──────────────────┘                                     │
└──────────────────────────────────────────────────────────┘
```

主进程 = Tauri + tokio runtime + 所有 backend tasks。**前端 React 跑在 WebView2 独立进程里**，与主进程通过 IPC + 共享 channel 通讯。

## 2. SessionManager 并发模型

`SessionManager` 是单例（在 Tauri `State` 里），核心数据结构：

```rust
pub struct SessionManager {
    sessions: DashMap<u32, ActiveSession>,         // xsterm session id → session
    tmux_controllers: DashMap<u32, Arc<TmuxController>>,
    // ...
}
```

- `DashMap` 内部分段锁，**读写无全局竞争**
- 每个 `ActiveSession` 持有自己的 `Box<dyn Backend>` + IO channel
- 跨 session 的写操作通过 `Arc<Mutex<SessionManager>>` 串行化（命令调用路径）

**并发原则**：
1. 跨 session 操作走 `Mutex<SessionManager>`（短临界区）
2. 单 session 内操作走 `DashMap` shard（细粒度）
3. **绝不在锁内做 IO**

## 3. tmux controller 的 4 个 task + 5 条 channel

> 这是 P1-P5 重构**之后**的稳定形态。重构前是 7 个 `pending_*` 字段 + 5 层 dispatch fallthrough，已全删。
> 代码：`src-tauri/src/services/tmux/controller/mod.rs::spawn_with_backend`（约 409-558 行）

```
TmuxController (Arc 共享所有权)
├── backend: Arc<Mutex<Option<Box<dyn TmuxBackend>>>>    // close() vs monitor() 抢
├── stdin_tx: UnboundedSender<String>                    // 写入命令，**永不阻塞 caller**
├── (dispatch_tx, dispatch_rx): UnboundedSender/Receiver<ProtocolEvent>
├── (first_pane_tx, first_pane_rx): oneshot<(u32, String)>
├── pane_bindings: Mutex<HashMap<tmux_pane_id, xsterm_session_id>>
├── pane_window_bindings: Mutex<HashMap<tmux_pane_id, tmux_window_id>>
├── window_bindings: Mutex<HashMap<tmux_window_id, xsterm_window_id>>
├── registry: CommandRegistry                            // PR-T3+ 单一等待队列
├── router_state: Mutex<RouterState>                     // PR-T5+ body 累积器
└── 4 个 task：
    ├── reader_task     stdout → BufReader::lines → strip DCS → ProtocolParser::feed → dispatch_tx
    ├── writer_task     stdin_rx.recv() → stdin.write_all + flush; channel 关 → shutdown()
    ├── stderr_drain    stderr line → tracing::warn
    └── monitor_task    backend.wait() → 若非主动 killed 则 dispatch_tx.send(Exit)
```

### 3.1 Channel 用途一览

| Channel | 类型 | 用途 | 谁写 | 谁读 |
|---|---|---|---|---|
| `stdin_tx` | `UnboundedSender<String>` | 把 tmux 命令文本送进 writer | `send_keys` / `split_pane` / `new_window` / ... | writer_task |
| `dispatch_tx` / `dispatch_rx` | `UnboundedSender<ProtocolEvent>` / `Receiver` | reader / monitor 把解析后的事件送进分发 | reader_task / monitor_task | dispatch task |
| `first_pane_tx` / `first_pane_rx` | `oneshot<(u32, String)>` | 首次 `%window-pane-changed` 信号 | reader_task（一次性） | attach 路径的 bootstrap 调用者 |
| `pending_splits: Mutex<VecDeque<oneshot::Sender>>` | 内部字段 | split_pane 等 `%window-pane-changed` 响应 | `split_pane` API 调用者 | dispatch task（pop front 匹配响应） |

### 3.2 关键并发细节（读代码才知道）

1. **DCS passthrough 必须剥**（`controller/mod.rs:1487-1560`）
   tmux -CC 通过 SSH 时把整个 wire 协议包在 `ESC P 1000 p ... ESC \` 里。
   `BufReader::lines()` 收到的第一行是 `"ESC P 1000 p%begin ..."`，没有这个 strip 整个协议就废了（**Bug 009**）。
   reader task 已经**统一**剥，不分 local / SSH。

2. **reader 在 EOF 时不主动发 Exit**
   只有 monitor task 在 child 退出时（非 killed 状态）发 `ProtocolEvent::Exit`。
   防止 reader 收到 EOF + monitor 收到 wait() = 双重 Exit。

3. **killed AtomicBool + try_lock 后端** 用于 `close()` 不与 monitor 死锁（`controller/mod.rs:808-840`）。
   - close 路径：设置 `killed = true` → `try_lock(backend)` 拿到则 wait()，拿不到则跳过（monitor 已经在收尸了）
   - monitor 路径：检查 `killed`，true 则不发 Exit（避免重复信号）

4. **`send_keys` 用 `UnboundedSender`** 永不阻塞 caller
   writer task 后台排空，吞吐靠 FIFO + flush 维持。

5. **`split_pane` 用 `oneshot::Sender`** 在 `pending_splits` 注册
   dispatch task pop front sender 匹配 `%window-pane-changed` 响应。**不会丢响应**，因为 `%begin..%end` 边界和 `WindowPaneChanged` 事件都在 dispatch task 顺序处理。

### 3.3 CommandRegistry 与 RouterState 的协作（PR-T3 + T5）

- **CommandRegistry**（`controller/id_map.rs`）= 单个 `id_map: BTreeMap<CommandId, CommandEntry>`
  - `CommandEntry` 持有 `ResponseWaiter` + `event_waiters: VecDeque<EventWaiter>`
  - 唯一等待队列，避免旧实现的 5 个 pending 字段失同步（**Bug 011**）
- **RouterState**（`controller/subscriber.rs`）= 在 `%begin..%end` 之间累积 body line
  - 收到 `%begin T I F` → set current command id
  - body line → push 到当前 command 的 body buffer
  - `%end T I F` → pop body → resolve waiter（registry 里查 id → 触发 ResponseWaiter）
  - `%error` → 丢弃 body，触发 error waiter

## 4. 完整生命周期（tmux controller）

| 阶段 | 任务 | channel/数据结构动作 |
|---|---|---|
| 1. spawn | `TmuxController::spawn_with_backend(backend, spawn_mode)` | 起 4 task；起 writer_task 拿 stdin；起 handshake（PR-T4） |
| 2. handshake | writer 发 `refresh-client -C` + `attach-session -c ""` + `list-windows` + `list-panes`（capability 矩阵决定顺序） | `%begin..%end` 响应逐个 resolve；pane_bindings / window_bindings 填充 |
| 3. signal first pane | reader 收到第一个 `%window-pane-changed` | `first_pane_tx.send((xsterm_pane_id, name))`（**一次性**，发送后 take） |
| 4. steady state | reader 持续 parse stdout；writer 持续排空 stdin_rx；monitor 等待 | dispatch task 持续 dispatch_event |
| 5. close | 调用者 drop `Arc<TmuxController>`（refcount 归 0）/ 显式 `close()` | `killed = true` → writer task 退出 → reader 收到 EOF → monitor 收到 wait() → dispatch task 退出 |
| 6. cleanup | monitor task 退出后 | `dispatch_tx` drop → dispatch task 退出 → controller 整体清理 |

### 4.1 shutdown 顺序（关键）

```
close() / drop Arc
    ↓
set killed = true
    ↓
writer_task: stdin_rx.recv() 返回 None → shutdown() stdin → exit
    ↓
reader_task: stdout EOF → exit（不发 Exit，monitor 负责）
    ↓
monitor_task: backend.wait() 返回 → 检查 killed
    ├── killed=true → 静默退出
    └── killed=false → dispatch_tx.send(Exit) → exit
    ↓
dispatch_task: dispatch_rx 关闭 → exit
    ↓
Arc<TmuxController> 整体清理
```

**关键**：reader EOF 不发 Exit，monitor 才是 Exit 的唯一来源。**否则会重复 emit tmux-controller-exit 事件给前端。**

## 5. Tauri IPC 任务

Tauri runtime 自己起 tokio task 池：

- **每条 invoke**：runtime 在 worker pool 里跑 command handler（短暂任务）
- **每条 listen**：前端注册的事件订阅器；后端 `app.emit(...)` 触发时不创建独立 task，走 event bus 广播

**前端事件接收**：每个 `listen<...>(\"event-name\", handler)` 在 React 里挂一个 `EventListener`，由 Tauri JS runtime 直接喂到 handler。不需要前端自己起 task。

## 6. session-output 热路径（Perf 001-003）

> 完整的 perf 分析见 `dev/changelog/perf.md`，这里只描述**进程拓扑**。

```
PTY/SSH/tmux backend.stdout
    ↓ (reader task, 单线程独占)
BufReader::lines() → ProtocolParser::feed → ProtocolEvent
    ↓ (dispatch_tx, UnboundedSender)
dispatch task → dispatch_event
    ↓
TmuxBridge::emit_session_output([xsterm_session_id, bytes])
    ↓ (Tauri event bus)
WebView2 frontend
    ↓
useTauriTerminalOutput (React hook) → Channel<Uint8Array>
    ↓
xterm.js write
```

**背压信号**（Perf 003）：
- tmux 发 `%pause` → `ProtocolEvent::Pause { pane_id }` → bridge emit `tmux-paused`
- tmux 发 `%continue` → `ProtocolEvent::Continue { pane_id }` → bridge emit `tmux-continued`
- 前端可以选择暂停 rAF 批写，等 `tmux-continued` 再恢复

## 7. 跨 SSH 路径的进程差异

| 阶段 | Local | SSH |
|---|---|---|
| spawn | `tokio::process::Command::new("tmux")` → `Child` | `SshConnectResult` 包 russh exec channel |
| stdin/stdout | 直接拿 `Child::stdout` 等 | russh data loop 在另一线程 → 字节推 `sync_mpsc` → bridge 线程转 `tokio::mpsc` → reader task 当 AsyncRead |
| stderr | `Child::stderr`（实际空） | **空**（russh exec channel 不暴露 stderr） |
| DCS passthrough | 偶现（**SSH 必现**） | reader 已统一剥 |
| reader task 实现 | 完全相同 | 完全相同（这是抽象的目的） |

**关键设计目的**：`TmuxBackend` trait 让 SSH 路径与 local 路径**共享同一套** reader/writer/monitor 任务。所有并发原语、channel 拓扑、CommandRegistry / RouterState 都是 backend-agnostic 的。

## 8. 跨视图引用

- 这些 task 操作的**数据结构**是什么 → `01-logical-view.md` §2-§4
- 这些 task 写在**哪些文件**里 → `03-development-view.md` §3 tmux 模块树
- 这些 task 在**哪台机器 / 哪个进程**跑 → `04-physical-view.md`
- 这些 task 在**具体场景**下怎么配合 → `05-scenarios.md`
