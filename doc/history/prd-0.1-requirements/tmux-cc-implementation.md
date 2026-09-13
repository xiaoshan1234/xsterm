# tmux CC 在 xsterm 中的实现

> **配套**：[`req-006-tmux.md`](req-006-tmux.md)（需求 + 设计决策 + Wave 拆分）、[`doc/arch/architecture-map.md`](../../arch/architecture-map.md) §5.7（架构概览）
> **状态**：Wave 0–5 已完成（2026-09）；Wave 6 抛光进行中
> **范围**：本地 `tmux -CC`、SSH 上的 `tmux -CC`、split / kill / new-window / scrollback / reconnect

---

## 1. 一句话

xsterm 通过 tmux 的 `-CC`（**Control Mode**）协议，让 xsterm 的 **TmuxController** 充当 `tmux -CC` 子进程（或 SSH 上的远端 `tmux -CC`）的客户端，把 tmux 的 windows / panes 渲染到 xsterm 自己的 UI 上，由 React 渲染层替代 tmux 自带的 TUI。"tmux cc" 指的就是这条 `-CC` 集成链路。

### 三个概念不要混淆

| 概念 | 它是什么 | 谁拥有 |
|---|---|---|
| **xsterm session** (frontend `Session` 对象) | **backend 连接** —— 一个能读写 stdin/stdout 的活动实体。在 local 模式下是一个 PTY 进程；在 SSH 模式下是一个 russh exec channel；在 tmux-cc 模式下是通过 controller 间接代理一个 tmux pane 的逻辑连接。**它**对应 `ActiveSession` 枚举里的一个 variant。 | `SessionManager.sessions` 注册表 |
| **xsterm pane** (PaneTree 里的 leaf 节点) | **UI 容器** —— PaneTree 的一个叶子节点，渲染一个 xterm.js 实例，**绑定** 一个 `Session`。一个 xsterm pane 可以 split / close；它的 UUID 是 `pane.id`（字符串）。 | `workspace.windows[].rootPane` 树 |
| **tmux pane** | tmux 自己的 leaf 概念，承载一个 shell 进程。xsterm 通过 tmux controller 代理它的 stdin/stdout。id 格式 `%<N>`。 | tmux server 内部 |

**关系**：
- 一个 **xsterm pane**（UI 容器）绑定一个 **xsterm session**（backend 连接）
- 一个 **xsterm session**（tmux-cc 模式下）背后代理一个 **tmux pane**
- 因此：**xsterm pane ↔ tmux pane**（都是 UI/leaf 概念，1:1 渲染关系）
- 一个 **TmuxController**（一个 `tmux -CC` 子进程）**拥有 N 个 tmux pane**，对应 N 个 xsterm session

**req-006 命名约定的歧义**：req-006 §2.3 把 frontend `Session` 称为 "xsterm session id"。本文档保留这一定义，但**明确"xsterm session ≠ tmux session"**：xsterm session 是 backend 连接，不应与 tmux 自己的 session 概念混淆。

---

## 2. 关键设计决策（已采纳）

需求文档 §2 的五项决策在实现中一以贯之。下表只重复"实现侧的关键事实"，完整理由看 req-006。

| ID | 决策 | 实现侧落地 |
|---|---|---|
| **D1** | 每个 xsterm session（backend 连接）背后**代理一个 tmux pane**；多个 session 共享一个 `tmux -CC` controller | `TmuxController` 持有 N 个 tmux pane → 代理为 N 个 xsterm session（通过 `pane_bindings: HashMap<tmux_pane_id, xsterm_session_id>`）。**反对方案**：frontend `Session` 1:1 到 tmux server（每个 shell 一个 daemon），浪费 tmux server |
| **D2** | tmux window → xsterm Window（不是 Tab） | `TmuxController::window_bindings` + dispatch 三分支 trichotomy 处理 bootstrap / user-driven / external window |
| **D3** | bootstrap pane 埋掉（`isHidden=true`） | `tmux_pane_info()` 工厂根据 `tmux -CC new` vs `tmux -CC attach` 决定 `is_hidden`；前端 `Pane.tsx` 据此不渲染 |
| **D4** | scrollback 走 lazy capture | `capture_pane` 命令 + `pending_capture` 单飞；前端 focus 时拉 scrollback 进 xterm.js buffer |
| **D5** | SSH + tmux 复用 russh exec channel | `TmuxBackend` trait 抽象 + `LocalTmuxBackend` / `SshTmuxBackend` 两实现；同套 reader / writer / monitor task 复用 |

**术语提示**：D1 提到的 "xsterm session" 指 frontend `Session` 对象（backend 连接），**不是** tmux session。controller ≈ tmux session（1:1），但对用户不可见；详见 §1。

---

## 3. 整体架构（一张图）

下图标注了 §1 三个概念（**xsterm session** = backend 连接 / **xsterm pane** = UI 容器 / **tmux pane** = tmux leaf）及其对应关系。

