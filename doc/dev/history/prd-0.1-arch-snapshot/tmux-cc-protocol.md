# tmux CC：xsterm ↔ 远端 tmux server 通信协议

> **配套**：[`doc/requirements/prd-0.1/req-006-tmux.md`](req-006-tmux.md)（需求 + 设计决策）、[`doc/requirements/prd-0.1/tmux-cc-implementation.md`](tmux-cc-implementation.md)（实现细节 + 文件索引）、[`doc/arch/architecture-map.md`](architecture-map.md) §5.7（架构概览）
> **范围**：xsterm **client 进程** ↔ 远端 **tmux server** 之间的通信，**不含** `tmux -CC` 控制模式本身的 tmux 内部协议规范

---

## 1. TL;DR

xsterm 通过 **`tmux -CC`**（control mode）把远端 tmux server 当成一个"远程终端 RPC server"：

- xsterm 的 Rust 进程是 **client**
- 远端的 `tmux` 二进制是 **server**（运行在用户 SSH 登录后的 shell 里）
- 两者通过 **stdin / stdout** 上的 **line-oriented 控制协议** 通信
- SSH exec + pty-req 把这条 stdin/stdout 桥接到 `SshTmuxBackend`

每条 `tmux -CC` 会话 = 一个 **client 子进程**（`tmux -CC`） + 远端一个或多个 **tmux pane**。xsterm 的 `TmuxController` 把这 N 个 pane 代理为 N 个 xsterm session（"xsterm session 是 backend 连接"的语义保持不变 —— 见 AGENTS.md "Core Concepts"）。

---

## 2. 角色与组件