```
                xsterm 前端（React 19 + xterm.js 6）
   ┌─────────────────────────────────────────────────────────────┐
   │  workspace (WorkspaceContainer)                              │
   │   └─ window (WindowTabBar)         ←─── 对应 tmux window     │
   │       └─ PaneTree (split 布局)                                │
   │           ├─ leaf #A (pane UUID-A)  ←─ xsterm pane #A       │
   │           │   ├─ binds Session(id=A) ──┐                     │
   │           │   │  (xsterm session)      │ 1:1                  │
   │           │   │   ├─ tmuxPaneId=%5     │                      │
   │           │   │   └─ tmuxControllerId=1                      │
   │           │   │     └─ 背后的 tmux pane（提供 stdin/stdout）  │
   │           ├─ leaf #B (pane UUID-B)  ←─ xsterm pane #B       │
   │           │   ├─ binds Session(id=B) ──┘                     │
   │           │   │  (xsterm session)      1:1                   │
   │           │   │   ├─ tmuxPaneId=%6     │                      │
   │           │   │   └─ tmuxControllerId=1                      │
   │           └─ ...                                              │
   │                                                              │
   │  CreateSessionDialog (4 top tabs)                            │
   │   └─ TmuxForm (Base Configuration 下拉框 + tmux 字段)        │
   │  Pane 右键菜单 / 快捷键 Ctrl+\ / Ctrl+Shift+\                 │
   │  TmuxControllerErrorBanner（崩溃后 Retry）                    │
   └─────────────────────────────────────────────────────────────┘
              │ invoke(...)                    │ listen(...)
              ▼                                ▲
   ┌─────────────────────────────────────────────────────────────┐
   │  Tauri 命令 (commands/session.rs)                            │
   │   create_tmux_session / attach_tmux_session                  │
   │   create_tmux_pane / kill_tmux_pane                          │
   │     (参数: xsterm session id)                                │
   │   create_tmux_window / kill_tmux_window / rename_tmux_window │
   │   capture_tmux_pane / close_tmux_controller                   │
   │   get_attached_tmux_servers / auto_attach_tmux_servers        │
   └─────────────────────────────────────────────────────────────┘
              │
              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  services/session_manager.rs（中枢，~2545 行）               │
   │   tmux_controllers: DashMap<u32, Arc<TmuxController>>        │
   │   sessions:        DashMap<u32, ActiveSession>               │
   │     └─ ActiveSession::TmuxPane(TmuxPaneHandle)               │
   │         (TmuxPaneHandle 是 xsterm session 的 backend 实现)   │
   │                                                              │
   │   8 个 tmux 方法：create / attach / split / kill / window    │
   │                    capture / list / auto_attach              │
   └─────────────────────────────────────────────────────────────┘
              │ owns Arc<TmuxController>
              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  infrastructure/tmux/                                        │
   │                                                              │
   │   TmuxBackend trait ──┬── LocalTmuxBackend (tokio Child)    │
   │                      └── SshTmuxBackend  (russh exec channel)│
   │                                                              │
   │   TmuxController（核心状态机）                               │
   │     ├─ reader task     stdout → lines → ControlParser        │
   │     ├─ writer task     mpsc → stdin                          │
   │     ├─ stderr drain    stderr → drop (进 rolling log)        │
   │     ├─ monitor task    backend.wait() → Exit event          │
   │     └─ dispatch task   ControlEvent → Tauri event / Promise  │
   │                                                              │
   │   parser.rs (纯函数)   escape.rs (octal)                     │
   │   events.rs (枚举)     commands.rs (构造器)                  │
   └─────────────────────────────────────────────────────────────┘
              │ spawn
              ▼
   ┌──────────────────┐    ┌────────────────────┐
   │  tmux -CC 子进程 │    │  SSH exec channel  │
   │  (本地 / 远端)   │    │  (远端 tmux -CC)   │
   └──────────────────┘    └────────────────────┘
              │
              │ 内部维护 tmux session + windows + panes
              ▼
   ┌─────────────────────────────────────────────────────────────┐
   │  tmux server 内部                                            │
   │   session (≈ 1 controller = 1 tmux session)                  │
   │   └─ window (@1)                                            │
   │       ├─ pane %5  ──→ xsterm session A ──→ xsterm pane #A   │
   │       └─ pane %6  ──→ xsterm session B ──→ xsterm pane #B   │
   └─────────────────────────────────────────────────────────────┘
```

**核心约束**：
- **一行代码 = 一个状态变化**。reader / writer / dispatch 三个 task 各司其职，互不抢锁。
- **Promise 协调通过 `oneshot` + `Mutex<VecDeque>`**。`pending_splits` / `pending_windows` / `pending_capture` 都是这种模式。
- **TmuxController 是 N:1 的"拥有者"** —— 一个 controller 对应一个 tmux session，session 内 N 个 tmux pane 被代理为 N 个 xsterm session。

---

## 4. 后端实现（按模块）

### 4.1 `infrastructure/tmux/escape.rs`（143 LOC，~30 个测试）

**职责**：tmux `-CC` 线协议的八进制转义编解码器。

tmux 把 `< 0x20`、`\` (0x5C)、`>= 0x80` 三个集合的字节编码成 `\nnn` 三位八进制。这是 %output / %extended-output / send-keys 三处共享的字节层。

```rust
pub fn unescape_output(s: &str) -> Vec<u8>      // %output 字符串 → 原始字节
pub fn escape_output(bytes: &[u8]) -> String    // send-keys 字节 → %output 字符串
```

**关键事实**：
- 三位数字严格判定：看到 `\` 后跟 3 个八进制数字才解码，否则 `\12` / `\xy` 都按字面量保留。
- Unicode UTF-8 透明通过（不视为高字节转义），`escape_output` 才把它编码成 `\303\261` 这种多位。
- 单测 `round_trip_all_bytes_zero_to_255` 锁定全集反转性。

### 4.2 `infrastructure/tmux/parser.rs`（42 LOC + ~1042 LOC 测试）

**职责**：纯状态机，`line: &str → Option<ControlEvent>`。

两个状态：
- **outside block**：默认状态。空行 → `None`（drop，tmux keepalive ping）；非 `%` 开头 → `Unknown`；`%xxx` 开头 → 解析对应枚举。
- **inside block**：`%begin T I F` 进入后保持 `current_command_id = Some(id)`；任何行都先尝试匹配 `%end` / `%error`，匹配则退出 block 并发 `CommandEnd` / `CommandError`；否则发 `CommandOutput { id, line }`。

**支持的 28 种事件**（events.rs 枚举）：
- 输出流：`Output` / `ExtendedOutput` / `Pause` / `Continue`
- session：`SessionChanged` / `SessionRenamed` / `SessionClosed` / `SessionWindowChanged` / `SessionsChanged`
- window：`WindowAdd` / `WindowClose` / `WindowRenamed` / `WindowPaneChanged` / `UnlinkedWindowAdd` / `UnlinkedWindowClose` / `LayoutChange`
- pane：`PaneModeChanged` / `PaneExited` / `PaneDied`
- misc：`PasteBufferChanged` / `ClientDetached` / `ClientSessionChanged` / `Exit` / `ConfigError` / `PopupOpen` / `PopupOutput` / `PopupClose`
- block：`CommandBegin` / `CommandEnd` / `CommandError` / `CommandOutput`
- 兜底：`Unknown { line }` —— **绝不崩溃**，未知事件原样保留以便日志观察。

**已知良好行为**：畸形数字、未知子事件、block 外 `%end` / `%error`、嵌套 `%begin` 全部走降级路径，不 panic。

### 4.3 `infrastructure/tmux/events.rs`（167 LOC）

**职责**：每个 `%xxx` 通知行的强类型 envelope。

设计要点：
- 字段类型故意选 `String` (not `&str`) + `Vec<u8>` (not `&[u8]`)：事件跨 `mpsc::UnboundedSender` 边界需要 own data。
- 转义解码在 parser 阶段完成，下游消费者永远拿到原始字节。
- `PopupOpen/Output/Close`（tmux 3.4+）保留 raw `String`，不锁字段 → 未来 tmux 版本不需 enum bump。

### 4.4 `infrastructure/tmux/commands.rs`（315 LOC + 单元测试）

**职责**：高层 API，把 xsterm 操作翻译成 tmux 命令行。

```rust
pub fn send_keys(pane_id: &str, keys: &[u8]) -> String       // 字节 → octal-escape → 拼成命令
pub fn split_window(pane_id: &str, horizontal: bool) -> String
pub fn kill_pane(pane_id: &str) -> String
pub fn new_window(session: &str, name: Option<&str>) -> String
pub fn new_window_in_current(name: Option<&str>) -> String  // controller 用此版本
pub fn kill_window(window_id: &str) -> String
pub fn rename_window(window_id: &str, name: &str) -> String
pub fn resize_pane(pane_id: &str, cols: u16, rows: u16) -> String
pub fn capture_pane(pane_id: &str, start_line: i32) -> String
pub fn list_panes(window_id: &str) -> String
pub fn list_sessions() -> String
pub fn refresh_client() -> String
```

**三种参数分类**：
1. **ID**（`%<N>` / `$<N>` / `@<N>`）：tmux 产生，绝无歧义，原样拼。
2. **名称**（window 名 / session 名）：可能含空格，走 `quote_arg` —— 仅当需要时套双引号、`\` → `\\`、`"` → `\"`。
3. **键**（send-keys）：任意字节，先过 `escape_output` 再拼。

**全部命令**带绝对 flag（`-h` / `-v` / `-x` / `-y` / `-p -e -J`），不依赖用户级 tmux config / alias。

### 4.5 `infrastructure/tmux/backend.rs`（666 LOC + 单元测试，Wave 5）

**职责**：transport 抽象 —— 让 `TmuxController` 不绑定具体进程模型。

```rust
pub trait TmuxBackend: Send + Sync + 'static {
    fn take_stdout(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String>;
    fn take_stdin(&mut self)  -> Result<Box<dyn AsyncWrite + Send + Unpin>, String>;
    fn take_stderr(&mut self) -> Result<Box<dyn AsyncRead + Send + Unpin>, String>;
    fn wait(&mut self)         -> BoxFuture<'_, Result<i32, String>>;
    fn kill(&mut self)         -> Result<(), String>;
}
```

| 实现 | 来源 | 用法 |
|---|---|---|
| `LocalTmuxBackend` | `tokio::process::Child` | Wave 1 本地路径 `tmux -CC <args>` |
| `SshTmuxBackend` | `SshConnectResult` (russh exec channel) | Wave 5 远端 `tmux -CC` |

**take 一次性**：`spawn_*` 时各取一次后 stream 所有权转给 reader / writer / drain 三个 task；trait 自身通过 `Option<T>.take()` 强制一次性消费。

**SshAsyncRead / SshAsyncWrite 适配器**：russh data loop 写的是 `sync_mpsc::Sender<Option<Vec<u8>>>`，controller 用的是 `tokio::io`。靠一对适配器桥接：
- `ReceiverStream` 把 `tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>` 暴露为 `Stream<Item = Vec<u8>>`。
- `SshAsyncRead::poll_read` 把 stream item 灌进 `ReadBuf`，溢出的部分挂到 `pending` 字段跨 poll 保留。
- `SshAsyncWrite::poll_write` 直接 `mpsc::UnboundedSender::send`。

### 4.6 `infrastructure/tmux/controller.rs`（**~3700 LOC，含测试**，Wave 0-5）

**职责**：核心状态机 —— spawn tmux 子进程 / 通道 → 起 reader / writer / monitor 三个 task → 把 `ControlEvent` 翻译成 Tauri 事件 + 协调 Promise。

#### 4.6.1 公开 API

| 方法 | 异步性 | 行为 |
|---|---|---|
| `spawn_local(config, backend, id)` | 同步 → 返回 `Arc<Self>` | 本地 spawn 或 SSH exec（看 `config.ssh`）→ `spawn_with_backend` |
| `spawn_attach(config, backend, id)` | 同步 → 返回 `Arc<Self>` | `tmux -CC attach-session`；必须带 `tmux_session_name` |
| `spawn_with_args(args, backend, id)` | 同步 → 返回 `Arc<Self>` | 测试用，从 argv 起手 |
| `send_keys(pane_id, keys)` | fire-and-forget | 入 stdin FIFO；pane 未注册则 `Err` |
| `resize_pane(pane_id, rows, cols)` | fire-and-forget | 同上 |
| `kill_pane(pane_id)` | fire-and-forget | 同上；前端听 `tmux-pane-removed` |
| `split_pane(parent_tmux_pane_id, direction)` | **async** → `SplitResult` | 推 sender 到 `pending_splits` → 写 `split-window` → 等 `%window-pane-changed`；5 s timeout<br>注：参数是 **tmux pane id**（controller 内部 API；SessionManager 已把 xsterm session id 反查为 tmux pane id 后再传进来） |
| `new_window(name)` | **async** → `NewWindowResult` | 推 sender 到 `pending_windows` → 写 `new-window` → 等 `%window-pane-changed`；5 s timeout |
| `kill_window(tmux_window_id)` | fire-and-forget | 前端听 `tmux-window-closed` |
| `rename_window(tmux_window_id, name)` | fire-and-forget | 前端听 `tmux-window-renamed` |
| `capture_pane(pane_id, lines)` | **async** → `CaptureResult` | 走 `capture_lock` 单飞；等 `%begin..%end` block；5 s timeout |
| `await_first_pane()` | **async** | 一次性 oneshot：5 s 内未收到首个 `%window-pane-changed` 则 timeout |
| `close()` | 同步（task 异步 unwind） | 设 `killed` flag + 杀 backend + drain 所有 pending Promise |

#### 4.6.2 内部状态

| 字段 | 作用 |
|---|---|
| `backend: Arc<Mutex<Option<Box<dyn TmuxBackend>>>>` | `close()` 与 monitor task 抢所有权（try_lock vs lock） |
| `killed: AtomicBool` | 让 monitor 知道是用户主动关而非 child 自挂 |
| `stdin_tx: UnboundedSender<String>` | 写命令 FIFO；drop 触发 writer task drain 退出 |
| `pane_bindings: Mutex<HashMap<tmux_pane_id, xsterm_id>>` | 主映射表 |
| `pane_window_bindings: Mutex<HashMap<tmux_pane_id, tmux_window_id>>` | pane → window 辅助 |
| `window_bindings: Mutex<HashMap<tmux_window_id, xsterm_window_id>>` | window 映射 |
| `next_xsterm_id: AtomicU32` | pane id 分配器（基址 = `controller_id * 1_000_000`） |
| `next_xsterm_window_id: AtomicU32` | window id 分配器（同基址） |
| `first_pane_tx/rx: oneshot` | bootstrap pane 一次性通知 |
| `pending_splits: Mutex<VecDeque<oneshot::Sender<SplitResult>>>` | split Promise 队列 |
| `pending_windows: Mutex<VecDeque<oneshot::Sender<NewWindowResult>>>` | new-window Promise 队列 |
| `pending_window_pane: Mutex<HashMap<tmux_window_id, PendingWindow>>` | 桥接 `%window-add` → `%window-pane-changed` |
| `pending_capture + pending_capture_body: Mutex` | capture 单飞 + body 累积 |
| `capture_lock: tokio::Mutex<()>` | 序列化并发 capture_pane |
| `split_pane_timeout: Duration` | 测试可注入 |