| 角色 | 是什么 | 拥有方 |
|---|---|---|
| **xsterm client** | Rust 进程内的 `TmuxController` —— spawn `tmux -CC` 子进程并管理其 I/O | `services/tmux/controller.rs` 的 `TmuxController` struct |
| **tmux server** | 远端 `tmux` 二进制，监听来自 `tmux -CC` client 的命令并把通知 push 回 stdout | 用户在远端机器上启动的 `tmux` 进程（被 `tmux -CC` 隐式启动） |
| **transport** | SSH exec channel + pty-req：把 client 的 stdin/stdout 桥接到远端 `tmux` 进程的 stdin/stdout | `infrastructure/ssh.rs::connect_ssh_exec` + `infrastructure/tmux/backend.rs::SshTmuxBackend` |
| **control-mode 协议** | `tmux -CC` 在 stdout 上输出的行格式（`%output`, `%begin`, `%window-pane-changed` 等），与 client 通过 stdin 发出的命令（`send-keys -t %1 ...`, `split-window -h -t %1` 等） | 详见 [§4 消息流](#4-消息流) |

一个 xsterm TmuxController **= 一个 `tmux -CC` client 子进程 = 一个 tmux server 端 control session**。controller 不直接对应 tmux server，对应的是 tmux control session（client 端的代理身份）。

---

## 3. tmux -CC 协议基础

### 3.1 什么是 `-CC`

`tmux -CC` 是 tmux 的 **control mode client flag**：

- `tmux -CC` 启动时，client 把自己变成一个"control client"
- 启动后，client 通过 stdin 发命令、通过 stdout 接收通知
- tmux server 在 client 端**自动 attach 一个 control session**（如果没有就 `new-session` 创建），这个 control session 是 client 操作的"虚拟控制会话"
- client 用 `refresh-client -C` 注册为 control client；之后 server 把 session/window/pane 状态变化以 `%xxx` 通知推给 client

iTerm2、wezterm 等成熟终端都实现了同一套协议；xsterm 是又一份 Rust 实现。

### 3.2 wire format

`tmux -CC` 的 wire 协议**按行分隔**（`\n`），但有**两个特殊包裹**：

1. **DCS passthrough**（`tmux 3.x` 起）：整个 stdout 通道包在 `ESC P 1000 p ... ESC \`（Device Control String passthrough）里。reader 必须 strip 这两层 9 字节才能让 `%xxx` 行直接到 parser。
2. **同步命令回复块**（`%begin %end`）：任何 fire-and-forget 的同步命令（如 `capture-pane`、`list-sessions`）的输出**按行**在 `%begin <id>` 和 `%end <id>` 之间。xsterm 用 `id` 关联异步 promise。

### 3.3 字符编码

- 二进制字节（控制字符、UTF-8 续字节、ASCII 之外的字节）在 `%output` 数据里用 octal 三位 `\nnn` 转义
- 转义/反转义在 `services/tmux/escape.rs`

---

## 4. 消息流

### 4.1 client → server（写到 tmux 子进程 stdin）

每条命令 `"\n"` 结尾，直接拼接：

| 命令 | 例子 | 用途 |
|---|---|---|
| `send-keys -t %<pane> <keys>` | `send-keys -t %1 hello\r` | 向指定 pane 写字节（用户键入 / 程序输出） |
| `resize-pane -t %<pane> -x <cols> -y <rows>` | `resize-pane -t %1 -x 120 -y 40` | 调整 pane 大小（xterm.js resize） |
| `split-window -h\|-v -t %<pane>` | `split-window -h -t %1` | 水平/垂直 split（用户拖分隔条） |
| `kill-pane -t %<pane>` | `kill-pane -t %3` | 关闭 pane |
| `new-window [-n <name>]` | `new-window -n editor` | 开新 window（xsterm Window 创建） |
| `kill-window -t @<window>` | `kill-window -t @1` | 关 window |
| `rename-window -t @<id> <new_name>` | `rename-window -t @1 dev` | 重命名 window |
| `refresh-client -C` | (无参数) | **必须** 第一个发 —— 注册为 control client，否则 server 立即关 control session |
| `capture-pane -p -e -J -S -<N> -t %<pane>` | `capture-pane -p -e -J -S -100 -t %1` | 抓取 pane 滚动历史（focus 时拉数据） |
| `list-sessions` / `list-windows` / `list-panes` | | 同步查询（当前 xsterm 主要用 `%begin/%end` 块） |

完整构造器在 `services/tmux/commands.rs`。所有构造器都是 `pub fn name(...) -> String` 返回 newline-terminated 命令字符串，写入 controller 持有的 `stdin_tx: mpsc::UnboundedSender<String>`，writer task 顺序写入 tmux stdin。

### 4.2 server → client（从 tmux 子进程 stdout 读）

按行读后按首个 token 路由：

| 通知 | 例子 | 含义 |
|---|---|---|
| `%output %<pane> <octal-escaped-data>` | `%output %5 hello\015\012` | pane 的 shell 输出（**最常见**，xsterm → xterm.js） |
| `%begin <ts> <id> 0` / `%end <ts> <id> 0` | (capture / list 命令回复) | 同步命令块开始 / 结束 |
| `%extended-output %<pane> <age_ms> ... : <data>` | | 带时延的输出（xsterm 当前不主动处理） |
| `%session-changed $1 <name>` | | server 给 client 的当前 session 通知 |
| `%sessions-changed` | | sessions 列表变化 |
| `%window-add @<id>` | | 新 window |
| `%window-close @<id>` | | 关 window |
| `%window-renamed @<id> <name>` | | rename |
| `%window-pane-changed @<id> %<id>` | | window 当前 pane 变化（**关键** —— xsterm 据此注册首个 pane） |
| `%pane-exited %<id>` / `%pane-died %<id>` | | pane 退出 / 异常死亡 |
| `%exit` | | tmux server 端 client channel 关闭 |
| `%pause %<pane>` / `%continue %<pane>` | | server 端 backpressure（xsterm 当前不主动处理） |
| `%exit [reason]` | | control mode 关闭（client 进程必须 exit） |
| `%layout-change @<id> ...` | | layout 变化 |

完整 `ControlEvent` 枚举在 `services/tmux/events.rs`，parser 在 `services/tmux/parser.rs`。

### 4.3 一条典型 session 创建后 server 推给 client 的首批通知

```
%session-changed $1 dev
%sessions-changed
%window-add @1
%window-pane-changed @1 %1
%output %1 <shell-prompt>
```

xsterm 据此在 dispatch 任务的 5 级 fallthrough + 3 分支 trichotomy 中分配新 pane 的 `xsterm_session_id`，emit `tmux-pane-added` 事件给前端。

---

## 5. 关键流程

### 5.1 启动时序（user create tmux session with SSH base config）

```
xsterm frontend                  Rust backend                       SSH server         tmux server
─────────────────                ────────────                       ───────────         ───────────
CreateSessionDialog.handleCreate
  ↓ invoke("create_tmux_session", { config })
                                  commands::create_tmux_session
                                    ↓ SessionManager::create_tmux
                                    ↓ TmuxController::spawn_local
                                       ├─ if ssh: connect_ssh_exec ────────────────── TCP+auth+exec
                                       │     (pty-req + command "tmux -CC -L default new-session -d -x 80 -y 24")
                                       │                                                       ─→ spawn tmux server
                                    ↓ TmuxController::spawn_with_backend
                                       ├─ reader task: tokio::spawn(read stdout → strip DCS → parser.feed → dispatch_tx)
                                       ├─ writer task: tokio::spawn(stdin_rx → write tmux stdin)
                                       ├─ stderr drain task
                                       ├─ monitor task: backend.wait() until ExitStatus notify
                                       ├─ dispatch task: tokio::spawn(dispatch_rx → dispatch_event)
                                       ├─ stdin_tx.send("refresh-client -C\n")  ← handshake 第一个命令
                                    ↓ await_first_pane (5s timeout)
                                                                                            ─→ writes:
                                                                                                 %session-changed $1 dev
                                                                                                 %sessions-changed
                                                                                                 %window-add @1
                                                                                                 %window-pane-changed @1 %1
                                  reader: parse → dispatch_event(WindowPaneChanged case 3 bootstrap)
                                    → record_first_pane(xsterm_id, "%1")
                                  await_first_pane: 立即返回 (xsterm_id, "%1")
                                    ↓ tmux_pane_info + TmuxPaneHandle
                                    ↓ insert_session
                                  Return SessionInfo to frontend
                                  ↓
                                emit "tmux-pane-added" (前端 listener 绑 leaf → session)
```

### 5.2 运行时（user 键入字符）

```
xsterm frontend                  xterm.js                          xsterm Rust                  SSH/tmux
─────────────────              ────────                          ────────────                  ───────
user types "h" in pane
  ↓ xterm.onData("h")
  Terminal.tsx → writeSessionRef(sessionId, "h")
    ↓
  sessionService.writeSession(sessionId, "h")
    ↓
  invoke("write_session", { sessionId, data: "h" })
                                  commands::write_session
                                    ↓ with_manager(state, mgr.write_session)
                                    ↓ match ActiveSession::TmuxPane(handle)
                                    ↓ handle.write("h")
                                    → controller.send_keys(pane_id, "h")
                                    → stdin_tx.send('send-keys -t %1 h\n')
                                    ↓
                                  writer task: std::_rx.recv() → stdin.write_all
                                    ↓
                                                                                              SSH write_tx ─→ tmux server stdin
                                                                                                                       ─→ shell (bash) prints "h"
                                                                                                                       ─→ tmux captures
                                                                                                                       ─→ writes "%output %1 h" to stdout
                                  reader: tokio::spawn read stdout
                                    → strip DCS
                                    → parser.feed("%output %1 h")
                                    → emit ControlEvent::Output { pane_id: "%1", data: b"h" }
                                    → dispatch_tx.send
                                  dispatch task: dispatch_event(Output)
                                    → backend.emit("session-output", [xsterm_id, b"h"])
                                                                                              ─→ Tauri event bus
  useTauriTerminalOutput.ts: listen("session-output")
    → decode bytes + OSC52 strip + RAF buffer
    → xterm.write(text)  ← "h" 出现在用户屏幕上
```

### 5.3 关闭时序

```
user closes window / X button
  ↓
  invoke("close_session", { sessionId })
                                  commands::close_session
                                    ↓ SessionManager::close_session
                                    ↓ ActiveSession::TmuxPane → handle.close()
                                    → controller.unbind_pane(pane_id)
                                    (不杀 controller —— 其他 pane 仍可活)
...
user 关闭所有 pane 后, 或显式 close_tmux_controller
  ↓
  controller.close() → 设 killed flag
  → backend.kill() (SIGKILL local child / EOF stdin SSH)
  → bridge thread drop tokio_tx
  → reader stdout EOF
  → reader task exit
  → backend.wait() return (exit_code via notify)
  → monitor task: emit ControlEvent::Exit { reason: Some("exit code: N") }
  → frontend TmuxControllerErrorBanner 显示 (if reason is Some)
```

---

## 6. Promise 协调（同步命令 round-trip）

某些 tmux 命令是 fire-and-forget，但需要知道结果（如 `split-window` 的新 pane id、`capture-pane` 的内容、`new-window` 的新 window id）。xsterm 用 **`oneshot` + `Mutex<VecDeque>`** 实现 promise：

| 同步命令 | 协调机制 | 返回 |
|---|---|---|
| `split_window` | `pending_splits: Mutex<VecDeque<oneshot::Sender<SplitResult>>>` —— 在写 `split-window` 前 push sender；dispatch 收到 `%begin → %end (id 匹配)` 时 pop front sender 并 send 包含 `(xsterm_session_id, tmux_pane_id, tmux_window_id)` 的 `SplitResult` | 5s timeout |
| `new_window` | `pending_windows: Mutex<VecDeque<oneshot::Sender<NewWindowResult>>>` —— 同上 | 5s timeout |
| `capture_pane` | `pending_capture: Mutex<Option<oneshot::Sender<CaptureResult>>>` + `pending_capture_body: Mutex<Vec<String>>` —— 单飞（一次只允许一个 capture），body lines 累积，`%end` 触发并 send | 5s timeout |
| `kill_pane` / `kill_window` / `new_window` | fire-and-forget（无 promise），由后续 `%pane-exited` / `%window-close` 通知确认 | n/a |
| `send_keys` / `resize_pane` | fire-and-forget | n/a |

完整 promise 协调在 `services/tmux/controller.rs::spawn_dispatch_task`（`super::dispatch` 的 5 级 fallthrough + 3 分支 trichotomy）。

---

## 7. 数据流图（一张完整图）

```
┌──────────────────────────────────────────────────────────────────┐
│                       xsterm (Rust + frontend)                      │
│                                                                       │
│  ┌─────────────────┐   ┌────────────────────┐                       │
│  │ TmuxController  │   │  reader task        │   writer task         │
│  │  state + methods│   │                     │                       │
│  │                 │   │  stdout (tokio mpsc)│──► tmux stdin          │
│  └────────┬────────┘   │  ↓                    │                       │
│           │            │  BufReader::lines     │                       │
│           │            │  ↓                    │                       │
│           │            │  strip DCS passthrough│                      │
│           │            │  ↓                    │                       │
│           │            │  parser.feed(line)    │                       │
│           │            │  ↓ ControlEvent       │                       │
│           │            │  dispatch_tx ─────────┼────────────────────┐  │
│           │            └────────────────────┘                       │  │
│           │                                                        │  │
│           │            ┌────────────────────┐                       │  │
│           │            │  dispatch task       │                       │  │
│           │            │                     │                       │  │
│           │            │  dispatch_rx.recv()  │                       │  │
│           │            │  ↓ dispatch_event()  │                       │  │
│           │            │  - match %output     │                       │  │
│           │            │    → emit "session-output" (xterm.js)       │  │
│           │            │  - match %window-pane-changed               │  │
│           │            │    → record_first_pane                     │  │
│           │            │  - match split reply  │                       │  │
│           │            │    → resolve pending_splits sender         │  │
│           │            │  - match %pane-exited│                       │  │
│           │            │    → emit "tmux-pane-removed"               │  │
│           │            │  - match %exit        │                       │  │
│           │            │    → emit "tmux-controller-exit"           │  │
│           │            └────────────────────┘                       │  │
│           │                                                        │  │
│           │            ┌────────────────────┐                       │  │
│           │            │  monitor task        │                       │  │
│           │            │  backend.wait()       │◄──── notify          │  │
│           │            │  → emit ControlEvent::Exit { reason }       │  │
│           │            └────────────────────┘                       │  │
│           │                                                        │  │
└───────────┼────────────────────────────────────────────────────────┘
            │
            │  ┌─────────────────────────┐
            │  │  SshTmuxBackend           │
            │  │  + bridge OS thread       │
            │  │  (sync_mpsc → tokio mpsc)│
            │  └─────────────────────────┘
            │
            │  SSH exec channel
            │  (TCP + russh + pty-req)
            ▼
┌──────────────────────────────────────────────────────────────────┐
│           remote host: openssh server  →  spawns `tmux -CC`     │
│                                              │                    │
│                                              │  reads stdin  ←── client commands
│                                              │  writes stdout ──→ client (DCS-wrapped %xxx)
│                                              ▼                    │
│                              tmux server (in control mode)        │
│                                                                       │
│  - maintains 1 control session per -CC client                     │
│  - parses each stdin command line → mutates state                  │
│  - on state change → pushes %xxx notification to client stdout   │
│  - on EOF stdin (client close) → server ends control session,     │
│    sends %exit, closes channel                                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 8. 异常路径

| 异常 | 客户端如何察觉 | 用户可见行为 |
|---|---|---|
| 远端 `tmux` 不在 PATH | SSH exec 启动 `tmux` 立即 `exec failed`（127）；exit_status=127 通过 `exit_code_notify` 传到 monitor task | 错误在 `Tauri log`（无 stderr 进 xterm）；`tmux-controller-exit` 事件带 `reason: "exit code: 127"`；`TmuxControllerErrorBanner` 显示 |
| SSH server 拒绝 exec | `connect_ssh_exec` 返回 `Err` | 错误直接 propagate 到 `create_tmux_session` 命令的 `Result::Err`，前端 dialog 显示 `"Failed to create session: ..."` |
| tmux 启动但 stdin 不是 tty | `tcgetattr failed: Inappropriate ioctl for device` 写到 stderr；tmux exit code 非 0 | 同上（stderr 仍丢失，但 exit code 准确） |
| 客户端发命令后 server 不回复 | `await_first_pane` / `split_pane` / `capture_pane` 等 5s timeout → `Err("...timed out")` | 前端 dialog 显示 `"Failed to create session: tmux controller 1: timed out waiting for first pane"` |
| 网络断线 | SSH data loop EOF；exit_code 还是 None；`backend.wait()` 等 notify 5s 超时返回 -1 | 同上，banner 显示 `exit code: -1`（仍可识别为"网络中断"） |
| control client 没发 `refresh-client -C` | server 立即关 control session → `ExitStatus: 0` + EOF | banner 显示 `exit code: 0` 但实际是"未接管"。**已修**（Bug 011）—— spawn_with_backend 末尾自动发 |
| 客户端对 stdout EOF 立即返回 exit code -1 而非真实值 | `wait()` 拿到已被 reader take 的 stdout_rx → 立即 `unwrap_or(-1)` | banner 显示 `exit code: -1` 即使真实是 0/127。**已修**（Bug 012）—— wait() 等 `exit_code_notify` 而非 stdout EOF |

---

## 9. 关键代码入口

| 想看什么 | 看哪里 |
|---|---|
| 协议 wire format（escape 规则） | `services/tmux/escape.rs` |
| 协议消息枚举 | `services/tmux/events.rs::ControlEvent` |
| 协议行 → 事件 parser | `services/tmux/parser.rs::ControlParser` |
| 协议消息 → Tauri 事件 dispatch | `services/tmux/dispatch.rs::dispatch_event` |
| 协议命令构造 | `services/tmux/commands.rs` |
| SSH exec transport | `infrastructure/ssh.rs::connect_ssh_exec` + `run_ssh_exec_session` |
| transport 抽象（local / SSH） | `infrastructure/tmux/backend.rs` |
| Controller 完整生命周期 | `services/tmux/controller.rs` |
| Promise 协调（split / new-window / capture） | `services/tmux/controller.rs` 字段 `pending_splits` / `pending_windows` / `pending_capture` |
| ExitStatus 捕获 | `infrastructure/ssh.rs::handle_channel_msg` ExitStatus 分支 + `SshConnectResult.exit_code_notify` |
| DCS passthrough stripping | `services/tmux/controller.rs::spawn_reader_task`（`DCS_START = "\x1bP1000p"`, `DCS_END = "\x1b\\"`） |

---

## 10. 一句话总结

> **xsterm = tmux 的一个 control-mode client**：把 `TmuxController` 当成一个 line-oriented RPC client，把 `dispatch_task` 当成 event demultiplexer，把 `dispatch_event` 当成 RPC dispatcher；SSH exec + pty-req 是 transport；DCS passthrough 包裹是 wire-format quirk。
>
> 理解了这层类比，整个 tmux 集成代码就只是 "wire protocol + Promise coordination + lifecycle management"。