#### 4.6.3 任务拓扑

```
stdin_tx ──→ cmd_rx ──→ writer task ──→ backend.stdin
                              (单 dispatch)

backend.stdout ──→ reader task ──→ dispatch_tx ──→ dispatch_rx
                          (parser.feed)            │
                                                    ▼
                                          dispatch task
                                                    │
                                                    ▼
                                       app_backend.emit(...)

backend.wait() ──→ monitor task ──→ dispatch_tx (Exit event)
```

四个 long-running task 由 `spawn_with_backend` 起。`spawn_reader_task` 拿 stdout 一次性 `BufReader::lines()` → 喂 parser。`spawn_writer_task` 把 `UnboundedReceiver<String>` drain 到 `backend.stdin`。`spawn_stderr_drain_task` 拿 stderr 一次性丢（理论上不该有内容，进了 rolling log）。`spawn_monitor_task` 跑 `backend.wait()`，等 child 退出 → 发 `ControlEvent::Exit`。

#### 4.6.4 Dispatch 路由（最复杂的一段）

`dispatch_event` 对每个 `ControlEvent` 走不同路径。最复杂的两个：

**`%window-pane-changed`（五级 fallthrough）**：

1. **already-bound**：`pane_bindings` 已有此 pane → ignore（active pane 切换时 tmux 重复 emit）
2. **split-result**：`pending_splits` front pop → 分配 xsterm id → emit `tmux-pane-added` → resolve oneshot
3. **new-window / bootstrap**：`pending_window_pane` remove → 分配 xsterm id → emit `tmux-pane-added` + (若 user-driven) emit `tmux-window-added` → resolve oneshot
4. **bootstrap fallback**：legacy 路径走 `record_first_pane`，仅 emit `tmux-pane-added`
5. **external pane**：tmux 报告了我们没请求的新 pane（用户 inner shell 跑 `splitw`）→ 只 log。**已知缺口**，无 re-bind UI。

**`%window-add`（三分支 trichotomy）**：

- (a) `pending_windows` 非空 → user-driven new-window reply：pop front → 分配 window id → 存 `pending_window_pane` 等 `%window-pane-changed`
- (b) `pending_windows` 空 AND `window_bindings` + `pending_window_pane` 都空 → bootstrap window：同 (a) 但 sender = None
- (c) 其他 → external new-window：只 log

#### 4.6.5 超时与孤儿 Promise

- 每个 async Promise（split / window / capture）都有 5 s timeout。
- `close()` 在终止前调用 `drain_pending_*_with_error("controller closed")`，让所有等待者立即收到 `Err` —— 否则前端 Promise 会 hang 满 5 s。
- 同样模式用于 `pending_capture` 和 `first_pane`。

---

## 5. `services/session_manager.rs` 中的 tmux 集成（~2545 LOC 文件中的 tmux 段）

SessionManager 不是平铺所有 tmux 逻辑 —— 它维护独立的 `tmux_controllers: DashMap<u32, Arc<TmuxController>>` 注册表，让 `close_tmux_controller(id)` 能一次性找到所有相关 pane。

### 5.1 新类型

```rust
/// xsterm session 的 backend 实现 —— 持有一个 tmux pane 的"代理权"。
///
/// 当 `ActiveSession::TmuxPane` variant 在 `SessionManager::sessions` 中
/// 注册时，frontend `Session.id`（u32）就指向这个 handle。frontend 调用
/// `writeSession(id, data)` / `resizeSession(id, ...)` / `closeSession(id)`
/// 时，会通过 `ActiveSession::TmuxPane(handle).write(...)` 走 `SessionBackend`
/// trait，最终转发到 controller 的 send_keys / resize_pane / unbind_pane。
pub struct TmuxPaneHandle {
    controller: Arc<TmuxController>,
    tmux_pane_id: String,        // 内部代理的 tmux pane id
    info: SessionInfo,
    capabilities: CapabilityFlags,  // supports_multiplex = true
}

enum ActiveSession {
    Pty(Box<dyn SessionBackend + Send>),
    Ssh(Box<SshSessionWrapper>),
    TmuxPane(Box<TmuxPaneHandle>),  // Wave 1 新增
}
```

`TmuxPaneHandle` 实现 `SessionBackend`，但 `write` / `resize` / `close` 全部转发到 controller。**关键点**：drop 一个 xsterm session（= 关闭一个 TmuxPaneHandle）**不杀 controller** —— 同一个 tmux `-CC` 进程可能还活着其他 pane / xsterm session。

```rust
impl SessionBackend for TmuxPaneHandle {
    fn write(&self, data: &[u8]) -> Result<(), String> {
        self.controller.send_keys(&self.tmux_pane_id, data)
    }
    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.controller.resize_pane(&self.tmux_pane_id, rows, cols)
    }
    fn close(self: Box<Self>) -> Result<(), String> {
        self.controller.unbind_pane(&self.tmux_pane_id)
    }
}
```

### 5.2 8 个 tmux 方法

> **读法提示**：表中所有 `*_xsterm_session_id` 参数都是 frontend `Session.id`（u32，backend 连接标识）。方法名后缀 `_tmux_pane` / `_tmux_window` 反映的是**该操作的 tmux 视角效果**（如 `kill-pane` / `split-window`），不是参数类型。

| 方法 | 入参 | 路径 | 返回 |
|---|---|---|---|
| `create_tmux` | `TmuxCcConfig`, backend | `spawn_local` / `spawn_with_ssh` | 等首个 tmux pane → `tmux_pane_info()` → 注册 `TmuxPaneHandle` 为新 xsterm session |
| `attach_tmux` | `TmuxCcConfig`, backend | `spawn_attach` | 同上，但 `is_hidden=true`（bootstrap pane） |
| `capture_tmux_pane` | `xsterm_session_id, lines` | 查 controller → `controller.capture_pane` | `String` (scrollback) |
| `list_attached_tmux_servers` | – | 扫 `tmux_controllers` | `Vec<AttachedTmuxServer>` |
| `auto_attach_all` | `[AttachedTmuxServer]` | 遍历 → `attach_tmux` | `Vec<AutoAttachOutcome>` |
| `close_tmux_controller` | `controller_id` | 从 `tmux_controllers` remove → unbind 所有 pane → `controller.close()` | `Ok` |
| `create_tmux_pane` | `controller_id, parent_xsterm_session_id, direction` | 解析 parent → `controller.split_pane` → 注册新 `TmuxPaneHandle` + 通知前端插入新 xsterm pane leaf | `SessionInfo` |
| `kill_tmux_pane` | `xsterm_session_id` | 查 controller → `controller.kill_pane`（kill 对应的 tmux pane） | `Ok` |
| `create_tmux_window` | `controller_id, name?` | `controller.new_window` → 等四元组 → 注册 pane + emit `tmux-window-added`（前端创建新 xsterm Window） | `SessionInfo` |
| `kill_tmux_window` | `xsterm_window_id` | 扫描所有 controller 的 `window_bindings` 找映射 → `controller.kill_window` | `Ok` |
| `rename_tmux_window` | `xsterm_window_id, name` | 同上 → `controller.rename_window` | `Ok` |

注：`kill_tmux_pane` / `kill_tmux_window` 是 fire-and-forget；前端靠 `tmux-pane-removed` / `tmux-window-removed` 事件拿结果。

---

## 6. Tauri 命令表面

> **命名约定**：命令后缀 `_tmux_pane` / `_tmux_window` 反映**操作的 tmux 视角效果**（如 `split-window` / `kill-pane`），但**参数类型是 xsterm 视角**：
> - `*_xsterm_session_id` = `Session.id`（u32，backend 连接标识）
> - `xsterm_window_id` = xsterm 内部 Window id（u32）
> - 没有"传入 tmux 内部 id"的设计 —— tmux id 在 backend 内部消化

| 命令 | 文件 | 作用 | Wave |
|---|---|---|---|
| `create_tmux_session` | `commands/session.rs` | 启本地 / SSH tmux -CC | 1 |
| `attach_tmux_session` | `commands/session.rs` | attach 已有 server | 4 |
| `create_tmux_pane` | `commands/session.rs` | 参数: `controller_id, parent_xsterm_session_id, direction` → `split-window` | 2 |
| `kill_tmux_pane` | `commands/session.rs` | 参数: `xsterm_session_id` → `kill-pane` | 2 |
| `resize_tmux_pane` | `commands/session.rs` | resize-pane | 1 |
| `capture_tmux_pane` | `commands/session.rs` | scrollback 抓取 | 4 |
| `create_tmux_window` | `commands/session.rs` | new-window | 3 |
| `kill_tmux_window` | `commands/session.rs` | kill-window | 3 |
| `rename_tmux_window` | `commands/session.rs` | rename-window | 3 |
| `close_tmux_controller` | `commands/session.rs` | 拆 controller | 1 |
| `get_attached_tmux_servers` | `commands/session.rs` | 列活跃 | 4 |
| `auto_attach_tmux_servers` | `commands/session.rs` | 重启后批量重连 | 4 |

---

## 7. 前端实现

### 7.1 类型（`src/types/session.ts`）

```ts
// SessionType 区分的是 backend 连接的"如何建立"。
// local = 本地 PTY；ssh = russh 通道；tmux-cc = 通过 tmux controller 间接代理。
type SessionType =
  | { type: "local";  config: LocalSessionConfig  }
  | { type: "ssh";    config: SSHSessionConfig    }
  | { type: "tmux-cc"; config: TmuxCcConfig };   // Wave 1

interface TmuxCcConfig {
  name?: string;
  tmuxSessionName?: string;       // attach 时使用（决定 attach 哪个 tmux session）
  socketName?: string;            // -L 参数
  startCommand?: string;          // 启动 shell
  ssh?: SSHSessionConfig;         // 远端模式
  termType?: string;
  initialRows?: number;           // default 24
  initialCols?: number;           // default 80
}

// Session = xsterm session = backend 连接（不是 xsterm pane）。
// 一个 Session 在 React 树里被一个 PaneTree leaf 绑定渲染。
interface Session {
  id: number;                     // xsterm session id（u32）；用这个 id 调 invoke
  configId: string;
  name: string;
  type: SessionType;
  isConnected: boolean;
  isHidden?: boolean;             // bootstrap tmux pane（用户视角不渲染）
  // tmux-specific 关联字段
  tmuxPaneId?: string;            // 内部代理的 tmux pane id（如 "%5"），仅 backend 用
  tmuxControllerId?: number;      // 关联到哪个 TmuxController（= 哪个 tmux session）
  tmuxWindowId?: string;          // Wave 3+，由 tmux-window-added 事件回填
  capabilities: CapabilityFlags;  // tmux-cc 时 supportsMultiplex=true
}

// PaneNode 是 PaneTree 节点 —— xsterm pane 的数据结构
interface PaneNode {
  id: string;                     // xsterm pane UUID（不是 xsterm session id）
  type: "leaf" | "split";
  size: number;
  sessionId?: number;             // 绑定的 xsterm session id
  children?: PaneNode[];
}

interface TmuxPaneAddedEvent   { controllerId, tmuxPaneId, xstermSessionId, parentTmuxWindowId }
interface TmuxPaneRemovedEvent { controllerId, tmuxPaneId, xstermSessionId }
interface TmuxWindowAddedEvent { controllerId, tmuxWindowId, xstermWindowId, xstermSessionId, xstermPaneId }
interface TmuxWindowClosedEvent{ controllerId, tmuxWindowId, xstermWindowId }
interface TmuxWindowRenamedEvent{controllerId, tmuxWindowId, xstermWindowId, name }
```

### 7.2 `src/services/sessionService.ts` — 9 个 wrapper

> **所有 `xstermSessionId` 参数** = frontend `Session.id`（u32，backend 连接标识）。
> 函数名后缀 `TmuxPane` / `TmuxWindow` 反映**该函数触发的 tmux 命令**（如 `kill-pane` / `split-window`），不是参数类型。

```ts
createTmux(config)            // → invoke("create_tmux_session")
attachTmux(config)            // → invoke("attach_tmux_session")
captureTmuxPane(xstermSessionId, lines)    // → invoke("capture_tmux_pane")
getAttachedTmuxServers()      // → invoke("get_attached_tmux_servers")
autoAttachTmuxServers()       // → invoke("auto_attach_tmux_servers")
createTmuxPane(controllerId, parentXstermSessionId, direction)  // split 操作
killTmuxPane(xstermSessionId)              // kill-pane（杀的是 xsterm session 背后的 tmux pane）
createTmuxWindow(controllerId, name?)
killTmuxWindow(xstermWindowId)
renameTmuxWindow(xstermWindowId, name)
```

### 7.3 `src/contexts/session/useTauriListeners.ts` — 8 个事件订阅

| 事件 | 行为 |
|---|---|
| `session-disconnected` | `setSessions` 把 `isConnected = false` |
| `session-closed` | 删 Session + 折叠 PaneTree |
| **`tmux-paused`** | `console.debug` 占位，**不修改 state** |
| **`tmux-continued`** | `console.debug` 占位，**不修改 state** |
| **`tmux-controller-exit`** | 删所有同 controllerId 的 Session + 折叠 PaneTree + push 进 `tmuxControllerErrors` 触发 banner |
| **`tmux-pane-added`** | idempotent 补 Session（bootstrap 路径由 `create_tmux_session` 返回值已建，这里是 race fallback） |
| **`tmux-pane-removed`** | 删 Session + 折叠 PaneTree |
| **`tmux-window-added`** | 补 Session + stamp `tmuxWindowId` + 在 target workspace 创建 xsterm Window |
| **`tmux-window-closed`** | 删所有同 `tmuxWindowId` 的 Session + 删对应 xsterm Window；空 workspace 替换 init window |
| **`tmux-window-renamed`** | 改对应 xsterm Window 的 `name` |

**Idempotency 模式**：每个 listener 都先在 `sessionsRef.current` / `workspacesRef.current` 里查一次，再在 setter 里再查一次，避免 race 重复添加 / 折叠。

### 7.4 `src/contexts/session/usePaneActions.ts::splitTmuxPaneInternal`

split 的端到端：
1. 查 parent session → 必须有 `tmuxControllerId` + `tmuxPaneId`
2. `await sessionService.createTmuxPane(...)` → backend `create_tmux_pane` → controller `split_pane` → 等 `%window-pane-changed` → 返回新 pane 的 `SessionInfo`
3. 在 PaneTree 里按用户选择的方向插入新 leaf
4. 不依赖 `tmux-pane-added` 事件（已通过 Promise 直接拿回结果），但 listener 做 idempotent 兜底

`Ctrl+\` / `Ctrl+Shift+\` 快捷键在 `useAppShortcuts.ts` 注册。

### 7.5 UI 组件

| 文件 | 职责 |
|---|---|
| `src/components/dialogs/CreateSessionDialog.tsx` | 3 个 top tab（Shell / SSH / **Tmux**） |
| `src/components/dialogs/TmuxForm.tsx` | 整合 Local/SSH：Radio 切换 transport + 条件渲染 `SshSessionForm` + 4 个 tmux 字段（Display Name / Tmux Session Name / Socket Name / Start Command） |
| `src/components/TmuxControllerErrorBanner.tsx` | controller 挂掉时显示，提供 Retry（重调 `attachTmux` / `createTmux`）和 Dismiss |
| `src/components/TmuxControllerErrorBanner.css` | banner 样式（参考 `pane-disconnect-banner` 但用 `--warning` 琥珀色） |
| `src/hooks/useTmuxAutoAttach.ts` | app mount 时调一次 `autoAttachTmuxServers()`；用 `useRef` 防 React strict-mode 二次触发 |

### 7.6 Pane UI 集成点

- `Pane.tsx`：右键菜单按 `session.capabilities?.supportsMultiplex` 显示 Split Right / Split Down / Kill Pane；`isHidden` 为 true 时不渲染。
- `Terminal.tsx` / `useTauriTerminalOutput.ts`：复用现有 `session-output` 事件订阅（tmux 后端 emit 的事件名与 PTY / SSH 完全相同，前端零修改）。
- `Terminal.tsx`：resize 走 `resize_session` → tmux 分支 → `controller.resize_pane`。

---

## 8. SSH + tmux（Wave 5）

复用 `SshBackend::connect_exec`，把远端 `tmux -CC` 当成 exec 进程的 stdin/stdout 来读写。

### 8.1 数据流

```
xsterm Rust
  ├─ SshBackend::connect_exec(ssh_cfg, "tmux -CC -L <sock> ...")
  │     → SshConnectResult { channel, write_tx, read_rx, resize_tx }
  │
  ├─ SshTmuxBackend::from_connect_result(result)
  │     → spawn bridge thread: sync_mpsc::Receiver<Option<Vec<u8>>>
  │                              → tokio::mpsc::UnboundedSender<Vec<u8>>
  │
  └─ TmuxController::spawn_with_backend(SshTmuxBackend)
        → reader task 拿 stdout (SshAsyncRead)
        → writer task 拿 stdin  (SshAsyncWrite)
        → 其余逻辑完全相同
```

### 8.2 适配器细节

- `SshAsyncRead::poll_read`：把 stream item 拷贝到 `ReadBuf`；超出 `remaining()` 的部分挂到 `pending` 字段跨 poll 保留。
- `SshAsyncWrite::poll_write`：直接 `tx.send(buf.to_vec())`，断连返回 `BrokenPipe`。
- stderr：russh exec 通道不分离 stderr，`take_stderr` 返回空 stream。

### 8.3 已知债

- SSH + tmux 网络断线时，复用 TCP keepalive（已实现于 `russh` 配置）。
- SSH 主机密钥验证**关闭**（AGENTS.md 已知债，**与 tmux 无关**，但同路径触发）。

---

## 9. 端到端数据流

### 9.1 pane 显示（tmux → 屏幕）

```
tmux server
   │ stdout（line 流）
   ▼
spawn_reader_task → BufReader::lines() → parser.feed(line)
   ▼ ControlEvent::Output / ExtendedOutput
dispatch task
   │ resolve pane_bindings 反查 xsterm_session_id
   ▼
app_backend.emit("session-output", [xsterm_session_id, bytes])
   │
   ▼ Tauri 事件总线
useTauriTerminalOutput.ts (已有，零修改)
   │ decode bytes + OSC52 提取 + RAF 批量
   ▼
xterm.write(text)
```

**关键**：tmux pane **复用** PTY / SSH 的 `session-output` 事件名 + payload schema，前端零侵入。

### 9.2 pane 注册（%window-pane-changed → React state）

```
tmux server
   │ %window-pane-changed @1 %5
   ▼
spawn_reader_task → parser
   ▼ ControlEvent::WindowPaneChanged
dispatch task 五级 fallthrough：
  case 1 already-bound → ignore
  case 2 split-result → resolve oneshot → emit "tmux-pane-added"
  case 3 new-window   → resolve oneshot → emit "tmux-pane-added" + "tmux-window-added"
  case 4 bootstrap    → emit "tmux-pane-added"
  case 5 external     → log only
   │
   ▼
useTauriListeners.ts "tmux-pane-added"
   │ idempotent: 已有则 return；否则 buildTmuxPaneSession() 加入 React state
   ▼
React 渲染
```

### 9.3 用户键入（屏幕 → tmux）

数据流涉及 §1 的三概念：xsterm pane（持有 onData）→ xsterm session（backend 写入）→ tmux pane（实际 shell 进程）。

```
xterm.onData(data)                                  [Terminal.tsx，渲染于 xsterm pane #A]
   │  ↑
   │  └─ 这里的 data 由 xsterm pane #A 持有，绑定的 xsterm session = A
   ▼
writeSessionRef.current(sessionId, data)             [usePaneActions]
   │ sessionId = A（xsterm session id）
   ▼
sessionService.writeSession(A, data) → invoke("write_session")
   │
   ▼
commands::write_session → with_manager(state, |mgr| mgr.write_session(A, data))
   │
   ▼
match ActiveSession::TmuxPane(handle) where handle.tmux_pane_id = "%5"
   │
   ▼
handle.write(data) → controller.send_keys("%5", data)   [TmuxController]
   │
   ▼
commands::send_keys("%5", keys) → "send-keys -t %5 <escaped>\n"
   │
   ▼
stdin_tx.send(cmd) → writer task → backend.stdin.write_all(cmd)
   │
   ▼
tmux pane %5 → shell
```

---

## 10. 已知技术债 / 风险

继承自 `architecture-map.md` §9 + req-006 §8，集中在 tmux 部分：

| 风险 | 位置 | 状态 |
|---|---|---|
| 外部 pane 不自动绑定 | `controller.rs::dispatch_event` case 5 | 用户在 inner shell 跑 `splitw` → 只 log；future iteration 加 re-bind UI |
| 外部 window 不自动绑定 | `controller.rs::dispatch_event` case 3c | 用户在 tmux 内手动 `:new-window` 同理；MVP 用户走 in-app "New Tmux Window" |
| Bootstrap window id 未暴露前端 | `models/session.rs::SessionInfo` | `xsterm_window_id` 仅 backend 持有；前端无法 `kill_tmux_window` bootstrap window |
| 6 个 Wave-0 命令 builder 保留 dead-code | `commands.rs::split_window` / `new_window` / `list_panes` / `list_sessions` / `refresh_client` | spec'd in req-006 §3.4 + 单元测试覆盖；production 走 inline wire payload |
| `session-closed` 后端事件 + `tmux-pane-removed` 事件可能 race | 同一 pane 的两种关闭路径 | listener 做 idempotent 兜底（`stillExists` 判断） |
| SSH + tmux 网络断线 | `SshTmuxBackend::wait()` 循环 | 复用 TCP keepalive（已有 `null_packet_keepalive`）；正式断线 banner 走 `tmux-controller-exit` |
| tmux 2.7 协议差 | `%window-pane-changed` 早于 `%window-add` | `pending_window_pane` 桥接 + `check_window_attached` 跳过 |

---

## 11. 测试覆盖

### 11.1 Rust 单元测试（`cargo test`）

| 文件 | 测试数 | 覆盖 |
|---|---|---|
| `escape.rs` | ~20 | round-trip 全集 0..=255、控制字节、反斜杠、高位字节、UTF-8 长缓冲 |
| `parser.rs` | ~40 | 28 种事件 + 空行 / Unknown / nested begin / mismatched end / malformed begin / 多行 block |
| `commands.rs` | ~15 | 每个构造器 + quote_arg 转义 + send-keys octal |
| `backend.rs` | 7 | `SshAsyncRead` 缓冲分块 / `SshAsyncWrite` BrokenPipe / `SshTmuxBackend` bridge / take_* 一次性 |
| `controller.rs` | ~50 | reader/writer/monitor/dispatch 4 个 task 用 mock I/O（`Cursor<Vec<u8>>` / `tokio::io::duplex` / `RecordingBackend`）；split / new-window / capture / first-pane timeout |
| `session_manager.rs` | 100+ | 含 `MockPtySystemM` / `MockSshBackendM`（mockall）；tmux 部分覆盖 create / attach / split / kill / close-controller / auto-attach |

### 11.2 Vitest（前端）

`src/contexts/session/useSessionActions.helpers.test.ts` + `sessionStorage.test.ts` 等覆盖了 `useTauriListeners` reducer 行为（tmux 事件处理走同一路径）。

### 11.3 手动 smoke（每个 Wave）

- **Wave 1**：本地 tmux 启 → 键入 → resize → 关
- **Wave 2**：split → kill → layout
- **Wave 3**：new-window → rename → kill
- **Wave 4**：attach 已有 session → scrollback 重启 → 错误恢复
- **Wave 5**：SSH + tmux 远端
- **Wave 6**：设计系统 grep 三条全过

### 11.4 系统测试（test/）

`test/sys-test/ui-click-display-test-cases.md` 包含 tmux 集成场景的 UI 点击路径。

---

## 12. 关键文件索引

### 12.1 后端

> **模块分层（2026-09 重构）**：tmux 实现按"业务/编排在 services，trait 抽象在 infrastructure"分层（类比 `services/local_session.rs` + `infrastructure/pty.rs`）。

| 文件 | LOC | 角色 |
|---|---|---|
| `src-tauri/src/services/tmux/mod.rs` | 36 | tmux 业务模块门面 + 重导出 `TmuxController` |
| `src-tauri/src/services/tmux/controller.rs` | ~3218 | `TmuxController` struct + 公开 API + 4 个 `spawn_*_task`（reader / writer / stderr drain / monitor） |
| `src-tauri/src/services/tmux/dispatch.rs` | ~640 | `dispatch_event` + `spawn_dispatch_task`（从 controller.rs 拆出，专注 4 种 Promise 协调 + 28 种事件路由） |
| `src-tauri/src/services/tmux/parser.rs` | 1042 | line → ControlEvent 纯函数状态机 |
| `src-tauri/src/services/tmux/events.rs` | 167 | `ControlEvent` 强类型枚举 |
| `src-tauri/src/services/tmux/commands.rs` | 315 | 命令构造器 |
| `src-tauri/src/services/tmux/escape.rs` | 236 | octal 编解码 |
| `src-tauri/src/infrastructure/tmux/mod.rs` | 12 | transport 模块门面（精简为只导出 backend） |
| `src-tauri/src/infrastructure/tmux/backend.rs` | 666 | `TmuxBackend` trait + `LocalTmuxBackend` / `SshTmuxBackend` impls + `SshAsyncRead` / `SshAsyncWrite` 适配器 |
| `src-tauri/src/services/session_manager.rs` | ~2545 | 8 个 tmux 方法 + `TmuxPaneHandle` + `ActiveSession::TmuxPane` |
| `src-tauri/src/commands/session.rs` | – | 12 个 `#[command]` |
| `src-tauri/src/models/session.rs` | – | `TmuxCcConfig` / `tmux_pane_info` / `AttachedTmuxServer` |

### 12.2 前端

| 文件 | LOC | 角色 |
|---|---|---|
| `src/types/session.ts` | – | `TmuxCcConfig` + 5 个事件 payload interface |
| `src/services/sessionService.ts` | – | 9 个 tmux invoke wrapper |
| `src/contexts/session/useTauriListeners.ts` | 535 | 8 个 tmux 事件订阅 + reducer |
| `src/contexts/session/usePaneActions.ts` | – | `splitTmuxPaneInternal` |
| `src/contexts/session/useSessionState.ts` | – | `tmuxControllerErrors` / `tmuxControllerConfigsRef` 字段 |
| `src/hooks/useTmuxAutoAttach.ts` | 34 | 重连 hook |
| `src/components/TmuxControllerErrorBanner.tsx` | 98 | 错误 banner + Retry |
| `src/components/dialogs/TmuxForm.tsx` | ~110 | 整合 tmux 创建表单（Base Configuration 下拉框 + tmux 字段；transport 由 base config 隐含） |
| `src/components/dialogs/CreateSessionDialog.tsx` | 369 | 4 top tabs |
| `src/components/Pane.tsx` | 269 | 右键菜单 capability 分支 |

### 12.3 文档

| 文件 | 角色 |
|---|---|
| `doc/requirements/prd-0.1/req-006-tmux.md` | 需求 + 设计决策 + Wave 拆分（13 章节，563 行） |
| `doc/requirements/prd-0.1/tmux-cc-implementation.md` | **本文档** |
| `doc/arch/architecture-map.md` §5.7 | 架构概览（8 个子节） |

---

## 13. 进一步阅读顺序

如果改动涉及 tmux -CC，按这个顺序读（基于 `architecture-map.md` §8.1）：

1. 本文件 §1–3 — 形成心智模型
2. [`req-006-tmux.md`](req-006-tmux.md) — 需求 + 协议 + 决策
3. `architecture-map.md` §5.7 — 架构概览
4. `src-tauri/src/services/tmux/mod.rs` — 模块门面
5. `src-tauri/src/services/tmux/parser.rs` + `events.rs` + `escape.rs` — **先看测试**再看实现（parser 单测即规范）
6. `src-tauri/src/services/tmux/dispatch.rs::dispatch_event` — §4.6.4 路由规则
7. `src-tauri/src/services/session_manager.rs::create_tmux` / `attach_tmux` / `create_tmux_pane` — 注册路径
8. `src/contexts/session/useTauriListeners.ts` — 前端 reducer
9. `src/types/session.ts` — 事件 payload schema

---

## 14. 修订记录

| 日期 | 变更 |
|---|---|
| 2026-09-06 | 初稿。基于 req-006-tmux.md + architecture-map.md §5.7 + 仓库实际文件清单生成；覆盖后端 6 模块 + SessionManager 8 方法 + 前端 9 wrapper + 8 listener + 5 UI/hook + SSH path + 端到端数据流。 |
| 2026-09-06 | **概念厘清修订**：明确 xsterm session（backend 连接）/ xsterm pane（UI 容器）/ tmux pane（tmux leaf）三概念；xsterm pane ↔ tmux pane（1:1 渲染关系），xsterm session 背后代理 tmux pane。D1 决策表述改为"每个 xsterm session 背后代理一个 tmux pane"。`TmuxPaneHandle` 改为说明是 xsterm session 的 backend 实现。Tauri 命令表 + 前端 wrapper 表 + 数据流图加概念标注。 |
| 2026-09-06 | **目录分层重构**：tmux 实现从 `infrastructure/tmux/` 移到 `services/tmux/`，按"业务/编排在 services，trait 抽象在 infrastructure"分层（与 `services/local_session.rs` + `infrastructure/pty.rs` 对齐）。`controller.rs` 中 566 行 `dispatch_event` + `spawn_dispatch_task` 拆到独立 `dispatch.rs` 提高可读性。`backend.rs`（`TmuxBackend` trait + impls）保留在 `infrastructure/tmux/`。`TmuxController` 私有字段改为 `pub(crate)` 以支持子模块 `dispatch` 的访问。`cargo check` + `cargo test --lib` 通过（246 个测试，0 failed）；`npx tsc --noEmit` 通过。 |
| 2026-09-06 | **统一为目录形式**：与 tmux 对齐，`services/local_session.rs` → `services/local_session/{mod,resolution,spawn,bytes,tests}.rs`（779 行按"PTY 准备 / PTY spawn + 转发 / 字节工具 / 测试"切分），`services/ssh_session.rs` → `services/ssh_session/mod.rs`（94 行包成文件夹，薄壳保持不变）。三个会话业务模块在 `services/` 下统一为目录形式。`cargo check` + `cargo test --lib` 通过（246 个测试，0 failed）；`npx tsc --noEmit` 通过。 |
| 2026-09-06 | **整合 Create Session Tmux tab**：`TmuxLocalForm` + `TmuxSshForm` 合并为 `TmuxForm.tsx`，通过 `FormRadioGroup<ConnectionMode>` 在 Local / SSH 间二选一；SSH 选中时条件渲染 `SshSessionForm`（用 `config.ssh` 字段驱动）。CreateSessionDialog topTab 从 4 个 (`local` / `ssh` / `tmux-cc` / `tmux-ssh`) 减为 3 个 (`local` / `ssh` / `tmux-cc`)，所有 `tmux-ssh` 分支合并到 `tmux-cc`（SSH 子配置由 form 内部处理，submit 时统一调 `onCreateTmux`）。`cargo check` + `cargo test --lib` 通过；`npx tsc --noEmit` 通过。 |
| 2026-09-06 | **以 saved config 为基础创建 tmux**：取消 `TmuxForm` 的 transport Radio + SSH 子表单；改为 `FormSelectField` 下拉框选 savedConfigs（filter `local` / `ssh` 类型）。`TmuxCcConfig` 新增 `baseConfigId?: string` 字段；提交时 `CreateSessionDialog` 从 savedConfigs 查 base config，当 base 是 SSH 时把 SSH 子配置 copy 进 `TmuxCcConfig.ssh`（保留为后端 transport 决定因素）；tmux-cc 不能嵌套（base config 必须是 SSH 或 Local）。transport 字段不再让用户手动切换，由 base config 隐含决定。 |
